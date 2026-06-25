"""Safe AI-assisted meal recommendation.

The candidate list passed to this module has already passed the hard allergy and
ingredient filter. This module must never add a meal on its own.
"""

import json
import re
from typing import Any

from openai import OpenAI

from app.models import MealAnalysisResult
from app.services.ai_provider import get_ai_provider


DEFAULT_EXPLANATION = "此餐點符合目前的飲食需求，可作為推薦選項。"


def normalize_ai_score(value: Any, fallback_score: int) -> int:
    """Return a bounded numeric score, using fallback when AI omitted it."""

    if value is None or value == "":
        return _clamp_score(fallback_score)
    if isinstance(value, str):
        match = re.search(r"-?\d+(?:\.\d+)?", value)
        if not match:
            return _clamp_score(fallback_score)
        value = match.group(0)
    try:
        return _clamp_score(round(float(value)))
    except (TypeError, ValueError):
        return _clamp_score(fallback_score)


def normalize_string_list(value: Any) -> list[str]:
    """Normalize AI list-ish values without splitting full sentences by char."""

    if value is None:
        return []
    if isinstance(value, list):
        return _dedupe([_clean_text(item) for item in value if _clean_text(item)])
    if isinstance(value, tuple | set):
        return _dedupe([_clean_text(item) for item in value if _clean_text(item)])
    if isinstance(value, str):
        text = _clean_text(value)
        if not text:
            return []
        quoted = re.findall(r"[「『\"]([^」』\"]+)[」』\"]", text)
        if quoted:
            return _dedupe([_clean_text(item) for item in quoted if _clean_text(item)])
        if re.search(r"[、,，/；;]", text):
            return _dedupe([_clean_text(item) for item in re.split(r"[、,，/；;]", text) if _clean_text(item)])

        known_terms = [
            "高蛋白",
            "低油",
            "低脂",
            "低卡",
            "減脂",
            "增肌",
            "均衡飲食",
            "健康餐",
            "不含海鮮",
            "無海鮮",
        ]
        extracted = [term for term in known_terms if term in text]
        if extracted:
            return _dedupe(extracted)
        return [text] if len(text) <= 12 else []
    return [_clean_text(value)] if _clean_text(value) else []


def calculate_recommendation_score(meal: MealAnalysisResult, interpreted_needs: dict[str, Any]) -> int:
    score = 50
    profile = _meal_profile(meal)
    needs_text = " ".join(
        [
            str(interpreted_needs.get("healthGoal") or ""),
            str(interpreted_needs.get("notes") or ""),
            " ".join(normalize_string_list(interpreted_needs.get("preferredTags"))),
        ]
    )
    preferred_tags = set(normalize_string_list(interpreted_needs.get("preferredTags")))
    goal = str(interpreted_needs.get("healthGoal") or "")

    if ("高蛋白" in preferred_tags or "高蛋白" in needs_text) and _is_high_protein(meal):
        score += 20
    if "減脂" in goal or "減脂" in preferred_tags or "減脂" in needs_text:
        if _is_weight_loss_friendly(meal):
            score += 15
    if 250 <= meal.estimatedCalories <= 650:
        score += 10
    if any(term in profile for term in ["炸", "油炸", "高油", "高脂", "奶油", "甜點", "高糖"]):
        score -= 20
    if _conflicts_with_exclusions(profile, normalize_string_list(interpreted_needs.get("excludedIngredients"))):
        score -= 40
    return _clamp_score(score)


def interpret_needs(
    user_text_preference: str,
    health_goal: str,
    selected_tags: list[str],
    excluded_ingredients: list[str],
) -> dict[str, Any]:
    text = (user_text_preference or "").strip()
    tags = _dedupe([*selected_tags])
    exclusions = _dedupe([*excluded_ingredients])

    tag_terms = ["高蛋白", "低油", "低脂", "低卡", "健康餐", "低糖", "高纖"]
    for term in tag_terms:
        if term in text and term not in tags:
            tags.append(term)

    exclusion_terms = ["海鮮", "蝦", "魚", "蟹", "豬肉", "牛肉", "花生", "奶", "蛋", "麩質"]
    for term in exclusion_terms:
        if re.search(rf"(不要|不吃|避免|排除|過敏|無|不含).{{0,6}}{re.escape(term)}", text) and term not in exclusions:
            exclusions.append("海鮮" if term in ["蝦", "魚", "蟹"] else term)

    inferred_goal = health_goal
    for goal in ["減脂", "增肌", "均衡飲食", "健康維持"]:
        if goal in text:
            inferred_goal = goal
            break

    notes = text or "使用者未提供額外自然語言需求。"
    return {
        "healthGoal": inferred_goal,
        "preferredTags": _dedupe(tags),
        "excludedIngredients": _dedupe(exclusions),
        "notes": _clean_text(notes),
    }


def rank_meals(
    *,
    user_text_preference: str,
    health_goal: str,
    selected_tags: list[str],
    excluded_ingredients: list[str],
    candidate_meals: list[MealAnalysisResult],
    query_history: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    needs = interpret_needs(user_text_preference, health_goal, selected_tags, excluded_ingredients)
    rule_ranked = _rule_rank(candidate_meals, needs)
    rule_by_id = {item["mealId"]: item for item in rule_ranked}

    provider = get_ai_provider()
    if provider.name == "mock":
        ranked = rule_ranked
    else:
        ranked = _provider_rank(provider, candidate_meals, needs, query_history or [])

    allowed_ids = {meal.id for meal in candidate_meals}
    by_id = {meal.id: meal for meal in candidate_meals}
    safe_ranked: list[dict[str, Any]] = []
    seen_ids: set[str] = set()
    for raw_item in ranked:
        meal_id = str(raw_item.get("mealId") or "")
        if meal_id not in allowed_ids or meal_id in seen_ids:
            continue
        fallback = rule_by_id.get(meal_id, {})
        meal = by_id[meal_id]
        safe_ranked.append(_normalize_ranked_item(raw_item, meal, needs, fallback))
        seen_ids.add(meal_id)

    for meal in candidate_meals:
        if meal.id not in seen_ids:
            safe_ranked.append(rule_by_id[meal.id])

    return {
        "interpretedNeeds": {
            "healthGoal": _clean_text(needs.get("healthGoal")),
            "preferredTags": normalize_string_list(needs.get("preferredTags")),
            "excludedIngredients": normalize_string_list(needs.get("excludedIngredients")),
            "notes": _clean_text(needs.get("notes")),
        },
        "rankedMeals": sorted(safe_ranked, key=lambda item: item["aiScore"], reverse=True),
    }


def _rule_rank(meals: list[MealAnalysisResult], needs: dict[str, Any]) -> list[dict[str, Any]]:
    ranked: list[dict[str, Any]] = []
    preferred_tags = set(normalize_string_list(needs.get("preferredTags")))
    goal = str(needs.get("healthGoal") or "")
    exclusions = normalize_string_list(needs.get("excludedIngredients"))

    for meal in meals:
        score = calculate_recommendation_score(meal, needs)
        matched = _matched_needs(meal, preferred_tags, goal, exclusions)
        risks = _risk_notes(meal, exclusions)
        ranked.append(
            {
                "mealId": meal.id,
                "mealName": meal.mealName,
                "aiScore": score,
                "matchedNeeds": matched,
                "riskNotes": risks,
                "explanation": _rule_explanation(meal, matched, risks),
            }
        )
    return sorted(ranked, key=lambda item: item["aiScore"], reverse=True)


def _provider_rank(
    provider: Any,
    meals: list[MealAnalysisResult],
    needs: dict[str, Any],
    history: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    if not provider.api_key:
        raise RuntimeError("AI recommender is not configured")
    client = (
        OpenAI(api_key=provider.api_key, base_url=provider.base_url)
        if provider.base_url
        else OpenAI(api_key=provider.api_key)
    )
    response = client.chat.completions.create(
        model=provider.model,
        response_format={"type": "json_object"},
        messages=[
            {
                "role": "system",
                "content": (
                    "You rank meal candidates for a diet app. Return only JSON with rankedMeals. "
                    "Never invent meals; use only mealId values supplied. aiScore must be 0-100. "
                    "Use Traditional Chinese for matchedNeeds, riskNotes and explanation."
                ),
            },
            {
                "role": "user",
                "content": json.dumps(
                    {
                        "needs": needs,
                        "queryHistory": history[-5:],
                        "candidateMeals": [meal.model_dump() for meal in meals],
                    },
                    ensure_ascii=False,
                ),
            },
        ],
    )
    content = response.choices[0].message.content
    if not content:
        raise RuntimeError("empty AI recommendation response")
    payload = json.loads(content)
    if not isinstance(payload.get("rankedMeals"), list):
        raise RuntimeError("invalid AI recommendation response")
    return [item for item in payload["rankedMeals"] if isinstance(item, dict)]


def _normalize_ranked_item(
    raw_item: dict[str, Any],
    meal: MealAnalysisResult,
    needs: dict[str, Any],
    fallback: dict[str, Any],
) -> dict[str, Any]:
    fallback_score = int(fallback.get("aiScore") or calculate_recommendation_score(meal, needs))
    matched = normalize_string_list(raw_item.get("matchedNeeds")) or normalize_string_list(
        fallback.get("matchedNeeds")
    )
    if raw_item.get("aiScore") in (None, "") and {"高蛋白", "減脂"}.issubset(set(matched)):
        fallback_score = max(fallback_score, 85)
    risks = normalize_string_list(raw_item.get("riskNotes")) or normalize_string_list(
        fallback.get("riskNotes")
    )
    return {
        "mealId": meal.id,
        "mealName": meal.mealName,
        "aiScore": normalize_ai_score(raw_item.get("aiScore"), fallback_score),
        "matchedNeeds": matched,
        "riskNotes": risks,
        "explanation": _clean_text(raw_item.get("explanation")) or fallback.get("explanation") or DEFAULT_EXPLANATION,
    }


def _matched_needs(
    meal: MealAnalysisResult,
    preferred_tags: set[str],
    goal: str,
    exclusions: list[str],
) -> list[str]:
    profile = _meal_profile(meal)
    matched: list[str] = []
    for tag in preferred_tags:
        if tag in meal.tags or tag in profile:
            matched.append(tag)
    if "高蛋白" in preferred_tags and _is_high_protein(meal):
        matched.append("高蛋白")
    if goal == "減脂" and _is_weight_loss_friendly(meal):
        matched.append("減脂")
    if exclusions and not _conflicts_with_exclusions(profile, exclusions):
        matched.append(f"不含{'、'.join(exclusions)}")
    return _dedupe(matched)


def _risk_notes(meal: MealAnalysisResult, exclusions: list[str]) -> list[str]:
    profile = _meal_profile(meal)
    risks: list[str] = []
    if any(term in profile for term in ["炸", "油炸", "高油", "高脂", "高糖", "甜點"]):
        risks.append("此餐點可能較油或糖分較高，建議控制份量。")
    if _conflicts_with_exclusions(profile, exclusions):
        risks.append("可能包含使用者排除的食材，請再次確認。")
    return risks


def _rule_explanation(meal: MealAnalysisResult, matched: list[str], risks: list[str]) -> str:
    matched_text = "、".join(matched) if matched else "目前條件"
    if risks:
        return f"此餐點部分符合{matched_text}，但仍有風險提醒，建議確認實際食材。"
    return f"此餐點蛋白質與熱量表現符合{matched_text}需求，且未發現明顯禁忌食材衝突。"


def _meal_profile(meal: MealAnalysisResult) -> str:
    return " ".join(
        [
            meal.mealName,
            meal.mealType,
            *meal.tags,
            *meal.mainIngredients,
            *meal.allergens,
            *meal.recommendedGoals,
            meal.recommendationReason,
        ]
    )


def _is_high_protein(meal: MealAnalysisResult) -> bool:
    return meal.estimatedProtein >= 20 or "高蛋白" in meal.tags


def _is_weight_loss_friendly(meal: MealAnalysisResult) -> bool:
    profile = _meal_profile(meal)
    return (
        meal.estimatedCalories <= 650
        and not any(term in profile for term in ["炸", "油炸", "高油", "高脂", "高糖"])
    )


def _conflicts_with_exclusions(profile: str, exclusions: list[str]) -> bool:
    for excluded in exclusions:
        if excluded and excluded in profile:
            return True
        if excluded == "海鮮" and any(term in profile for term in ["海鮮", "蝦", "魚", "蟹", "貝"]):
            return True
    return False


def _clean_text(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, list | tuple | set):
        value = "、".join(str(item) for item in value if str(item).strip())
    text = str(value).strip()
    text = text.strip("`")
    text = re.sub(r"^```(?:json)?|```$", "", text).strip()
    text = text.strip('"')
    text = text.replace("\\n", " ")
    text = re.sub(r"\s+", " ", text)
    return text


def _dedupe(values: list[str]) -> list[str]:
    result: list[str] = []
    seen: set[str] = set()
    for value in values:
        text = _clean_text(value)
        if not text or text in seen:
            continue
        seen.add(text)
        result.append(text)
    return result


def _clamp_score(score: int | float) -> int:
    return max(0, min(100, int(score)))
