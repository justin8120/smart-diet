import json
import re
from typing import Any

from openai import OpenAI

from app.models import NearbyPlace
from app.services.ai_provider import get_ai_provider


MENU_CONFIRMATION_RISK = "實際菜單與食材仍需以店家現場或官方資訊為準。"
AI_MAP_FALLBACK_MESSAGE = "AI 店家排序暫時不可用，已改用基本距離與評分排序。"


def build_place_query(
    meal_name: str,
    meal_type: str,
    tags: list[str],
    user_preference: str | None = None,
) -> str:
    """Build a Google Places text query from meal context.

    Excluded ingredients are intentionally not accepted here so they cannot leak
    into search keywords.
    """

    profile = f"{meal_name} {meal_type} {' '.join(tags)} {user_preference or ''}"
    terms: list[str] = []

    if "雞胸" in meal_name and _contains_any(profile, ["健康餐", "高蛋白", "減脂", "低油"]):
        terms.extend(["雞胸肉", "健康餐"])
    elif "炸雞排" in meal_name or ("雞排" in meal_name and "炸" in profile):
        terms.extend(["雞排", "鹽酥雞", "小吃"])
    elif "牛肉麵" in meal_name:
        terms.append("牛肉麵")
    elif _contains_any(meal_name, ["鮮蝦蔬菜碗", "蝦仁蔬菜碗", "蝦蔬菜碗"]):
        terms.extend(["健康餐", "蔬菜碗", "蝦仁"])
    elif "肉桂捲" in meal_name:
        terms.extend(["肉桂捲", "甜點", "咖啡廳"])
    else:
        terms.append(meal_name.strip())

    if "健康餐" in meal_type:
        terms.extend(["健康餐", "餐盒"])
    if "高蛋白" in tags:
        terms.append("高蛋白")
    if _contains_any(meal_type, ["甜點", "冰品", "點心"]):
        terms.extend(["甜點", "咖啡廳"])
    if "小吃" in meal_type:
        terms.append("小吃")

    return " ".join(_dedupe([term for term in terms if term.strip()])) or "附近餐廳"


def rank_map_places(
    *,
    places: list[NearbyPlace],
    meal_name: str,
    meal_type: str,
    tags: list[str],
    user_text_preference: str | None,
    health_goal: str | None,
    excluded_ingredients: list[str],
) -> tuple[list[NearbyPlace], bool, str | None]:
    if not places:
        return [], False, None

    rule_ranked = _rule_rank_places(
        places=places,
        meal_name=meal_name,
        meal_type=meal_type,
        tags=tags,
        user_text_preference=user_text_preference,
        health_goal=health_goal,
        excluded_ingredients=excluded_ingredients,
    )

    provider = get_ai_provider()
    if provider.name == "mock" or not provider.configured:
        return rule_ranked, False, None

    try:
        ai_ranked = _provider_rank_places(
            provider=provider,
            rule_ranked=rule_ranked,
            meal_name=meal_name,
            meal_type=meal_type,
            tags=tags,
            user_text_preference=user_text_preference,
            health_goal=health_goal,
            excluded_ingredients=excluded_ingredients,
        )
        return ai_ranked, True, None
    except Exception:
        return rule_ranked, False, AI_MAP_FALLBACK_MESSAGE


def _rule_rank_places(
    *,
    places: list[NearbyPlace],
    meal_name: str,
    meal_type: str,
    tags: list[str],
    user_text_preference: str | None,
    health_goal: str | None,
    excluded_ingredients: list[str],
) -> list[NearbyPlace]:
    return sorted(
        [
            _score_place(
                place,
                meal_name=meal_name,
                meal_type=meal_type,
                tags=tags,
                user_text_preference=user_text_preference,
                health_goal=health_goal,
                excluded_ingredients=excluded_ingredients,
            )
            for place in places
        ],
        key=lambda place: (place.aiMapScore or 0, -(place.distanceMeters or 999999)),
        reverse=True,
    )


def _score_place(
    place: NearbyPlace,
    *,
    meal_name: str,
    meal_type: str,
    tags: list[str],
    user_text_preference: str | None,
    health_goal: str | None,
    excluded_ingredients: list[str],
) -> NearbyPlace:
    score = 35
    matched: list[str] = []
    risks = [MENU_CONFIRMATION_RISK]
    profile = f"{place.name} {place.address} {' '.join(place.types)}"
    meal_profile = f"{meal_name} {meal_type} {' '.join(tags)} {user_text_preference or ''} {health_goal or ''}"

    if place.distanceMeters is not None:
        if place.distanceMeters <= 500:
            score += 20
            matched.append("距離近")
        elif place.distanceMeters <= 1500:
            score += 12
            matched.append("距離在可接受範圍")

    if place.rating is not None:
        if place.rating >= 4.3:
            score += 20
            matched.append("評分高")
        elif place.rating >= 4.0:
            score += 14
            matched.append("評分良好")

    if _place_matches_meal(profile, meal_profile):
        score += 25
        matched.append("店家類型符合餐點")

    if _matches_health_goal(meal_profile, profile, health_goal):
        score += 20
        matched.append(f"符合{health_goal or '健康'}需求")

    if place.openNow is True:
        score += 10
        matched.append("目前營業中")
    elif place.openNow is None:
        matched.append("營業狀態未知")

    if _may_conflict_with_exclusions(profile, excluded_ingredients):
        score -= 40
        risks.append("店名或類型可能與禁忌食材相關，請確認菜單。")
    elif excluded_ingredients:
        risks.append(f"是否完全不含{ '、'.join(excluded_ingredients) }仍需向店家確認。")

    score = max(0, min(100, score))
    explanation = _rule_explanation(place, matched, excluded_ingredients, meal_type, tags, health_goal)
    return place.model_copy(
        update={
            "aiMapScore": score,
            "matchedReasons": matched or ["與查詢餐點相關"],
            "riskNotes": _dedupe(risks),
            "explanation": explanation,
            "googleMapsUrl": place.googleMapsUrl or place.mapUrl,
        }
    )


def _provider_rank_places(
    *,
    provider: Any,
    rule_ranked: list[NearbyPlace],
    meal_name: str,
    meal_type: str,
    tags: list[str],
    user_text_preference: str | None,
    health_goal: str | None,
    excluded_ingredients: list[str],
) -> list[NearbyPlace]:
    client_kwargs: dict[str, str] = {"api_key": provider.api_key or ""}
    if provider.base_url:
        client_kwargs["base_url"] = provider.base_url
    client = OpenAI(**client_kwargs)
    response = client.chat.completions.create(
        model=provider.model,
        response_format={"type": "json_object"},
        messages=[
            {
                "role": "system",
                "content": (
                    "你是繁體中文的飲食地圖推薦助理。只能重新排序使用者提供的店家，"
                    "不可保證店家一定有該餐點。每個店家都要提醒實際菜單與食材仍需確認。"
                ),
            },
            {
                "role": "user",
                "content": json.dumps(
                    {
                        "mealName": meal_name,
                        "mealType": meal_type,
                        "tags": tags,
                        "userTextPreference": user_text_preference,
                        "healthGoal": health_goal,
                        "excludedIngredients": excluded_ingredients,
                        "places": [place.model_dump() for place in rule_ranked],
                        "requiredSchema": {
                            "places": [
                                {
                                    "name": "原店名",
                                    "aiMapScore": 0,
                                    "matchedReasons": ["理由"],
                                    "riskNotes": [MENU_CONFIRMATION_RISK],
                                    "explanation": "繁體中文一句話",
                                }
                            ]
                        },
                    },
                    ensure_ascii=False,
                ),
            },
        ],
        temperature=0.2,
    )
    payload = json.loads(response.choices[0].message.content or "{}")
    ai_items = payload.get("places") if isinstance(payload, dict) else []
    if not isinstance(ai_items, list):
        raise ValueError("Invalid AI map ranking payload")

    by_name = {place.name: place for place in rule_ranked}
    ranked: list[NearbyPlace] = []
    used_names: set[str] = set()
    for item in ai_items:
        if not isinstance(item, dict):
            continue
        name = str(item.get("name") or "")
        base = by_name.get(name)
        if not base or name in used_names:
            continue
        risk_notes = [str(note) for note in item.get("riskNotes", []) if str(note).strip()]
        if MENU_CONFIRMATION_RISK not in risk_notes:
            risk_notes.append(MENU_CONFIRMATION_RISK)
        ranked.append(
            base.model_copy(
                update={
                    "aiMapScore": _bounded_score(item.get("aiMapScore"), base.aiMapScore or 60),
                    "matchedReasons": [
                        str(reason) for reason in item.get("matchedReasons", []) if str(reason).strip()
                    ]
                    or base.matchedReasons,
                    "riskNotes": _dedupe(risk_notes),
                    "explanation": str(item.get("explanation") or base.explanation or ""),
                    "googleMapsUrl": base.googleMapsUrl or base.mapUrl,
                }
            )
        )
        used_names.add(name)

    ranked.extend(place for place in rule_ranked if place.name not in used_names)
    return ranked


def _place_matches_meal(place_profile: str, meal_profile: str) -> bool:
    checks = [
        ("健康餐" in meal_profile and _contains_any(place_profile, ["健康", "餐盒", "便當", "沙拉"])),
        ("高蛋白" in meal_profile and _contains_any(place_profile, ["健康", "餐盒", "健身", "便當"])),
        ("甜點" in meal_profile and _contains_any(place_profile, ["甜點", "咖啡", "蛋糕", "烘焙"])),
        ("咖啡" in meal_profile and _contains_any(place_profile, ["咖啡", "甜點"])),
        ("小吃" in meal_profile and _contains_any(place_profile, ["小吃", "鹽酥雞", "雞排"])),
        ("牛肉麵" in meal_profile and "牛肉麵" in place_profile),
        ("雞排" in meal_profile and _contains_any(place_profile, ["雞排", "鹽酥雞"])),
    ]
    return any(checks)


def _matches_health_goal(meal_profile: str, place_profile: str, health_goal: str | None) -> bool:
    combined = f"{meal_profile} {place_profile}"
    if health_goal == "減脂":
        return _contains_any(combined, ["健康餐", "高蛋白", "低油", "低脂", "餐盒", "沙拉"])
    if health_goal == "增肌":
        return _contains_any(combined, ["高蛋白", "雞胸", "牛肉", "健康餐", "餐盒"])
    return _contains_any(combined, ["健康餐", "均衡", "低油", "蔬菜"])


def _may_conflict_with_exclusions(place_profile: str, excluded_ingredients: list[str]) -> bool:
    lower_profile = place_profile.lower()
    for excluded in excluded_ingredients:
        term = excluded.strip()
        if not term:
            continue
        if term in place_profile:
            return True
        if term == "海鮮" and _contains_any(place_profile, ["海鮮", "蝦", "魚", "蟹", "sushi"]):
            return True
        if term == "牛肉" and _contains_any(place_profile, ["牛肉", "beef"]):
            return True
        if term == "豬肉" and _contains_any(place_profile, ["豬", "pork"]):
            return True
        if term.lower() in lower_profile:
            return True
    return False


def _rule_explanation(
    place: NearbyPlace,
    matched: list[str],
    excluded_ingredients: list[str],
    meal_type: str,
    tags: list[str],
    health_goal: str | None,
) -> str:
    need_text = "、".join(_dedupe([health_goal or "", *tags])) or "目前飲食需求"
    base = f"此店距離與評分表現適合參考，店家類型接近{meal_type or '目標餐點'}，較符合{need_text}。"
    if excluded_ingredients:
        return f"{base} 但是否完全不含{'、'.join(excluded_ingredients)}仍需以店家菜單為準。"
    if place.openNow is False:
        return f"{base} 目前可能未營業，建議出發前再確認。"
    if "目前營業中" in matched:
        return f"{base} 目前顯示營業中，適合作為附近用餐選項。"
    return f"{base} 實際供應品項仍建議出發前確認。"


def _bounded_score(value: object, fallback: int) -> int:
    try:
        return max(0, min(100, int(value)))
    except (TypeError, ValueError):
        return fallback


def _contains_any(text: str, terms: list[str]) -> bool:
    return any(term in text for term in terms)


def _dedupe(values: list[str]) -> list[str]:
    result: list[str] = []
    seen: set[str] = set()
    for value in values:
        normalized = re.sub(r"\s+", " ", str(value).strip())
        if not normalized or normalized in seen:
            continue
        seen.add(normalized)
        result.append(normalized)
    return result
