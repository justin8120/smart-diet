"""Safe AI-assisted meal recommendation.

The candidate list passed to this module has already passed the hard allergy and
ingredient filter.  This module must therefore never add a meal on its own.
"""

import json
import re
from typing import Any

from openai import OpenAI

from app.models import MealAnalysisResult
from app.services.ai_provider import get_ai_provider


def interpret_needs(
    user_text_preference: str,
    health_goal: str,
    selected_tags: list[str],
    excluded_ingredients: list[str],
) -> dict[str, Any]:
    """A deterministic, testable baseline interpretation used by mock AI too."""
    text = user_text_preference.strip()
    tags = list(dict.fromkeys(selected_tags))
    exclusions = list(dict.fromkeys(excluded_ingredients))
    tag_terms = {"高蛋白", "低油", "低脂", "低卡", "健康餐", "素食", "少油", "無糖", "低鈉"}
    for term in tag_terms:
        if term in text and term not in tags:
            tags.append(term)
    for term in ["海鮮", "豬肉", "牛肉", "花生", "奶", "蛋", "辣", "麩質"]:
        if re.search(rf"(?:不要|不吃|避免|過敏|無){term}|{term}(?:過敏|禁忌)", text) and term not in exclusions:
            exclusions.append(term)
    inferred_goal = health_goal
    for goal in ["減脂", "增肌", "均衡飲食", "健康維持"]:
        if goal in text:
            inferred_goal = goal
            break
    notes = text or "使用者未提供額外自然語言需求。"
    return {
        "healthGoal": inferred_goal,
        "preferredTags": tags,
        "excludedIngredients": exclusions,
        "notes": notes,
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
    """Interpret needs and rank only the safe candidates supplied by the caller."""
    needs = interpret_needs(user_text_preference, health_goal, selected_tags, excluded_ingredients)
    provider = get_ai_provider()
    if provider.name == "mock":
        ranked = _rule_rank(candidate_meals, needs)
    else:
        ranked = _provider_rank(provider, candidate_meals, needs, query_history or [])
    allowed_ids = {meal.id for meal in candidate_meals}
    safe_ranked = [item for item in ranked if item.get("mealId") in allowed_ids]
    by_id = {meal.id: meal for meal in candidate_meals}
    # A malformed AI response cannot remove otherwise safe candidates or introduce new ones.
    returned_ids = {item["mealId"] for item in safe_ranked}
    safe_ranked.extend(_rule_rank([meal for meal in candidate_meals if meal.id not in returned_ids], needs))
    for item in safe_ranked:
        meal = by_id[item["mealId"]]
        item["mealName"] = meal.mealName
        item["aiScore"] = max(0, min(100, int(item.get("aiScore", 0))))
        item["matchedNeeds"] = [str(value) for value in item.get("matchedNeeds", []) if str(value).strip()]
        item["riskNotes"] = [str(value) for value in item.get("riskNotes", []) if str(value).strip()]
        item["explanation"] = str(item.get("explanation") or "符合已選擇的推薦條件。")
    return {"interpretedNeeds": needs, "rankedMeals": safe_ranked}


def _rule_rank(meals: list[MealAnalysisResult], needs: dict[str, Any]) -> list[dict[str, Any]]:
    preferred_tags = set(needs["preferredTags"])
    goal = needs["healthGoal"]
    ranked: list[dict[str, Any]] = []
    for meal in meals:
        matches = [tag for tag in meal.tags if tag in preferred_tags]
        if goal and goal in meal.recommendedGoals:
            matches.append(goal)
        score = 55 + min(24, len(matches) * 8)
        if "高蛋白" in preferred_tags:
            score += min(12, int(meal.estimatedProtein // 5))
        if goal == "減脂" and meal.estimatedCalories <= 500:
            score += 8
        risks = []
        profile = " ".join([meal.mealName, *meal.tags, *meal.mainIngredients])
        if any(term in profile for term in ["炸", "高糖", "甜點"]):
            risks.append("此餐點可能含較多油脂或糖分，請留意份量。")
            score -= 8
        explanation = "、".join(matches) or "符合基本健康餐點條件"
        ranked.append({
            "mealId": meal.id, "mealName": meal.mealName, "aiScore": score,
            "matchedNeeds": matches, "riskNotes": risks,
            "explanation": f"此餐點符合：{explanation}。",
        })
    return sorted(ranked, key=lambda item: item["aiScore"], reverse=True)


def _provider_rank(provider: Any, meals: list[MealAnalysisResult], needs: dict[str, Any], history: list[dict[str, Any]]) -> list[dict[str, Any]]:
    if not provider.api_key:
        raise RuntimeError("AI recommender is not configured")
    client = OpenAI(api_key=provider.api_key, base_url=provider.base_url) if provider.base_url else OpenAI(api_key=provider.api_key)
    response = client.chat.completions.create(
        model=provider.model,
        response_format={"type": "json_object"},
        messages=[
            {"role": "system", "content": "You rank meal candidates for a diet app. Return only JSON with rankedMeals. Never invent meals; use only mealId values supplied. Use Traditional Chinese for matchedNeeds, riskNotes and explanation."},
            {"role": "user", "content": json.dumps({"needs": needs, "queryHistory": history[-5:], "candidateMeals": [meal.model_dump() for meal in meals]}, ensure_ascii=False)},
        ],
    )
    content = response.choices[0].message.content
    if not content:
        raise RuntimeError("empty AI recommendation response")
    payload = json.loads(content)
    if not isinstance(payload.get("rankedMeals"), list):
        raise RuntimeError("invalid AI recommendation response")
    return [item for item in payload["rankedMeals"] if isinstance(item, dict)]
