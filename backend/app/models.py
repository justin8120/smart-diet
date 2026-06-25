from typing import Literal

from pydantic import BaseModel, Field


SourceType = Literal["text", "image", "url"]


class MealAnalysisResult(BaseModel):
    id: str
    mealName: str
    mealType: str
    estimatedCalories: float
    estimatedProtein: float
    tags: list[str]
    mainIngredients: list[str]
    allergens: list[str]
    recommendationReason: str
    confidence: float = Field(ge=0, le=1)
    sourceType: SourceType
    createdAt: str
    isAiGenerated: bool
    recommendedGoals: list[str] = Field(default_factory=list)
    warningMessage: str | None = None
    nutritionNote: str | None = None


class MealUpsertResponse(BaseModel):
    meal: MealAnalysisResult
    action: Literal["created", "merged"]


class TextAnalyzeRequest(BaseModel):
    description: str | None = None
    text: str | None = None
    excludedIngredients: list[str] = Field(default_factory=list)

    @property
    def content(self) -> str:
        return self.description or self.text or ""


class UrlAnalyzeRequest(BaseModel):
    url: str | None = None
    excludedIngredients: list[str] = Field(default_factory=list)


class RecommendRequest(BaseModel):
    healthGoal: str
    tags: list[str]
    excludedIngredients: list[str]
    keyword: str | None = None
    userTextPreference: str | None = None
    queryHistory: list[dict[str, object]] = Field(default_factory=list)


class InterpretedNeeds(BaseModel):
    healthGoal: str
    preferredTags: list[str]
    excludedIngredients: list[str]
    notes: str


class RankedMeal(BaseModel):
    mealId: str
    mealName: str
    aiScore: int = Field(ge=0, le=100)
    matchedNeeds: list[str] = Field(default_factory=list)
    riskNotes: list[str] = Field(default_factory=list)
    explanation: str


class RecommendResponse(BaseModel):
    interpretedNeeds: InterpretedNeeds
    rankedMeals: list[RankedMeal]
    meals: list[MealAnalysisResult]
    usedAiRanking: bool
    fallbackMessage: str | None = None


class NearbyPlacesRequest(BaseModel):
    lat: float
    lng: float
    mealName: str
    mealType: str
    tags: list[str]
    userTextPreference: str | None = None
    healthGoal: str | None = None
    excludedIngredients: list[str] = Field(default_factory=list)
    radiusMeters: int | None = None


class NearbyPlace(BaseModel):
    name: str
    address: str
    rating: float | None = None
    distanceMeters: float | None = None
    openNow: bool | None = None
    types: list[str]
    mapUrl: str
    googleMapsUrl: str | None = None
    aiMapScore: int | None = Field(default=None, ge=0, le=100)
    matchedReasons: list[str] = Field(default_factory=list)
    riskNotes: list[str] = Field(default_factory=list)
    explanation: str | None = None


class NearbyPlacesResponse(BaseModel):
    query: str
    places: list[NearbyPlace]
    message: str | None = None
    fallbackUsed: bool = False
    fallbackMessage: str | None = None
    aiRankingUsed: bool = False
