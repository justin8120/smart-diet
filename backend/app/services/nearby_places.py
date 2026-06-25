import math
import os
from typing import Any

import httpx

from app.models import NearbyPlace, NearbyPlacesResponse
from app.services.map_recommender import (
    AI_MAP_FALLBACK_MESSAGE,
    build_place_query,
    rank_map_places,
)


GOOGLE_PLACES_SEARCH_TEXT_URL = "https://places.googleapis.com/v1/places:searchText"
DEFAULT_RADIUS_METERS = 1500
MAX_RESULTS = 5
MOCK_FALLBACK_MESSAGE = "目前使用示範店家資料，正式部署可接 Google Places API。"


def build_nearby_query(meal_name: str, meal_type: str, tags: list[str]) -> str:
    """Backward-compatible alias for older tests and callers."""

    profile = f"{meal_name} {meal_type} {' '.join(tags)}"
    if "雞胸肉健康餐" in meal_name:
        return "健康餐 雞胸肉餐盒"
    if "湯包" in meal_name:
        return "湯包 小籠包 包子"
    if "豚丼" in meal_name:
        return "豚丼 日式丼飯 丼飯 日式料理"
    if any(term in profile for term in ["杜老爺", "冰淇淋", "冰品"]):
        return "冰品 甜點 冰淇淋 便利商店 超市"
    return build_place_query(meal_name, meal_type, tags)


async def search_nearby_places(
    *,
    lat: float,
    lng: float,
    meal_name: str,
    meal_type: str,
    tags: list[str],
    user_text_preference: str | None = None,
    health_goal: str | None = None,
    excluded_ingredients: list[str] | None = None,
    radius_meters: int | None = None,
) -> NearbyPlacesResponse:
    excluded_ingredients = excluded_ingredients or []
    query = build_place_query(meal_name, meal_type, tags, user_text_preference)
    fallback_used = False
    fallback_message: str | None = None

    try:
        places = await _google_places(
            query=query,
            lat=lat,
            lng=lng,
            radius_meters=radius_meters or _env_radius(),
        )
    except Exception:
        places = _mock_places(meal_name, meal_type, tags, lat, lng)
        fallback_used = True
        fallback_message = MOCK_FALLBACK_MESSAGE

    ranked_places, ai_used, ai_fallback_message = rank_map_places(
        places=places,
        meal_name=meal_name,
        meal_type=meal_type,
        tags=tags,
        user_text_preference=user_text_preference,
        health_goal=health_goal,
        excluded_ingredients=excluded_ingredients,
    )
    message = fallback_message or ai_fallback_message
    if fallback_message and ai_fallback_message:
        message = f"{fallback_message} {AI_MAP_FALLBACK_MESSAGE}"

    return NearbyPlacesResponse(
        query=query,
        places=ranked_places[:MAX_RESULTS],
        message=message,
        fallbackUsed=fallback_used,
        fallbackMessage=message,
        aiRankingUsed=ai_used,
    )


async def _google_places(
    *,
    query: str,
    lat: float,
    lng: float,
    radius_meters: int,
) -> list[NearbyPlace]:
    if os.getenv("NEARBY_PROVIDER", "google").strip().lower() != "google":
        raise RuntimeError("Nearby provider is not Google Places.")

    api_key = os.getenv("GOOGLE_MAPS_API_KEY", "").strip()
    if not api_key:
        raise RuntimeError("GOOGLE_MAPS_API_KEY is not configured.")

    payload = {
        "textQuery": query,
        "languageCode": "zh-TW",
        "regionCode": "TW",
        "locationBias": {
            "circle": {
                "center": {"latitude": lat, "longitude": lng},
                "radius": radius_meters,
            },
        },
        "maxResultCount": MAX_RESULTS,
    }
    headers = {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": api_key,
        "X-Goog-FieldMask": (
            "places.displayName,places.formattedAddress,places.location,"
            "places.rating,places.types,places.googleMapsUri,places.currentOpeningHours"
        ),
    }

    async with httpx.AsyncClient(timeout=10) as client:
        response = await client.post(GOOGLE_PLACES_SEARCH_TEXT_URL, json=payload, headers=headers)
        response.raise_for_status()

    data = response.json()
    return [_map_google_place(item, lat, lng) for item in data.get("places", [])]


def _mock_places(
    meal_name: str,
    meal_type: str,
    tags: list[str],
    lat: float,
    lng: float,
) -> list[NearbyPlace]:
    profile = f"{meal_name} {meal_type} {' '.join(tags)}"
    if any(term in profile for term in ["甜點", "肉桂捲", "冰品", "咖啡"]):
        raw_places = [
            ("示範甜點咖啡廳", "台北市信義區甜點路 12 號", 4.6, 280, True, ["cafe", "bakery"]),
            ("示範手作烘焙", "台北市信義區烘焙巷 8 號", 4.3, 650, None, ["bakery", "food"]),
            ("示範便利商店", "台北市信義區市府路 1 號", 4.0, 900, True, ["store", "food"]),
        ]
    elif any(term in profile for term in ["雞排", "小吃", "鹽酥雞"]):
        raw_places = [
            ("示範鹽酥雞小吃", "台北市信義區小吃街 3 號", 4.4, 420, True, ["restaurant", "meal_takeaway"]),
            ("示範雞排店", "台北市信義區夜市路 18 號", 4.1, 760, None, ["restaurant", "food"]),
        ]
    else:
        raw_places = [
            ("示範健康餐盒店", "台北市信義區健康路 1 號", 4.5, 350, True, ["restaurant", "meal_takeaway"]),
            ("示範高蛋白便當", "台北市信義區餐盒路 2 號", 4.2, 720, None, ["restaurant", "food"]),
            ("示範沙拉健康餐", "台北市信義區蔬食街 5 號", 4.4, 980, True, ["restaurant", "food"]),
        ]

    return [
        NearbyPlace(
            name=name,
            address=address,
            rating=rating,
            distanceMeters=distance,
            openNow=open_now,
            types=types,
            mapUrl=f"https://www.google.com/maps/search/?api=1&query={lat},{lng}",
            googleMapsUrl=f"https://www.google.com/maps/search/?api=1&query={lat},{lng}",
        )
        for name, address, rating, distance, open_now, types in raw_places
    ]


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
        round(_haversine_distance_meters(lat, lng, place_lat, place_lng))
        if place_lat is not None and place_lng is not None
        else None
    )
    display_name = place.get("displayName") if isinstance(place.get("displayName"), dict) else {}
    opening_hours = (
        place.get("currentOpeningHours") if isinstance(place.get("currentOpeningHours"), dict) else {}
    )
    maps_url = str(place.get("googleMapsUri") or "")
    return NearbyPlace(
        name=str(display_name.get("text") or ""),
        address=str(place.get("formattedAddress") or ""),
        rating=_float_or_none(place.get("rating")),
        distanceMeters=distance,
        openNow=opening_hours.get("openNow") if isinstance(opening_hours.get("openNow"), bool) else None,
        types=[str(item) for item in place.get("types", []) if str(item)],
        mapUrl=maps_url,
        googleMapsUrl=maps_url,
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


def _rank_relevant_places(
    places: list[NearbyPlace],
    meal_name: str,
    query: str,
) -> list[NearbyPlace]:
    """Backward-compatible simple ranking used by legacy tests."""

    keywords = [term for term in [meal_name, *query.split()] if term.strip()]
    scored = [
        (
            place,
            sum(1 for keyword in keywords if keyword in place.name),
        )
        for place in places
    ]
    relevant = [(place, score) for place, score in scored if score > 0]
    return [
        place
        for place, _score in sorted(
            relevant,
            key=lambda item: (item[1], item[0].rating or 0, -(item[0].distanceMeters or 999999)),
            reverse=True,
        )
    ]
