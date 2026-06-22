import type { Allergen, DietTag, HealthGoal, Meal, MealGoal, MealSourceType } from "./mealData"

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8000"

export type BackendHealth = {
  status: string
  aiProvider: string
  aiConfigured: boolean
  model: string
  fallbackEnabled: boolean
}

export type BackendMeal = {
  id: string
  mealName: string
  mealType: string
  estimatedCalories: number
  estimatedProtein: number
  tags: string[]
  mainIngredients: string[]
  allergens: string[]
  recommendationReason: string
  confidence: number
  sourceType: "text" | "image" | "url"
  createdAt: string
  isAiGenerated: boolean
  recommendedGoals?: string[]
  suitableGoals?: string[]
  goals?: string[]
  warningMessage?: string
  nutritionNote?: string
}

type FlexibleBackendMeal = Partial<BackendMeal> & {
  name?: string
  type?: string
  calories?: number
  protein?: number
  dietTags?: string[]
  ingredients?: string[]
  reason?: string
  warningMessage?: string
  nutritionNote?: string
}

export type MealUpsertResponse = {
  meal: BackendMeal
  action: "created" | "merged"
}

export type RecommendPayload = {
  healthGoal: HealthGoal
  tags: DietTag[]
  excludedIngredients: Allergen[]
  keyword: string | null
}

export type NearbyPlace = {
  name: string
  address: string
  rating: number | null
  distanceMeters: number | null
  types: string[]
  mapUrl: string
}

export type NearbyPlacesResponse = {
  query: string
  places: NearbyPlace[]
  message?: string | null
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    headers: options?.body instanceof FormData ? undefined : { "Content-Type": "application/json" },
    ...options,
  })

  if (!response.ok) {
    const payload = await response.json().catch(() => null)
    const message = payload?.detail ?? "AI 後端尚未啟動，請先啟動 FastAPI server。"
    throw new Error(message)
  }

  return response.json() as Promise<T>
}

export function backendMealToMeal(meal: FlexibleBackendMeal): Meal {
  const sourceType = meal.sourceType ?? "text"
  return {
    id: meal.id ?? crypto.randomUUID(),
    name: meal.mealName ?? meal.name ?? "",
    type: meal.mealType ?? meal.type ?? "",
    calories: meal.estimatedCalories ?? meal.calories ?? 0,
    protein: meal.estimatedProtein ?? meal.protein ?? 0,
    tags: ((meal.tags ?? meal.dietTags ?? []) as DietTag[]).filter(Boolean),
    goals: backendGoals(meal),
    ingredients: meal.mainIngredients ?? meal.ingredients ?? [],
    allergens: (meal.allergens ?? []) as Allergen[],
    reason: meal.recommendationReason ?? meal.reason ?? "",
    confidence: meal.confidence ?? 0.55,
    warningMessage: meal.warningMessage,
    nutritionNote: meal.nutritionNote,
    sourceType: sourceTypeLabel(sourceType),
    createdAt: meal.createdAt,
    isAiGenerated: meal.isAiGenerated ?? true,
  }
}

export function mealToBackendMeal(meal: Meal): BackendMeal {
  return {
    id: meal.id,
    mealName: meal.name,
    mealType: meal.type,
    estimatedCalories: meal.calories,
    estimatedProtein: meal.protein,
    tags: meal.tags,
    mainIngredients: meal.ingredients,
    allergens: meal.allergens,
    recommendationReason: meal.reason,
    confidence: meal.confidence ?? 0.8,
    warningMessage: meal.warningMessage,
    nutritionNote: meal.nutritionNote,
    sourceType: sourceTypeValue(meal.sourceType),
    createdAt: meal.createdAt ?? new Date().toISOString(),
    isAiGenerated: meal.isAiGenerated ?? true,
    recommendedGoals: meal.goals,
  }
}

const defaultLocalMealReason = "使用者新增餐點資料，可作為後續推薦依據。"

export class LocalMealValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "LocalMealValidationError"
  }
}

/** Convert legacy/local-only meal data into the exact POST /api/meals shape. */
export function sanitizeLocalMealForBackend(meal: Meal): BackendMeal {
  const mealName = typeof meal.name === "string" ? meal.name.trim() : ""
  if (!mealName) throw new LocalMealValidationError("餐點名稱不足")

  const mealType =
    typeof meal.type === "string" && meal.type.trim() ? meal.type.trim() : "使用者新增"
  const tags = Array.isArray(meal.tags)
    ? meal.tags.filter((value) => typeof value === "string")
    : []
  const mainIngredients = Array.isArray(meal.ingredients)
    ? meal.ingredients.filter((value) => typeof value === "string" && value.trim())
    : []
  if (mainIngredients.length === 0) {
    throw new LocalMealValidationError("缺少主要食材")
  }

  const estimatedCalories = Number(meal.calories)
  const calories = Number.isFinite(estimatedCalories) ? estimatedCalories : 0
  const isBeverage = /飲品|飲料|茶|咖啡|果汁/.test(`${mealName} ${mealType} ${tags.join(" ")}`)
  if (calories <= 0 && !isBeverage) {
    throw new LocalMealValidationError("缺少有效熱量資料")
  }

  const estimatedProtein = Number(meal.protein)
  const confidence = Number(meal.confidence)
  const createdAt =
    typeof meal.createdAt === "string" && !Number.isNaN(Date.parse(meal.createdAt))
      ? meal.createdAt
      : new Date().toISOString()
  const reason = typeof meal.reason === "string" ? meal.reason.trim() : ""
  const hasEngineeringReason = /fallback|rule-based|AI 服務無法使用/i.test(reason)

  // Building a fresh object is intentional: pendingSync, localOnly, syncError and
  // any unknown legacy/debug fields can never leak into the backend payload.
  return {
    id: typeof meal.id === "string" && meal.id.trim() ? meal.id : crypto.randomUUID(),
    mealName,
    mealType: calories <= 0 && isBeverage ? "飲品" : mealType,
    estimatedCalories: calories,
    estimatedProtein: Number.isFinite(estimatedProtein) ? estimatedProtein : 0,
    tags,
    mainIngredients,
    allergens: Array.isArray(meal.allergens)
      ? meal.allergens.filter((value) => typeof value === "string")
      : [],
    recommendationReason: reason && !hasEngineeringReason ? reason : defaultLocalMealReason,
    confidence:
      Number.isFinite(confidence) && confidence >= 0 && confidence <= 1 ? confidence : 0.6,
    sourceType: sourceTypeValue(meal.sourceType),
    createdAt,
    isAiGenerated: typeof meal.isAiGenerated === "boolean" ? meal.isAiGenerated : false,
    recommendedGoals: Array.isArray(meal.goals)
      ? meal.goals.filter((value) => typeof value === "string")
      : [],
  }
}

export async function fetchHealth(): Promise<BackendHealth> {
  return request<BackendHealth>("/api/health")
}

export async function fetchMeals(): Promise<Meal[]> {
  const payload = await request<BackendMeal[]>("/api/meals")
  return payload.map(backendMealToMeal)
}

export async function analyzeText(
  description: string,
  excludedIngredients: Allergen[] = [],
): Promise<Meal> {
  const payload = await request<BackendMeal>("/api/analyze/text", {
    method: "POST",
    body: JSON.stringify({ description, excludedIngredients }),
  })
  return backendMealToMeal(payload)
}

export async function analyzeImage(
  file: File,
  description = "",
  excludedIngredients: Allergen[] = [],
): Promise<Meal> {
  const formData = new FormData()
  formData.append("file", file)
  if (description.trim()) {
    formData.append("text", description.trim())
    formData.append("description", description.trim())
  }
  if (excludedIngredients.length > 0) {
    formData.append("excludedIngredients", JSON.stringify(excludedIngredients))
  }
  const payload = await request<BackendMeal>("/api/analyze/image", {
    method: "POST",
    body: formData,
  })
  return backendMealToMeal(payload)
}

export async function analyzeUrl(url: string, excludedIngredients: Allergen[] = []): Promise<Meal> {
  const payload = await request<BackendMeal>("/api/analyze/url", {
    method: "POST",
    body: JSON.stringify({ url, excludedIngredients }),
  })
  return backendMealToMeal(payload)
}

export async function addMeal(
  meal: Meal,
): Promise<{ meal: Meal; action: MealUpsertResponse["action"] }> {
  const payload = await request<MealUpsertResponse>("/api/meals", {
    method: "POST",
    body: JSON.stringify(mealToBackendMeal(meal)),
  })
  return { meal: backendMealToMeal(payload.meal), action: payload.action }
}

export type MealSyncResult = {
  successful: Array<{
    localMeal: Meal
    savedMeal: Meal
    action: MealUpsertResponse["action"]
  }>
  failed: Array<{ meal: Meal; reason: string }>
}

export async function syncMealsToBackend(meals: Meal[]): Promise<MealSyncResult> {
  const successful: MealSyncResult["successful"] = []
  const failed: MealSyncResult["failed"] = []

  for (const localMeal of meals) {
    try {
      const sanitizedMeal = sanitizeLocalMealForBackend(localMeal)
      const payload = await request<MealUpsertResponse>("/api/meals", {
        method: "POST",
        body: JSON.stringify(sanitizedMeal),
      })
      const savedMeal = backendMealToMeal(payload.meal)
      const action = payload.action
      successful.push({ localMeal, savedMeal, action })
    } catch (error) {
      const reason = error instanceof LocalMealValidationError ? error.message : "後端拒絕資料格式"
      if (import.meta.env.DEV) console.warn("Local meal sync failed", { localMeal, error })
      failed.push({ meal: localMeal, reason })
    }
  }

  return { successful, failed }
}

export async function recommendMeals(payload: RecommendPayload): Promise<Meal[]> {
  const response = await request<BackendMeal[]>("/api/recommend", {
    method: "POST",
    body: JSON.stringify(payload),
  })
  return response.map(backendMealToMeal)
}

export async function fetchNearbyPlaces(payload: {
  lat: number
  lng: number
  mealName: string
  mealType: string
  tags: string[]
  radiusMeters?: number
}): Promise<NearbyPlacesResponse> {
  return request<NearbyPlacesResponse>("/api/nearby-places", {
    method: "POST",
    body: JSON.stringify(payload),
  })
}

export function inferGoals(meal: FlexibleBackendMeal): MealGoal[] {
  const goals = new Set<MealGoal>()
  const tags = meal.tags ?? meal.dietTags ?? []
  const tagsText = tags.join(" ")
  const mealName = meal.mealName ?? meal.name ?? ""
  const mealType = meal.mealType ?? meal.type ?? ""
  const reason = meal.recommendationReason ?? meal.reason ?? ""
  const calories = meal.estimatedCalories ?? meal.calories ?? 0
  const protein = meal.estimatedProtein ?? meal.protein ?? 0
  const profile = `${mealName} ${mealType} ${tagsText} ${reason}`
  const isFriedOrHighFat = /炸物|油炸|高脂肪/.test(profile)
  const isSweetOrHighSugar = /甜點|高糖|烘焙/.test(profile)
  const isRisky = isFriedOrHighFat || isSweetOrHighSugar
  const isHighCalorie = calories >= 700
  const isExplicitLowCalorie = tags.includes("低卡")
  const isHealthyLeanMeal =
    !isRisky &&
    (/雞胸肉|水煮|沙拉|蔬菜|健康餐/.test(profile) ||
      tags.includes("健康餐") ||
      tags.includes("低脂"))

  if (isSweetOrHighSugar) {
    goals.add("偶爾享用")
    goals.add("甜點")
    goals.add("高糖提醒")
    return [...goals]
  }

  if (protein >= 25 || tags.includes("高蛋白")) {
    goals.add("增肌")
    goals.add("高蛋白補充")
  }

  if (isFriedOrHighFat) {
    goals.add("偶爾享用")
    goals.add("油炸提醒")
    return [...goals]
  }

  if (
    (calories <= 450 || isExplicitLowCalorie || isHealthyLeanMeal) &&
    (!isHighCalorie || isExplicitLowCalorie)
  ) {
    goals.add("減脂")
    goals.add("健康維持")
  }
  if (isHealthyLeanMeal || protein >= 15) goals.add("均衡飲食")
  return [...goals]
}

function backendGoals(meal: FlexibleBackendMeal): MealGoal[] {
  const labels = meal.recommendedGoals ?? meal.suitableGoals ?? meal.goals
  return labels && labels.length > 0 ? (labels as MealGoal[]) : inferGoals(meal)
}

function sourceTypeLabel(sourceType?: MealSourceType | BackendMeal["sourceType"]): MealSourceType {
  if (sourceType === "image") return "圖片"
  if (sourceType === "url") return "連結"
  if (sourceType === "資料集") return "資料集"
  return "文字"
}

function sourceTypeValue(
  sourceType?: MealSourceType | BackendMeal["sourceType"],
): BackendMeal["sourceType"] {
  if (sourceType === "圖片" || sourceType === "image") return "image"
  if (sourceType === "連結" || sourceType === "url") return "url"
  return "text"
}
