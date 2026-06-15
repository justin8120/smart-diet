import math
import os
from typing import Any

import httpx
from fastapi import HTTPException

from app.models import NearbyPlace, NearbyPlacesResponse


GOOGLE_PLACES_SEARCH_TEXT_URL = "https://places.googleapis.com/v1/places:searchText"
DEFAULT_RADIUS_METERS = 1500
MAX_RESULTS = 5
LOW_RELEVANCE_MESSAGE = "附近找不到高度相關的店家，可嘗試放寬搜尋條件。"

GENERIC_QUERY_TERMS = {"中式", "日式", "點心", "麵食", "餐廳", "健康", "美食", "食物"}
POSITIVE_PLACE_TYPES = {"restaurant", "meal_takeaway", "bakery", "cafe", "food", "store"}
NEGATIVE_SOUP_DUMPLING_TERMS = {"麵", "鱔魚麵", "牛肉麵"}

PRECISE_MEAL_MAPPINGS: list[tuple[tuple[str, ...], str, tuple[str, ...]]] = [
    (("湯包", "小籠包"), "湯包 小籠包 包子", ("湯包", "小籠包", "包子")),
    (("包子", "饅頭"), "包子 饅頭 早餐", ("包子", "饅頭", "早餐")),
    (("豚丼", "丼飯"), "豚丼 日式丼飯 丼飯 日式料理", ("豚丼", "日式丼飯", "丼飯")),
    (("咖哩飯",), "咖哩飯 日式咖哩", ("咖哩飯", "日式咖哩")),
    (("拉麵",), "拉麵 日式拉麵", ("拉麵", "日式拉麵")),
    (("壽司",), "壽司 日式料理", ("壽司",)),
    (("雞胸肉", "雞胸肉餐盒", "健康餐"), "健康餐 雞胸肉餐盒", ("健康餐", "雞胸肉餐盒", "雞胸肉")),
    (("沙拉",), "沙拉 輕食 健康餐", ("沙拉", "輕食", "健康餐")),
    (("便當", "餐盒"), "便當 餐盒", ("便當", "餐盒")),
    (
        ("冰品", "甜點", "冰淇淋", "杜老爺"),
        "冰品 甜點 冰淇淋 便利商店 超市",
        ("冰品", "甜點", "冰淇淋", "便利商店", "超市"),
    ),
    (("飲料",), "飲料店 手搖飲", ("飲料店", "手搖飲", "飲料")),
    (("咖啡",), "咖啡廳", ("咖啡廳", "咖啡")),
    (("素食",), "素食餐廳", ("素食餐廳", "素食")),
    (("火鍋",), "火鍋", ("火鍋",)),
    (("早餐",), "早餐店", ("早餐店", "早餐")),
]


def build_nearby_query(meal_name: str, meal_type: str, tags: list[str]) -> str:
    meal_name = meal_name.strip()
    meal_type = meal_type.strip()
    tags = [tag.strip() for tag in tags if tag.strip()]

    precise_query = _precise_query_for(meal_name)
    if precise_query:
        return precise_query

    query_terms = _dedupe_terms(
        [
            meal_name,
            *[tag for tag in tags if tag not in GENERIC_QUERY_TERMS],
            meal_type if meal_type not in GENERIC_QUERY_TERMS else "",
        ]
    )
    if query_terms:
        return " ".join(query_terms)

    fallback_terms = _dedupe_terms([meal_name, *tags, meal_type])
    return " ".join(fallback_terms) if fallback_terms else "餐廳"


async def search_nearby_places(
    lat: float,
    lng: float,
    meal_name: str,
    meal_type: str,
    tags: list[str],
    radius_meters: int | None = None,
) -> NearbyPlacesResponse:
    query = build_nearby_query(meal_name, meal_type, tags)
    if os.getenv("NEARBY_PROVIDER", "google").strip().lower() != "google":
        raise HTTPException(status_code=503, detail="附近店家服務尚未設定。")

    api_key = os.getenv("GOOGLE_MAPS_API_KEY", "").strip()
    if not api_key:
        raise HTTPException(status_code=503, detail="附近店家服務尚未設定，請設定 GOOGLE_MAPS_API_KEY。")

    radius = radius_meters or _env_radius()
    payload = {
        "textQuery": query,
        "languageCode": "zh-TW",
        "regionCode": "TW",
        "locationBias": {
            "circle": {
                "center": {"latitude": lat, "longitude": lng},
                "radius": radius,
            },
        },
        "maxResultCount": MAX_RESULTS,
    }
    headers = {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": api_key,
        "X-Goog-FieldMask": (
            "places.displayName,places.formattedAddress,places.location,"
            "places.rating,places.types,places.googleMapsUri"
        ),
    }

    try:
        async with httpx.AsyncClient(timeout=10) as client:
            response = await client.post(GOOGLE_PLACES_SEARCH_TEXT_URL, json=payload, headers=headers)
            response.raise_for_status()
    except httpx.HTTPError as error:
        raise HTTPException(status_code=502, detail="目前無法取得附近店家，請稍後再試。") from error

    data = response.json()
    mapped_places = [_map_google_place(item, lat, lng) for item in data.get("places", [])]
    ranked_places = _rank_relevant_places(mapped_places, meal_name, query)
    if not ranked_places:
        return NearbyPlacesResponse(query=query, places=[], message=LOW_RELEVANCE_MESSAGE)

    return NearbyPlacesResponse(query=query, places=ranked_places[:MAX_RESULTS])


def _precise_query_for(text: str) -> str | None:
    for triggers, query, _keywords in PRECISE_MEAL_MAPPINGS:
        if any(trigger in text for trigger in triggers):
            return query
    return None


def _relevance_keywords_for(meal_name: str, query: str) -> set[str]:
    keywords = {term for term in [meal_name.strip(), *query.split()] if term and term not in GENERIC_QUERY_TERMS}
    for triggers, _query, mapping_keywords in PRECISE_MEAL_MAPPINGS:
        if any(trigger in meal_name or trigger in query for trigger in triggers):
            keywords.update(mapping_keywords)
    return keywords


def _rank_relevant_places(
    places: list[NearbyPlace],
    meal_name: str,
    query: str,
) -> list[NearbyPlace]:
    keywords = _relevance_keywords_for(meal_name, query)
    scored_places = [(place, _relevance_score(place, meal_name, keywords)) for place in places]
    relevant_places = [(place, score) for place, score in scored_places if score >= 4]
    relevant_places.sort(key=lambda item: item[1], reverse=True)
    return [place for place, _score in relevant_places]


def _relevance_score(place: NearbyPlace, meal_name: str, keywords: set[str]) -> int:
    score = 0
    place_name = place.name

    if meal_name and meal_name in place_name:
        score += 6
    score += sum(4 for keyword in keywords if keyword and keyword in place_name)

    if any(place_type in POSITIVE_PLACE_TYPES for place_type in place.types):
        score += 2

    is_soup_dumpling_search = {"湯包", "小籠包", "包子"} & keywords
    has_soup_dumpling_keyword = any(keyword in place_name for keyword in {"湯包", "小籠包", "包子"})
    has_noodle_keyword = any(term in place_name for term in NEGATIVE_SOUP_DUMPLING_TERMS)
    if is_soup_dumpling_search and has_noodle_keyword and not has_soup_dumpling_keyword:
        score -= 6

    return score


def _dedupe_terms(terms: list[str]) -> list[str]:
    seen: set[str] = set()
    result: list[str] = []
    for term in terms:
        normalized = term.strip()
        if not normalized or normalized in seen:
            continue
        seen.add(normalized)
        result.append(normalized)
    return result


def _env_radius() -> int:
    try:
        return int(os.getenv("GOOGLE_PLACES_RADIUS_METERS", str(DEFAULT_RADIUS_METERS)))
    except ValueError:
        return DEFAULT_RADIUS_METERS


def _map_google_place(place: dict[str, Any], lat: float, lng: float) -> NearbyPlace:
    location = place.get("location") if isinstance(place.get("location"), dict) else {}
    place_lat = _float_or_none(location.get("latitude"))
    place_lng = _float_or_none(location.get("longitude"))
    distance = (
        round(_haversine_distance_meters(lat, lng, place_lat, place_lng), 1)
        if place_lat is not None and place_lng is not None
        else None
    )
    display_name = place.get("displayName") if isinstance(place.get("displayName"), dict) else {}
    return NearbyPlace(
        name=str(display_name.get("text") or ""),
        address=str(place.get("formattedAddress") or ""),
        rating=_float_or_none(place.get("rating")),
        distanceMeters=distance,
        types=[str(item) for item in place.get("types", []) if str(item)],
        mapUrl=str(place.get("googleMapsUri") or ""),
    )


def _float_or_none(value: Any) -> float | None:
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _haversine_distance_meters(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    earth_radius_meters = 6_371_000
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    delta_phi = math.radians(lat2 - lat1)
    delta_lambda = math.radians(lng2 - lng1)
    a = (
        math.sin(delta_phi / 2) ** 2
        + math.cos(phi1) * math.cos(phi2) * math.sin(delta_lambda / 2) ** 2
    )
    return earth_radius_meters * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
