import json
import os
from contextlib import asynccontextmanager

from dotenv import load_dotenv
from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.exception_handlers import request_validation_exception_handler
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response

from app.models import (
    MealAnalysisResult,
    MealUpsertResponse,
    NearbyPlacesRequest,
    NearbyPlacesResponse,
    RecommendRequest,
    RecommendResponse,
    TextAnalyzeRequest,
    UrlAnalyzeRequest,
)
from app.services import ai_recommender, openai_meal_analyzer
from app.services.nearby_places import search_nearby_places
from app.services.nutrition_enricher import normalize_and_enrich_result
from app.storage.meals_store import add_meal, load_meals, recommend_meals


load_dotenv()

MAX_RECOMMENDATION_LIMIT = 5
DEFAULT_RECOMMENDATION_LIMIT = 3
AI_CANDIDATE_LIMIT = 15
REUSED_RESULTS_MESSAGE = "\u53ef\u7528\u5019\u9078\u4e0d\u8db3\uff0c\u5df2\u91cd\u65b0\u986f\u793a\u90e8\u5206\u7d50\u679c\u3002"
AI_FALLBACK_MESSAGE = "AI \u63a8\u85a6\u6392\u5e8f\u66ab\u6642\u4e0d\u53ef\u7528\uff0c\u5df2\u6539\u7528\u57fa\u672c\u689d\u4ef6\u63a8\u85a6\u3002"


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


@app.post("/api/recommend", response_model=list[MealAnalysisResult] | RecommendResponse)
def recommend(request: RecommendRequest) -> list[MealAnalysisResult] | RecommendResponse:
    limit = _recommendation_limit(request.limit)

    # The storage layer remains the safety gate: incomplete meals, allergies,
    # avoidances and keyword filters are applied before AI sees any candidate.
    safe_candidates = recommend_meals(
        health_goal=request.healthGoal,
        tags=request.tags,
        excluded_ingredients=request.excludedIngredients,
        keyword=request.keyword,
    )
    ranked_pool, reused_previous_results = _build_refresh_pool(
        safe_candidates,
        exclude_meal_ids=request.excludeMealIds,
        exclude_meal_names=request.excludeMealNames,
        limit=limit,
    )
    response_message = REUSED_RESULTS_MESSAGE if reused_previous_results else ""

    # Legacy clients still get the older array shape, but with the same limit
    # and refresh de-duplication rules.
    if request.userTextPreference is None:
        return ranked_pool[:limit]

    try:
        coarse_needs = ai_recommender.interpret_needs(
            request.userTextPreference,
            request.healthGoal,
            request.tags,
            request.excludedIngredients,
        )
        coarse_ranked = ai_recommender._rule_rank(ranked_pool, coarse_needs)
        coarse_order = {item["mealId"]: index for index, item in enumerate(coarse_ranked)}
        ai_candidates = sorted(
            ranked_pool,
            key=lambda meal: coarse_order.get(meal.id, len(coarse_order)),
        )[:AI_CANDIDATE_LIMIT]

        ranked = ai_recommender.rank_meals(
            user_text_preference=request.userTextPreference,
            health_goal=request.healthGoal,
            selected_tags=request.tags,
            excluded_ingredients=request.excludedIngredients,
            candidate_meals=ai_candidates,
            query_history=request.queryHistory,
        )
        limited_ranked = ranked["rankedMeals"][:limit]
        return RecommendResponse(
            interpretedNeeds=ranked["interpretedNeeds"],
            rankedMeals=limited_ranked,
            meals=_meals_for_ranked(limited_ranked, ai_candidates),
            usedAiRanking=True,
            fallbackUsed=False,
            reusedPreviousResults=reused_previous_results,
            message=response_message,
        )
    except Exception:
        # Do not leak provider or upstream API errors to the client.
        fallback_needs = ai_recommender.interpret_needs(
            request.userTextPreference,
            request.healthGoal,
            request.tags,
            request.excludedIngredients,
        )
        fallback_ranked = ai_recommender._rule_rank(ranked_pool, fallback_needs)[:limit]
        return RecommendResponse(
            interpretedNeeds=fallback_needs,
            rankedMeals=fallback_ranked,
            meals=_meals_for_ranked(fallback_ranked, ranked_pool),
            usedAiRanking=False,
            fallbackMessage=AI_FALLBACK_MESSAGE,
            fallbackUsed=True,
            reusedPreviousResults=reused_previous_results,
            message=response_message,
        )


@app.post("/api/nearby-places", response_model=NearbyPlacesResponse)
async def nearby_places(request: NearbyPlacesRequest) -> NearbyPlacesResponse:
    return await search_nearby_places(
        lat=request.lat,
        lng=request.lng,
        meal_name=request.mealName,
        meal_type=request.mealType,
        tags=request.tags,
        user_text_preference=request.userTextPreference,
        health_goal=request.healthGoal,
        excluded_ingredients=request.excludedIngredients,
        radius_meters=request.radiusMeters,
    )


def _meal_request_validation_detail(errors: list[dict[str, object]]) -> str:
    for issue in errors:
        location = ".".join(str(item) for item in issue.get("loc", []))
        if "mealName" in location:
            return "\u9910\u9ede\u540d\u7a31\u4e0d\u53ef\u70ba\u7a7a"
        if "mainIngredients" in location:
            return "\u4e3b\u8981\u98df\u6750\u4e0d\u53ef\u70ba\u7a7a"
        if "estimatedCalories" in location:
            return "\u71b1\u91cf\u4e0d\u53ef\u70ba\u8ca0\u6578"
        if "sourceType" in location:
            return "sourceType \u683c\u5f0f\u4e0d\u5408\u6cd5"
        if "recommendationReason" in location:
            return "\u63a8\u85a6\u7406\u7531\u4e0d\u53ef\u70ba\u7a7a"
        if "tags" in location:
            return "\u6a19\u7c64\u4e0d\u53ef\u70ba\u7a7a"
        if "mealType" in location:
            return "\u9910\u9ede\u985e\u578b\u4e0d\u53ef\u70ba\u7a7a"
    return "\u9910\u9ede\u8cc7\u6599\u683c\u5f0f\u4e0d\u6b63\u78ba"


def _recommendation_limit(value: int | None) -> int:
    if value is None:
        return DEFAULT_RECOMMENDATION_LIMIT
    return max(1, min(MAX_RECOMMENDATION_LIMIT, int(value)))


def _build_refresh_pool(
    candidates: list[MealAnalysisResult],
    *,
    exclude_meal_ids: list[str],
    exclude_meal_names: list[str],
    limit: int,
) -> tuple[list[MealAnalysisResult], bool]:
    excluded_ids = {str(item).strip() for item in exclude_meal_ids if str(item).strip()}
    excluded_names = {_normalize_meal_name(item) for item in exclude_meal_names if _normalize_meal_name(item)}
    if not excluded_ids and not excluded_names:
        return _dedupe_meals(candidates), False

    fresh_candidates = [
        meal
        for meal in candidates
        if meal.id not in excluded_ids and _normalize_meal_name(meal.mealName) not in excluded_names
    ]
    if len(fresh_candidates) >= limit:
        return _dedupe_meals(fresh_candidates), False

    return _dedupe_meals([*fresh_candidates, *candidates]), True


def _normalize_meal_name(value: str) -> str:
    return " ".join(str(value).strip().lower().split())


def _dedupe_meals(meals: list[MealAnalysisResult]) -> list[MealAnalysisResult]:
    seen_ids: set[str] = set()
    seen_names: set[str] = set()
    unique: list[MealAnalysisResult] = []
    for meal in meals:
        name_key = _normalize_meal_name(meal.mealName)
        if meal.id in seen_ids or name_key in seen_names:
            continue
        seen_ids.add(meal.id)
        seen_names.add(name_key)
        unique.append(meal)
    return unique


def _meals_for_ranked(
    ranked_meals: list[dict[str, object]],
    candidates: list[MealAnalysisResult],
) -> list[MealAnalysisResult]:
    by_id = {meal.id: meal for meal in candidates}
    meals: list[MealAnalysisResult] = []
    for item in ranked_meals:
        meal = by_id.get(str(item.get("mealId") or ""))
        if meal:
            meals.append(meal)
    return meals


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
