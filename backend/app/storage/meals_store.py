import json
from pathlib import Path
from threading import Lock

from app.models import MealAnalysisResult


DATA_DIR = Path(__file__).resolve().parents[2] / "data"
MEALS_FILE = DATA_DIR / "meals.json"
USER_MEALS_FILE = DATA_DIR / "user_meals.json"

CATEGORY_SYNONYMS: dict[str, list[str]] = {
    "\u8089\u985e": [
        "\u8089\u985e",
        "\u8089",
        "\u8c6c\u8089",
        "\u8c6c\u8089\u7247",
        "\u8c5a\u8089",
        "\u8c5a",
        "\u8c6c\u6392",
        "\u70b8\u8c6c\u6392",
        "\u6392\u9aa8",
        "\u8089\u71e5",
        "\u53c9\u71d2",
        "\u57f9\u6839",
        "\u706b\u817f",
        "\u9999\u8178",
        "\u725b\u8089",
        "\u725b\u8089\u7247",
        "\u725b\u6392",
        "\u725b\u4e3c",
        "\u725b\u8169",
        "\u96de\u8089",
        "\u96de\u80f8",
        "\u96de\u80f8\u8089",
        "\u96de\u817f",
        "\u96de\u6392",
        "\u70b8\u96de",
        "\u96de\u584a",
        "\u9d28\u8089",
        "\u9d28\u80f8",
        "\u7f8a\u8089",
        "\u7f8a\u6392",
    ],
    "\u8c6c\u8089": [
        "\u8c6c\u8089",
        "\u8c6c\u8089\u7247",
        "\u8c5a\u8089",
        "\u8c5a",
        "\u8c6c\u6392",
        "\u70b8\u8c6c\u6392",
        "\u6392\u9aa8",
        "\u53c9\u71d2",
        "\u57f9\u6839",
        "\u706b\u817f",
        "\u9999\u8178",
        "\u8089\u71e5",
    ],
    "\u725b\u8089": ["\u725b\u8089", "\u725b\u8089\u7247", "\u725b\u6392", "\u725b\u4e3c", "\u725b\u8169"],
    "\u96de\u8089": [
        "\u96de\u8089",
        "\u96de\u80f8",
        "\u96de\u80f8\u8089",
        "\u96de\u817f",
        "\u96de\u6392",
        "\u70b8\u96de",
        "\u96de\u584a",
    ],
    "\u6d77\u9bae": [
        "\u6d77\u9bae",
        "\u8766",
        "\u8766\u4ec1",
        "\u9b5a",
        "\u82b1\u679d",
        "\u9b77\u9b5a",
        "\u87f9",
        "\u7261\u8823",
        "\u86e4\u870a",
        "\u8c9d\u985e",
    ],
    "\u7532\u6bbc\u985e": ["\u8766", "\u87f9", "\u9f8d\u8766", "\u8783\u87f9"],
    "\u5805\u679c": [
        "\u5805\u679c",
        "\u82b1\u751f",
        "\u674f\u4ec1",
        "\u8170\u679c",
        "\u6838\u6843",
        "\u958b\u5fc3\u679c",
        "\u699b\u679c",
    ],
    "\u82b1\u751f": ["\u82b1\u751f", "\u82b1\u751f\u7c89", "\u82b1\u751f\u91ac"],
    "\u4e73\u88fd\u54c1": [
        "\u4e73\u88fd\u54c1",
        "\u725b\u5976",
        "\u5976\u6cb9",
        "\u8d77\u53f8",
        "\u4e73\u916a",
        "\u9bae\u5976\u6cb9",
        "\u5976\u7cbe",
    ],
    "\u9ea9\u8cea": [
        "\u9ea9\u8cea",
        "\u5c0f\u9ea5",
        "\u9eb5\u7c89",
        "\u9eb5\u76ae",
        "\u9eb5\u689d",
        "\u9eb5\u8863",
        "\u9eb5\u5305\u7c89",
    ],
    "\u86cb": ["\u86cb", "\u96de\u86cb", "\u86cb\u6db2", "\u86cb\u9ec3", "\u86cb\u767d"],
    "\u9152\u7cbe": ["\u9152", "\u9152\u7cbe", "\u7c73\u9152", "\u6599\u7406\u9152", "\u5564\u9152", "\u7d05\u9152", "\u767d\u9152"],
    "\u8f9b\u8fa3": ["\u8fa3", "\u8fa3\u6912", "\u9ebb\u8fa3", "\u5fae\u8fa3", "\u8f9b\u8fa3", "\u80e1\u6912"],
}
EXCLUSION_SYNONYMS = CATEGORY_SYNONYMS

CONSTRAINT_WORDS = [
    "\u4e0d\u53ef\u4ee5\u5403",
    "\u4e0d\u80fd\u5403",
    "\u4e0d\u8981\u5403",
    "\u4e0d\u5403",
    "\u4e0d\u8981",
    "\u907f\u514d",
    "\u5c0d",
    "\u904e\u654f",
    "\u7981\u5fcc",
    "\u7121",
]
SAFE_SHORT_TERMS = {"\u86cb", "\u8fa3", "\u9152", "\u8089"}
INVALID_INGREDIENT_TOKENS = {
    "unknown",
    "\u4e3b\u8981\u98df\u6750\u5f85\u78ba\u8a8d",
    "\u4e3b\u8981\u98df\u6750\u9700\u4eba\u5de5\u78ba\u8a8d",
    "\u9910\u9ede\u5f71\u50cf\u7279\u5fb5\u4e0d\u8db3",
    "\u672a\u78ba\u8a8d",
}
GENERIC_REASON_TEMPLATES = {
    "\u7cfb\u7d71\u5df2\u6839\u64da\u5019\u9078\u9910\u9ede\u8207\u53ef\u898b\u98df\u6750\u7279\u5fb5\u91cd\u65b0\u6821\u6b63\u8fa8\u8b58\u7d50\u679c\u3002",
    "\u7cfb\u7d71\u5df2\u6839\u64da\u8f38\u5165\u5167\u5bb9\u63d0\u4f9b\u9910\u9ede\u5065\u5eb7\u5efa\u8b70\u3002",
    "\u7cfb\u7d71\u5df2\u5b8c\u6210\u9910\u9ede\u5206\u6790\u3002",
}
FORBIDDEN_ENGINEERING_TOKENS = ["fallback", "rule-based", "AI \u670d\u52d9\u7121\u6cd5\u4f7f\u7528"]

_lock = Lock()


def _ensure_data_file() -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    if not MEALS_FILE.exists():
        MEALS_FILE.write_text("[]", encoding="utf-8")
    if not USER_MEALS_FILE.exists():
        USER_MEALS_FILE.write_text("[]", encoding="utf-8")


def load_meals() -> list[MealAnalysisResult]:
    _ensure_data_file()
    with _lock:
        base_meals = _read_meals_file(MEALS_FILE, strict=True)
        user_meals = _read_meals_file(USER_MEALS_FILE, strict=False)
    return _merge_meal_lists([*base_meals, *user_meals])


def save_meals(meals: list[MealAnalysisResult]) -> None:
    _ensure_data_file()
    payload = [meal.model_dump() for meal in meals]
    with _lock:
        MEALS_FILE.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def add_meal(meal: MealAnalysisResult) -> tuple[MealAnalysisResult, str]:
    validation_error = meal_storage_validation_error(meal)
    if validation_error:
        raise ValueError(validation_error)

    _ensure_data_file()
    with _lock:
        base_meals = _read_meals_file(MEALS_FILE, strict=True)
        user_meals = _read_meals_file(USER_MEALS_FILE, strict=False)
        incoming_key = normalize_meal_name_key(meal.mealName)
        user_by_name = {normalize_meal_name_key(item.mealName): item for item in user_meals}
        existing = user_by_name.get(incoming_key) or next(
            (item for item in base_meals if normalize_meal_name_key(item.mealName) == incoming_key),
            None,
        )

        action = "created"
        saved_meal = meal
        if existing:
            saved_meal = merge_meal(existing, meal)
            action = "merged"

        user_by_name[incoming_key] = saved_meal
        _write_user_meals(list(user_by_name.values()))
        return saved_meal, action


def normalize_meal_name_key(name: str) -> str:
    return " ".join(str(name or "").replace("\u3000", " ").strip().split()).lower()


def merge_meal(existing: MealAnalysisResult, incoming: MealAnalysisResult) -> MealAnalysisResult:
    update = existing.model_dump()
    if not update["mealName"].strip() or update["mealName"] == "\u7591\u4f3c\u9910\u9ede":
        update["mealName"] = incoming.mealName
    update["estimatedCalories"] = _merged_number(existing.estimatedCalories, incoming.estimatedCalories)
    update["estimatedProtein"] = _merged_number(existing.estimatedProtein, incoming.estimatedProtein)
    update["tags"] = _merge_unique(existing.tags, incoming.tags)
    update["mainIngredients"] = _merge_unique(existing.mainIngredients, incoming.mainIngredients)
    update["allergens"] = _merge_unique(existing.allergens, incoming.allergens)
    if _is_better_reason(incoming.recommendationReason, existing.recommendationReason):
        update["recommendationReason"] = incoming.recommendationReason
    update["confidence"] = min(max(existing.confidence, incoming.confidence, 0.5), 0.9)
    update["createdAt"] = existing.createdAt
    update["isAiGenerated"] = existing.isAiGenerated or incoming.isAiGenerated
    update["recommendedGoals"] = _merge_unique(existing.recommendedGoals, incoming.recommendedGoals)
    update["warningMessage"] = incoming.warningMessage or existing.warningMessage
    update["nutritionNote"] = incoming.nutritionNote or existing.nutritionNote
    return MealAnalysisResult.model_validate(update)


def _merged_number(existing: float, incoming: float) -> float:
    if incoming > 0 and existing <= 0:
        return incoming
    if incoming > 0 and existing > 0:
        return incoming
    return existing


def _merge_unique(left: list[str], right: list[str]) -> list[str]:
    values: list[str] = []
    for item in [*left, *right]:
        normalized = str(item).strip()
        if normalized and normalized not in values:
            values.append(normalized)
    return values


def _is_better_reason(incoming: str, existing: str) -> bool:
    if not incoming.strip():
        return False
    if _reason_has_engineering_text(incoming):
        return False
    if not existing.strip() or existing in GENERIC_REASON_TEMPLATES:
        return True
    return len(incoming) > len(existing)


def _reason_has_engineering_text(reason: str) -> bool:
    lowered = reason.lower()
    return any(token.lower() in lowered for token in FORBIDDEN_ENGINEERING_TOKENS)


def _read_meals_file(path: Path, strict: bool) -> list[MealAnalysisResult]:
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError):
        if strict:
            raise
        return []
    if not isinstance(raw, list):
        if strict:
            raise ValueError(f"{path} must contain a JSON array")
        return []
    meals: list[MealAnalysisResult] = []
    for item in raw:
        try:
            meals.append(MealAnalysisResult.model_validate(item))
        except Exception:
            if strict:
                raise
    return meals


def _write_user_meals(meals: list[MealAnalysisResult]) -> None:
    payload = [meal.model_dump() for meal in meals]
    USER_MEALS_FILE.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def _merge_meal_lists(meals: list[MealAnalysisResult]) -> list[MealAnalysisResult]:
    merged: dict[str, MealAnalysisResult] = {}
    order: list[str] = []
    for meal in meals:
        key = normalize_meal_name_key(meal.mealName)
        if not key:
            continue
        if key in merged:
            merged[key] = merge_meal(merged[key], meal)
        else:
            merged[key] = meal
            order.append(key)
    return [merged[key] for key in order]


def recommend_meals(
    health_goal: str,
    tags: list[str],
    excluded_ingredients: list[str],
    keyword: str | None,
) -> list[MealAnalysisResult]:
    normalized_keyword = (keyword or "").strip().lower()
    effective_excluded = list(excluded_ingredients)
    if "\u7d20\u98df" in tags:
        effective_excluded.extend(["\u8089\u985e", "\u6d77\u9bae"])

    results: list[MealAnalysisResult] = []
    for meal in load_meals():
        if not is_complete_meal(meal):
            continue
        searchable_text = _meal_search_text(meal)
        if ingredient_matches_exclusion(searchable_text, effective_excluded):
            continue

        matches_goal = _matches_health_goal(meal, health_goal)
        matches_tags = all(tag in meal.tags for tag in tags)
        matches_keyword = not normalized_keyword or normalized_keyword in searchable_text.lower()

        if matches_goal and matches_tags and matches_keyword:
            results.append(meal)

    return results


def normalize_avoid_ingredients(avoid_ingredients: list[str]) -> set[str]:
    terms: set[str] = set()
    for ingredient in avoid_ingredients:
        normalized = normalize_avoid_term(ingredient)
        if not normalized:
            continue
        terms.update({ingredient.strip(), normalized})
        for canonical, synonyms in CATEGORY_SYNONYMS.items():
            if normalized == canonical or normalized in synonyms or canonical in normalized:
                terms.update(synonyms)
                terms.add(canonical)
    return terms


def normalize_avoid_term(raw: str) -> str:
    normalized = raw.strip()
    for word in CONSTRAINT_WORDS:
        normalized = normalized.replace(word, "")
    return normalized.strip(" ：:，,。.;；、\t\r\n")


def ingredient_matches_exclusion(food_text: str, excluded: list[str]) -> bool:
    normalized_food_text = food_text.lower()
    return any(
        _term_matches_food_text(normalized_food_text, term)
        for term in normalize_avoid_ingredients(excluded)
    )


def _term_matches_food_text(food_text: str, term: str) -> bool:
    normalized = term.strip().lower()
    if not normalized:
        return False
    if len(normalized) < 2 and normalized not in SAFE_SHORT_TERMS:
        return False
    return normalized in food_text


def is_complete_meal(meal: MealAnalysisResult) -> bool:
    return meal_storage_validation_error(meal) is None


def meal_storage_validation_error(meal: MealAnalysisResult) -> str | None:
    if not meal.mealName.strip():
        return "餐點名稱不足"
    if meal.mealName.strip() in {"餐點", "食物", "料理", "綜合餐", "主餐", "系統辨識餐點"}:
        return "餐點名稱過於籠統，請提供明確名稱"
    if not meal.mealType.strip():
        return "餐點類型不足"
    if meal.estimatedCalories <= 0 and meal.mealType != "\u98f2\u54c1":
        return "熱量不是有效數值"
    if meal.estimatedProtein < 0:
        return "蛋白質不是有效數值"
    if not meal.tags:
        return "缺少餐點標籤"
    allows_limited_ingredients = bool((meal.warningMessage or "").strip() or (meal.nutritionNote or "").strip())
    if not meal.mainIngredients and not allows_limited_ingredients:
        return "缺少主要食材"
    if any(_has_invalid_ingredient_token(item) for item in meal.mainIngredients):
        return "缺少主要食材"
    reason = meal.recommendationReason.strip()
    if not reason or reason in GENERIC_REASON_TEMPLATES:
        return "推薦原因不完整"
    reason_lower = reason.lower()
    if any(token.lower() in reason_lower for token in FORBIDDEN_ENGINEERING_TOKENS):
        return "推薦原因不完整"
    return None


def _has_invalid_ingredient_token(value: str) -> bool:
    lowered = str(value or "").strip().lower()
    return not lowered or any(token.lower() in lowered for token in INVALID_INGREDIENT_TOKENS)


def _meal_search_text(meal: MealAnalysisResult) -> str:
    return " ".join(
        [
            meal.mealName,
            meal.mealType,
            meal.recommendationReason,
            *meal.tags,
            *meal.mainIngredients,
            *meal.allergens,
        ],
    )


def _matches_health_goal(meal: MealAnalysisResult, health_goal: str) -> bool:
    if not health_goal:
        return True
    profile = " ".join([meal.mealName, meal.mealType, *meal.tags])
    is_risky = any(token in profile for token in ["\u751c\u9ede", "\u9ad8\u7cd6", "\u70b8\u7269", "\u6cb9\u70b8", "\u9ad8\u8102\u80aa"])
    if health_goal == "\u6e1b\u8102":
        return not is_risky and (
            meal.estimatedCalories <= 500 or "\u4f4e\u5361" in meal.tags or "\u4f4e\u8102" in meal.tags
        )
    if health_goal == "\u589e\u808c":
        return meal.estimatedProtein >= 25 or "\u9ad8\u86cb\u767d" in meal.tags
    if health_goal == "\u5747\u8861\u98f2\u98df":
        return not is_risky and ("\u5065\u5eb7\u9910" in meal.tags or meal.estimatedProtein >= 15)
    if health_goal == "\u5065\u5eb7\u7dad\u6301":
        return not is_risky and (
            "\u5065\u5eb7\u9910" in meal.tags or "\u4f4e\u8102" in meal.tags or meal.estimatedCalories <= 550
        )
    return True
