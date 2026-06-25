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
  userTextPreference?: string
  queryHistory?: Array<Record<string, unknown>>
}

export type AiRecommendation = {
  mealId: string
  mealName: string
  aiScore: number
  matchedNeeds: string[]
  riskNotes: string[]
  explanation: string
}

export type RecommendResponse = {
  interpretedNeeds: {
    healthGoal: string
    preferredTags: string[]
    excludedIngredients: string[]
    notes: string
  }
  rankedMeals: AiRecommendation[]
  meals: BackendMeal[]
  usedAiRanking: boolean
  fallbackMessage?: string | null
}

export type NearbyPlace = {
  name: string
  address: string
  rating: number | null
  distanceMeters: number | null
  openNow?: boolean | null
  types: string[]
  mapUrl: string
  googleMapsUrl?: string | null
  aiMapScore?: number | null
  matchedReasons?: string[]
  riskNotes?: string[]
  explanation?: string | null
}

export type NearbyPlacesResponse = {
  query: string
  places: NearbyPlace[]
  message?: string | null
  fallbackUsed?: boolean
  fallbackMessage?: string | null
  aiRankingUsed?: boolean
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    headers: options?.body instanceof FormData ? undefined : { "Content-Type": "application/json" },
    ...options,
  })

  if (!response.ok) {
    const payload = await response.json().catch(() => null)
    const message = extractApiErrorMessage(payload)
    throw new ApiRequestError(
      response.status,
      message || "AI 後端尚未啟動，請先啟動 FastAPI server。",
      payload,
    )
  }

  return response.json() as Promise<T>
}

export class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly responseBody?: unknown,
  ) {
    super(message)
    this.name = "ApiRequestError"
  }
}

function extractApiErrorMessage(payload: unknown): string {
  if (!payload || typeof payload !== "object") return ""
  const body = payload as Record<string, unknown>
  for (const key of ["detail", "message", "error"]) {
    const value = body[key]
    if (typeof value === "string" && value.trim()) return value.trim()
    if (Array.isArray(value)) {
      const issue = value.find((item) => item && typeof item === "object") as
        | Record<string, unknown>
        | undefined
      if (!issue) continue
      const location = Array.isArray(issue.loc) ? issue.loc.map(String).join(".") : ""
      const type = String(issue.type ?? "")
      if (location.includes("mainIngredients")) return "缺少主要食材"
      if (location.includes("estimatedCalories")) return "熱量不是有效數值"
      if (location.includes("sourceType") || type === "literal_error")
        return "sourceType 格式不合法"
      if (location.includes("mealName")) return "餐點名稱不足"
      if (location.includes("recommendationReason")) return "推薦原因不完整"
      if (typeof issue.msg === "string" && issue.msg.trim()) return issue.msg.trim()
    }
  }
  return ""
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

type LocalMealRepairPreset = Pick<
  Meal,
  "type" | "calories" | "protein" | "tags" | "ingredients" | "allergens" | "reason"
>

const localMealRepairPresets: Record<string, LocalMealRepairPreset> = {
  鮮蝦蔬菜碗: {
    type: "健康餐 / 飯類",
    calories: 450,
    protein: 25,
    tags: ["健康餐", "海鮮", "蔬菜", "高蛋白"],
    ingredients: ["蝦仁", "蔬菜", "米飯"],
    allergens: ["甲殼類"],
    reason: "此餐點包含蝦仁與蔬菜，可作為日常均衡餐點參考。",
  },
  炸雞排: {
    type: "炸物 / 小吃",
    calories: 600,
    protein: 35,
    tags: ["炸物", "雞肉", "高蛋白"],
    ingredients: ["雞肉", "麵衣", "油"],
    allergens: ["麩質"],
    reason: "炸雞排以雞肉、麵衣與油製作，蛋白質較高，也應留意油脂與份量。",
  },
  豬肉片: {
    type: "食材 / 肉類",
    calories: 250,
    protein: 20,
    tags: ["食材", "肉類", "豬肉", "高蛋白"],
    ingredients: ["豬肉"],
    allergens: [],
    reason: "此結果為豬肉食材資料，可作為後續餐點搭配與推薦參考。",
  },
  雞胸肉: {
    type: "食材 / 肉類",
    calories: 165,
    protein: 31,
    tags: ["食材", "肉類", "雞肉", "高蛋白", "低脂"],
    ingredients: ["雞肉"],
    allergens: [],
    reason: "此結果為雞胸肉食材資料，可作為後續餐點搭配與推薦參考。",
  },
  花生: {
    type: "食材 / 堅果",
    calories: 567,
    protein: 26,
    tags: ["食材", "堅果", "高蛋白"],
    ingredients: ["花生"],
    allergens: ["花生"],
    reason: "此結果為花生食材資料，熱量較高，花生過敏者應避免食用。",
  },
  西瓜: {
    type: "食材 / 水果",
    calories: 30,
    protein: 1,
    tags: ["食材", "水果", "低熱量"],
    ingredients: ["西瓜"],
    allergens: [],
    reason: "此結果為西瓜食材資料，可作為水果份量與餐點搭配參考。",
  },
  豆腐: {
    type: "食材 / 豆類",
    calories: 80,
    protein: 8,
    tags: ["食材", "豆類", "植物性蛋白"],
    ingredients: ["黃豆"],
    allergens: ["大豆"],
    reason: "此結果為豆腐食材資料，可作為植物性蛋白質搭配參考。",
  },
  雞蛋: {
    type: "食材 / 蛋類",
    calories: 80,
    protein: 7,
    tags: ["食材", "蛋類", "高蛋白"],
    ingredients: ["雞蛋"],
    allergens: ["蛋"],
    reason: "此結果為雞蛋食材資料，可作為後續餐點搭配與推薦參考。",
  },
}

export function repairLocalMealDraft(meal: Meal): Meal | null {
  const mealName = typeof meal.name === "string" ? meal.name.trim() : ""
  const preset = localMealRepairPresets[mealName]
  if (!preset) return null
  const validNumber = (value: unknown, fallback: number) => {
    const parsed = Number(value)
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
  }
  const usableList = (value: unknown) =>
    Array.isArray(value)
      ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
      : []
  const ingredients = usableList(meal.ingredients).filter(
    (item) => !/主要食材待確認|主要食材需人工確認|unknown|未確認/.test(item),
  )
  const reason = typeof meal.reason === "string" ? meal.reason.trim() : ""
  return {
    ...meal,
    name: mealName,
    type: meal.type?.trim() && meal.type.trim() !== "使用者新增" ? meal.type.trim() : preset.type,
    calories: validNumber(meal.calories, preset.calories),
    protein: validNumber(meal.protein, preset.protein),
    tags: [...new Set([...usableList(meal.tags), ...preset.tags])],
    ingredients: [...new Set([...ingredients, ...preset.ingredients])],
    allergens: [...new Set([...usableList(meal.allergens), ...preset.allergens])],
    reason: reason && !/fallback|rule-based|AI 服務無法使用/i.test(reason) ? reason : preset.reason,
    confidence:
      Number.isFinite(Number(meal.confidence)) && Number(meal.confidence) >= 0
        ? Math.min(Number(meal.confidence), 0.85)
        : 0.6,
    sourceType: "文字",
    createdAt:
      typeof meal.createdAt === "string" && !Number.isNaN(Date.parse(meal.createdAt))
        ? meal.createdAt
        : new Date().toISOString(),
    isAiGenerated: false,
    pendingSync: true,
    syncError: undefined,
  }
}

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
      const reason =
        error instanceof LocalMealValidationError
          ? error.message
          : error instanceof ApiRequestError && [400, 422].includes(error.status)
            ? error.message
            : error instanceof ApiRequestError && error.status >= 500
              ? "後端服務暫時無法使用"
              : "後端連線失敗"
      if (import.meta.env.DEV) console.warn("Local meal sync failed", { localMeal, error })
      failed.push({ meal: localMeal, reason })
    }
  }

  return { successful, failed }
}

export async function recommendMeals(payload: RecommendPayload): Promise<{
  meals: Meal[]
  ai?: Omit<RecommendResponse, "meals">
}> {
  const response = await request<BackendMeal[] | RecommendResponse>("/api/recommend", {
    method: "POST",
    body: JSON.stringify(payload),
  })
  if (Array.isArray(response)) return { meals: response.map(backendMealToMeal) }
  return {
    meals: response.meals.map(backendMealToMeal),
    ai: {
      interpretedNeeds: response.interpretedNeeds,
      rankedMeals: response.rankedMeals,
      usedAiRanking: response.usedAiRanking,
      fallbackMessage: response.fallbackMessage,
    },
  }
}

export async function fetchNearbyPlaces(payload: {
  lat: number
  lng: number
  mealName: string
  mealType: string
  tags: string[]
  userTextPreference?: string
  healthGoal?: string
  excludedIngredients?: string[]
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
