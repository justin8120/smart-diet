import os
import json
from contextlib import asynccontextmanager

from dotenv import load_dotenv
from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.exceptions import RequestValidationError
from fastapi.exception_handlers import request_validation_exception_handler
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response

from app.models import (
    MealAnalysisResult,
    MealUpsertResponse,
    NearbyPlacesRequest,
    NearbyPlacesResponse,
    RecommendResponse,
    RecommendRequest,
    TextAnalyzeRequest,
    UrlAnalyzeRequest,
)
from app.services import openai_meal_analyzer
from app.services import ai_recommender
from app.services.nearby_places import search_nearby_places
from app.services.nutrition_enricher import normalize_and_enrich_result
from app.storage.meals_store import add_meal, load_meals, recommend_meals


load_dotenv()


class UnicodeEscapedJSONResponse(JSONResponse):
    def render(self, content: object) -> bytes:
        return json.dumps(
            content,
            ensure_ascii=True,
            allow_nan=False,
            separators=(",", ":"),
        ).encode("utf-8")


@asynccontextmanager
async def lifespan(app: FastAPI):
    load_meals()
    yield


app = FastAPI(
    title="Smart Diet Recommendation API",
    lifespan=lifespan,
    default_response_class=UnicodeEscapedJSONResponse,
)


@app.exception_handler(RequestValidationError)
async def readable_request_validation_error(
    request: Request,
    error: RequestValidationError,
) -> Response:
    if request.url.path == "/api/meals" and request.method == "POST":
        return UnicodeEscapedJSONResponse(
            status_code=422,
            content={"detail": _meal_request_validation_detail(error.errors())},
        )
    return await request_validation_exception_handler(request, error)

frontend_origins = [
    origin.strip()
    for origin in os.getenv("FRONTEND_ORIGIN", "http://localhost:5173").split(",")
    if origin.strip()
]
app.add_middleware(
    CORSMiddleware,
    allow_origins=[*frontend_origins, "http://localhost:4173", "http://localhost:4174"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/health")
def health() -> dict[str, object]:
    return {
        "status": "ok",
        **openai_meal_analyzer.provider_status(),
    }


@app.post("/api/analyze/text", response_model=MealAnalysisResult)
def analyze_text(request: TextAnalyzeRequest) -> MealAnalysisResult:
    if not request.content.strip():
        raise HTTPException(status_code=400, detail="\u6587\u5b57\u63cf\u8ff0\u4e0d\u53ef\u70ba\u7a7a\u3002")
    content = _with_constraint_context(request.content, request.excludedIngredients)
    return normalize_and_enrich_result(openai_meal_analyzer.analyze_text(content), original_text=content)


@app.post("/api/analyze/image", response_model=MealAnalysisResult)
async def analyze_image(
    file: UploadFile = File(...),
    text: str = Form(""),
    description: str = Form(""),
    excludedIngredients: str = Form(""),
) -> MealAnalysisResult:
    if not file.filename:
        raise HTTPException(status_code=400, detail="\u8acb\u4e0a\u50b3\u9910\u9ede\u5716\u7247\u3002")
    constraints = _parse_form_constraints(excludedIngredients)
    hint = _with_constraint_context((text or description).strip(), constraints)
    original_text = f"{hint} {file.filename}".strip()
    return normalize_and_enrich_result(
        await openai_meal_analyzer.analyze_image(file, hint=hint),
        original_text=original_text,
    )


@app.post("/api/analyze/url", response_model=MealAnalysisResult)
async def analyze_url(request: UrlAnalyzeRequest) -> MealAnalysisResult:
    url = str(request.url or "").strip()
    if not url:
        raise HTTPException(status_code=400, detail="\u9910\u9ede\u9023\u7d50\u4e0d\u53ef\u70ba\u7a7a\u3002")
    constraint_context = _constraint_context(request.excludedIngredients)
    original_text = _with_constraint_context(url, request.excludedIngredients)
    return normalize_and_enrich_result(
        await openai_meal_analyzer.analyze_url(url, constraint_context=constraint_context),
        original_text=original_text,
    )


@app.get("/api/meals", response_model=list[MealAnalysisResult])
def get_meals() -> list[MealAnalysisResult]:
    return load_meals()


@app.post("/api/meals", response_model=MealUpsertResponse)
def create_meal(meal: MealAnalysisResult) -> MealUpsertResponse:
    try:
        saved_meal, action = add_meal(meal)
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    return MealUpsertResponse(meal=saved_meal, action=action)


def _meal_request_validation_detail(errors: list[dict[str, object]]) -> str:
    for issue in errors:
        location = ".".join(str(item) for item in issue.get("loc", []))
        if "mealName" in location:
            return "餐點名稱不足"
        if "mainIngredients" in location:
            return "缺少主要食材"
        if "estimatedCalories" in location:
            return "熱量不是有效數值"
        if "sourceType" in location:
            return "sourceType 格式不合法"
        if "recommendationReason" in location:
            return "推薦原因不完整"
        if "tags" in location:
            return "缺少餐點標籤"
        if "mealType" in location:
            return "餐點類型不足"
    return "餐點資料格式不合法"


@app.post("/api/recommend", response_model=list[MealAnalysisResult] | RecommendResponse)
def recommend(request: RecommendRequest) -> list[MealAnalysisResult] | RecommendResponse:
    # The storage layer is the safety gate: it filters incomplete meals and all
    # allergies/avoidances before an AI model ever sees a candidate.
    candidates = recommend_meals(
        health_goal=request.healthGoal,
        tags=request.tags,
        excluded_ingredients=request.excludedIngredients,
        keyword=request.keyword,
    )
    # Keep the original response for older clients that have not opted into the
    # natural-language recommendation flow yet.
    if request.userTextPreference is None:
        return candidates
    try:
        ranked = ai_recommender.rank_meals(
            user_text_preference=request.userTextPreference,
            health_goal=request.healthGoal,
            selected_tags=request.tags,
            excluded_ingredients=request.excludedIngredients,
            candidate_meals=candidates,
            query_history=request.queryHistory,
        )
        order = {item["mealId"]: index for index, item in enumerate(ranked["rankedMeals"])}
        meals = sorted(candidates, key=lambda meal: order.get(meal.id, len(order)))
        return RecommendResponse(**ranked, meals=meals, usedAiRanking=True)
    except Exception:
        # Do not leak provider or upstream API errors to the client.
        fallback_needs = ai_recommender.interpret_needs(
            request.userTextPreference, request.healthGoal, request.tags, request.excludedIngredients,
        )
        fallback_ranked = ai_recommender._rule_rank(candidates, fallback_needs)
        return RecommendResponse(
            interpretedNeeds=fallback_needs,
            rankedMeals=fallback_ranked,
            meals=candidates,
            usedAiRanking=False,
            fallbackMessage="AI 推薦排序暫時不可用，已改用基本條件推薦。",
        )


@app.post("/api/nearby-places", response_model=NearbyPlacesResponse)
async def nearby_places(request: NearbyPlacesRequest) -> NearbyPlacesResponse:
    return await search_nearby_places(
        lat=request.lat,
        lng=request.lng,
        meal_name=request.mealName,
        meal_type=request.mealType,
        tags=request.tags,
        radius_meters=request.radiusMeters,
    )


def _parse_form_constraints(raw: str) -> list[str]:
    value = raw.strip()
    if not value:
        return []
    try:
        payload = json.loads(value)
    except json.JSONDecodeError:
        return [item.strip() for item in value.split(",") if item.strip()]
    if isinstance(payload, list):
        return [str(item).strip() for item in payload if str(item).strip()]
    return []


def _with_constraint_context(text: str, excluded_ingredients: list[str]) -> str:
    context = _constraint_context(excluded_ingredients)
    if not context:
        return text
    return f"{text}\n\n{context}"


def _constraint_context(excluded_ingredients: list[str]) -> str:
    constraints = [item.strip() for item in excluded_ingredients if item.strip()]
    if not constraints:
        return ""
    constraint_text = "\u3001".join(constraints)
    return (
        f"\u4f7f\u7528\u8005\u7981\u5fcc\u6216\u904e\u654f\u689d\u4ef6\uff1a{constraint_text}\n"
        "\u8acb\u6aa2\u67e5\u9910\u9ede\u662f\u5426\u53ef\u80fd\u5305\u542b\u9019\u4e9b\u689d\u4ef6\u3002"
        "\u82e5\u4e0d\u78ba\u5b9a\uff0c\u8acb\u964d\u4f4e\u4fe1\u5fc3\u5206\u6578\u4e26\u63d0\u9192\u4f7f\u7528\u8005\u78ba\u8a8d\u5be6\u969b\u6210\u5206\u3002"
    )
