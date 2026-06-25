import { useEffect, useMemo, useState } from "react"
import {
  Apple,
  Database,
  History,
  Search,
  ShieldCheck,
  Sparkles,
  SlidersHorizontal,
  Utensils,
} from "lucide-react"
import {
  addMeal,
  ApiRequestError,
  analyzeImage,
  analyzeText,
  analyzeUrl,
  fetchHealth,
  fetchMeals,
  fetchNearbyPlaces,
  recommendMeals,
  repairLocalMealDraft,
  syncMealsToBackend,
  type AiRecommendation,
  type BackendHealth,
  type NearbyPlace,
} from "./api"
import {
  allergens,
  dietTags,
  healthGoals,
  meals,
  type Allergen,
  type DietTag,
  type HealthGoal,
  type Meal,
} from "./mealData"

type QueryRecord = {
  goal: HealthGoal
  tags: DietTag[]
  excludedAllergens: Allergen[]
  keyword: string
  resultCount: number
}

type AiRecommendationSummary = {
  interpretedNeeds: {
    healthGoal: string
    preferredTags: string[]
    excludedIngredients: string[]
    notes: string
  }
  rankedMeals: AiRecommendation[]
  usedAiRanking: boolean
  fallbackMessage?: string | null
}

type CustomListKind = "tag" | "avoid"

const defaultGoal: HealthGoal = "均衡飲食"
const customDietTagsKey = "smartDiet.customDietTags"
const customAvoidIngredientsKey = "smartDiet.customAvoidIngredients"
const localUserMealsKey = "smartDiet.localUserMeals"
const maxImageFileSize = 8 * 1024 * 1024
const supportedImageTypes = new Set(["image/jpeg", "image/png", "image/webp"])
const maxCustomItems = 20
const categorySynonyms: Record<string, string[]> = {
  肉類: [
    "肉類",
    "肉",
    "豬肉",
    "豬肉片",
    "豚肉",
    "豚",
    "豬排",
    "炸豬排",
    "排骨",
    "肉燥",
    "叉燒",
    "培根",
    "火腿",
    "香腸",
    "牛肉",
    "牛肉片",
    "牛排",
    "牛丼",
    "牛腩",
    "雞肉",
    "雞胸",
    "雞胸肉",
    "雞腿",
    "雞排",
    "炸雞",
    "雞塊",
    "鴨肉",
    "鴨胸",
    "羊肉",
    "羊排",
  ],
  豬肉: [
    "豬肉",
    "豬肉片",
    "豚肉",
    "豚",
    "豬排",
    "炸豬排",
    "排骨",
    "叉燒",
    "培根",
    "火腿",
    "香腸",
    "肉燥",
  ],
  牛肉: ["牛肉", "牛肉片", "牛排", "牛丼", "牛腩"],
  雞肉: ["雞肉", "雞胸", "雞胸肉", "雞腿", "雞排", "炸雞", "雞塊"],
  海鮮: ["海鮮", "蝦", "蝦仁", "魚", "花枝", "魷魚", "蟹", "牡蠣", "蛤蜊", "貝類"],
  甲殼類: ["蝦", "蟹", "龍蝦", "螃蟹"],
  堅果: ["堅果", "花生", "杏仁", "腰果", "核桃", "開心果", "榛果"],
  花生: ["花生", "花生粉", "花生醬"],
  乳製品: ["乳製品", "牛奶", "奶油", "起司", "乳酪", "鮮奶油", "奶精"],
  麩質: ["麩質", "小麥", "麵粉", "麵皮", "麵條", "麵衣", "麵包粉"],
  蛋: ["蛋", "雞蛋", "蛋液", "蛋黃", "蛋白"],
  酒精: ["酒", "酒精", "米酒", "料理酒", "啤酒", "紅酒", "白酒"],
  辛辣: ["辣", "辣椒", "麻辣", "微辣", "辛辣", "胡椒"],
}
const constraintWords = [
  "不可以吃",
  "不能吃",
  "不要吃",
  "不吃",
  "不要",
  "避免",
  "對",
  "過敏",
  "禁忌",
  "無",
]
const safeShortTerms = new Set(["蛋", "辣", "酒", "肉"])
const invalidIngredientTokens = [
  "主要食材待確認",
  "主要食材需人工確認",
  "餐點影像特徵不足",
  "未確認",
  "unknown",
]
const genericReasonTemplates = [
  "系統已根據候選餐點與可見食材特徵重新校正辨識結果。",
  "系統已根據輸入內容提供餐點健康建議。",
  "系統已完成餐點分析。",
]

function toggleValue<T>(values: T[], value: T) {
  return values.includes(value) ? values.filter((item) => item !== value) : [...values, value]
}

function formatList(values: string[]) {
  return values.length > 0 ? values.join("、") : "未設定"
}

function formatCalories(value: number) {
  return value > 0 ? `${value} kcal` : "約 500 kcal"
}

function formatProtein(value: number) {
  return value > 0 ? `${value}g` : "未估算"
}

function formatConfidence(value?: number) {
  if (!value) return ""
  const level = value >= 0.75 ? "high" : value >= 0.45 ? "medium" : "low"
  const label = level === "high" ? "高" : level === "medium" ? "中" : "低"
  return `信心分數：${Math.round(value * 100)}%（${label} / ${level}）`
}

function isCompleteMeal(meal: Meal) {
  const hasValidCalories = meal.calories > 0 || meal.type === "飲品"
  const reason = meal.reason.trim()
  return (
    meal.name.trim().length > 0 &&
    hasValidCalories &&
    meal.protein >= 0 &&
    meal.tags.length > 0 &&
    meal.ingredients.length > 0 &&
    !meal.ingredients.some((item) =>
      invalidIngredientTokens.some((token) => item.toLowerCase().includes(token.toLowerCase())),
    ) &&
    reason.length > 0 &&
    !genericReasonTemplates.includes(reason) &&
    !/fallback|rule-based|AI 服務無法使用/i.test(reason)
  )
}

function isJoinableMeal(meal: Meal) {
  const hasValidIngredient = meal.ingredients.some(
    (item) =>
      item.trim().length > 0 &&
      !invalidIngredientTokens.some((token) => item.toLowerCase().includes(token.toLowerCase())),
  )
  const hasInference = meal.tags.length > 0 || hasValidIngredient || meal.reason.trim().length > 0
  return (
    meal.name.trim().length > 0 &&
    meal.type.trim().length > 0 &&
    !["疑似餐點", "待補充餐點", "未命名餐點"].includes(meal.name.trim()) &&
    hasInference
  )
}

function shouldShowAnalysisError(meal: Meal) {
  return (
    !meal.name.trim() ||
    !meal.type.trim() ||
    ["疑似餐點", "待補充餐點", "未命名餐點"].includes(meal.name.trim())
  )
}

function shouldShowAnalysisWarning(meal: Meal) {
  const validIngredients = meal.ingredients.filter(
    (item) =>
      item.trim().length > 0 &&
      !invalidIngredientTokens.some((token) => item.toLowerCase().includes(token.toLowerCase())),
  )
  return validIngredients.length < 2 || Boolean(meal.warningMessage || meal.nutritionNote)
}

function analysisWarningMessage(meal: Meal) {
  return (
    meal.warningMessage ||
    meal.nutritionNote ||
    "此結果為 AI 根據有限資訊推測，實際營養與成分仍需以包裝標示或店家資料為準。"
  )
}

function parseStructuredDescription(text: string) {
  const fields: {
    name?: string
    type?: string
    ingredients?: string[]
    tags?: string[]
  } = {}
  const keyMap: Record<string, keyof typeof fields> = {
    餐點名稱: "name",
    名稱: "name",
    name: "name",
    餐點類型: "type",
    類型: "type",
    type: "type",
    主要食材: "ingredients",
    食材: "ingredients",
    ingredients: "ingredients",
    飲食標籤: "tags",
    標籤: "tags",
    dietTags: "tags",
    tags: "tags",
  }
  const rawValues: Partial<Record<keyof typeof fields, string>> = {}
  let currentKey: keyof typeof fields | "" = ""

  text.split(/\r?\n/).forEach((rawLine) => {
    const line = rawLine.trim()
    if (!line) return
    const matched = Object.entries(keyMap).find(([label]) =>
      [undefined].some(() => line.startsWith(`${label}：`) || line.startsWith(`${label}:`)),
    )
    if (matched) {
      const [label, key] = matched
      rawValues[key] = line.slice(label.length + 1).trim()
      currentKey = key
      return
    }
    if (currentKey) {
      rawValues[currentKey] = `${rawValues[currentKey] ?? ""} ${line}`.trim()
    }
  })

  if (rawValues.name) fields.name = rawValues.name.trim()
  if (rawValues.type) fields.type = splitDescriptionList(rawValues.type).join("、")
  if (rawValues.ingredients) fields.ingredients = splitDescriptionList(rawValues.ingredients)
  if (rawValues.tags) fields.tags = splitDescriptionList(rawValues.tags)
  return fields
}

function splitDescriptionList(value: string) {
  return value
    .replace(/[、，,；;／/｜|]/g, " ")
    .split(/\s+/)
    .map((item) => item.trim())
    .filter((item, index, items) => item.length > 0 && items.indexOf(item) === index)
}

function enrichMealFromDescription(meal: Meal, text: string): Meal {
  const parsed = parseStructuredDescription(text)
  const inferred = inferFoodFromLooseDescription(text)
  const next: Meal = {
    ...meal,
    name: parsed.name || inferred.name || meal.name,
    type: parsed.type || inferred.type || meal.type,
    calories: meal.calories > 0 ? meal.calories : inferred.calories || meal.calories,
    protein: meal.protein > 0 ? meal.protein : inferred.protein || meal.protein,
    tags: mergeUnique(mergeUnique(meal.tags, parsed.tags ?? []), inferred.tags ?? []) as DietTag[],
    ingredients: mergeUnique(
      mergeUnique(meal.ingredients, parsed.ingredients ?? []),
      inferred.ingredients ?? [],
    ),
    allergens: mergeUnique(meal.allergens, inferred.allergens ?? []) as Allergen[],
  }
  if (inferred.warningMessage && !next.warningMessage) next.warningMessage = inferred.warningMessage
  if (inferred.nutritionNote && !next.nutritionNote) next.nutritionNote = inferred.nutritionNote
  if (inferred.confidence && (!next.confidence || next.confidence > inferred.confidence)) {
    next.confidence = inferred.confidence
  }
  if (parsed.name || parsed.type || parsed.ingredients?.length || inferred.name) {
    next.reason =
      meal.reason && !genericReasonTemplates.includes(meal.reason)
        ? meal.reason
        : "系統根據使用者提供的餐點描述整理餐點名稱、類型與主要食材，營養數值為日常飲食建議用途的合理估算。"
  }
  return next
}

function inferFoodFromLooseDescription(text: string): Partial<Meal> {
  const normalized = text.trim().toLowerCase()
  if (!normalized) return {}
  if (normalized.includes("杜老爺")) {
    return {
      name: "杜老爺冰品",
      type: "冰品 / 甜點",
      calories: 260,
      protein: 4,
      tags: ["冰品", "甜點", "高糖"],
      ingredients: [],
      allergens: ["乳製品"],
      confidence: 0.35,
      warningMessage: "此結果為 AI 根據有限資訊推測，實際營養與成分仍需以包裝標示或店家資料為準。",
      nutritionNote: "僅能依品牌與食品類型做粗略估算，若需更準確資訊請參考包裝營養標示。",
    }
  }
  return {}
}

function isLikelyFoodDescription(text: string) {
  const normalized = text.trim().toLowerCase()
  if (!normalized) return false
  if (/^[a-z0-9_\-.\s]+$/.test(normalized)) return false
  if (Object.keys(parseStructuredDescription(text)).length > 0) return true
  return [
    "餐",
    "飯",
    "麵",
    "粥",
    "湯",
    "便當",
    "沙拉",
    "蛋",
    "肉",
    "雞",
    "牛",
    "豬",
    "魚",
    "蝦",
    "蔬菜",
    "水果",
    "冰",
    "甜點",
    "飲品",
    "咖啡",
    "茶",
    "減脂",
    "增肌",
    "低卡",
    "高蛋白",
    "麻辣",
    "豆腐",
    "杜老爺",
    "小籠包",
    "湯包",
    "炒飯",
  ].some((term) => normalized.includes(term.toLowerCase()))
}

function analysisErrorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : ""
  const normalized = message.toLowerCase()
  if (error instanceof ApiRequestError && error.status === 413) {
    return "圖片檔案過大，請壓縮後再上傳。"
  }
  if (error instanceof ApiRequestError && error.status === 415) {
    return "不支援此圖片格式，請使用 JPG、PNG 或 WebP。"
  }
  if (
    normalized.includes("429") ||
    normalized.includes("too many") ||
    normalized.includes("toomanyrequests") ||
    normalized.includes("resource_exhausted") ||
    normalized.includes("quota") ||
    message.includes("請求過多")
  ) {
    return "AI 服務目前請求過多，已改用保守規則分析，或請稍後再試。"
  }
  if (message.includes("無法判斷") || message.includes("資訊不足") || message.includes("更明確")) {
    return "目前無法判斷完整餐點。若圖片是單一食材，請補充食材名稱；若是餐點，請補充餐點名稱或主要配料。"
  }
  if (error instanceof ApiRequestError && [400, 422].includes(error.status)) {
    return "圖片資料無法處理，請確認圖片格式與內容後再試。"
  }
  if (error instanceof ApiRequestError && error.status >= 500) {
    return "AI 圖片分析服務暫時發生錯誤，請稍後再試。"
  }
  return "AI 分析暫時失敗，請稍後再試或補充餐點名稱。"
}

function loadStoredList(key: string) {
  try {
    const payload = window.localStorage.getItem(key)
    if (!payload) return []
    const parsed = JSON.parse(payload)
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string")
      : []
  } catch {
    return []
  }
}

function saveStoredList(key: string, values: string[]) {
  window.localStorage.setItem(key, JSON.stringify(values))
}

function loadStoredMeals() {
  try {
    const payload = window.localStorage.getItem(localUserMealsKey)
    if (!payload) return []
    const parsed = JSON.parse(payload)
    return Array.isArray(parsed)
      ? parsed.map(normalizeStoredMeal).filter((meal) => meal !== null)
      : []
  } catch {
    return []
  }
}

function saveStoredMeals(values: Meal[]) {
  if (values.length === 0) {
    window.localStorage.removeItem(localUserMealsKey)
    return
  }
  window.localStorage.setItem(localUserMealsKey, JSON.stringify(values))
}

function normalizeStoredMeal(value: unknown): Meal | null {
  if (!value || typeof value !== "object") return null
  const meal = value as Record<string, unknown>
  const name =
    typeof meal.name === "string"
      ? meal.name
      : typeof meal.mealName === "string"
        ? meal.mealName
        : ""
  const stringArray = (candidate: unknown) =>
    Array.isArray(candidate)
      ? candidate.filter((item): item is string => typeof item === "string")
      : []
  return {
    id: typeof meal.id === "string" ? meal.id : crypto.randomUUID(),
    name,
    type:
      typeof meal.type === "string"
        ? meal.type
        : typeof meal.mealType === "string"
          ? meal.mealType
          : "",
    calories: (meal.calories ?? meal.estimatedCalories ?? 0) as number,
    protein: (meal.protein ?? meal.estimatedProtein ?? 0) as number,
    tags: stringArray(meal.tags),
    goals: stringArray(meal.goals ?? meal.recommendedGoals),
    ingredients: stringArray(meal.ingredients ?? meal.mainIngredients),
    allergens: stringArray(meal.allergens),
    reason:
      typeof meal.reason === "string"
        ? meal.reason
        : typeof meal.recommendationReason === "string"
          ? meal.recommendationReason
          : "",
    confidence: meal.confidence as number | undefined,
    sourceType: meal.sourceType as Meal["sourceType"],
    createdAt: meal.createdAt as string | undefined,
    isAiGenerated: meal.isAiGenerated as boolean | undefined,
    pendingSync: true,
    localOnly: meal.localOnly as boolean | undefined,
    syncError: typeof meal.syncError === "string" ? meal.syncError : undefined,
  }
}

function normalizeMealNameKey(name: string) {
  return name.replaceAll("\u3000", " ").trim().split(/\s+/).join(" ").toLowerCase()
}

function mergeUnique(left: string[], right: string[]) {
  const values: string[] = []
  ;[...left, ...right].forEach((item) => {
    const normalized = item.trim()
    if (normalized && !values.includes(normalized)) values.push(normalized)
  })
  return values
}

function mergeMeal(existing: Meal, incoming: Meal): Meal {
  return {
    ...existing,
    calories: incoming.calories > 0 ? incoming.calories : existing.calories,
    protein: incoming.protein > 0 ? incoming.protein : existing.protein,
    tags: mergeUnique(existing.tags, incoming.tags) as DietTag[],
    goals: mergeUnique(existing.goals, incoming.goals) as Meal["goals"],
    ingredients: mergeUnique(existing.ingredients, incoming.ingredients),
    allergens: mergeUnique(existing.allergens, incoming.allergens) as Allergen[],
    reason:
      incoming.reason.trim().length > existing.reason.trim().length
        ? incoming.reason
        : existing.reason,
    confidence: Math.min(Math.max(existing.confidence ?? 0.5, incoming.confidence ?? 0.5), 0.9),
    isAiGenerated: existing.isAiGenerated || incoming.isAiGenerated,
  }
}

function mergeMealCollections(...collections: Meal[][]) {
  const merged = new Map<string, Meal>()
  const order: string[] = []
  collections.flat().forEach((meal) => {
    const key = normalizeMealNameKey(meal.name)
    if (!key) return
    if (merged.has(key)) {
      merged.set(key, mergeMeal(merged.get(key) as Meal, meal))
      return
    }
    merged.set(key, meal)
    order.push(key)
  })
  return order.map((key) => merged.get(key) as Meal)
}

function sleep(delayMs: number) {
  return new Promise((resolve) => window.setTimeout(resolve, delayMs))
}

async function fetchWithRetry<T>(
  request: () => Promise<T>,
  options: { retries?: number; delayMs?: number; onRetry?: () => void } = {},
) {
  const retries = options.retries ?? 4
  const baseDelay = options.delayMs ?? 1500
  let lastError: unknown

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await request()
    } catch (error) {
      lastError = error
      if (attempt === retries) break
      options.onRetry?.()
      await sleep(baseDelay * (attempt + 1))
    }
  }

  throw lastError
}

function validateCustomItem(value: string, existing: string[], label: string) {
  const trimmed = value.trim()
  if (!trimmed) return { value: trimmed, error: `${label}不可為空。` }
  if ([...trimmed].length > 12 || trimmed.length > 24) {
    return { value: trimmed, error: `${label}最長 12 個中文字或 24 個英文字元。` }
  }
  if (existing.includes(trimmed)) return { value: trimmed, error: `此${label}已存在。` }
  return { value: trimmed, error: "" }
}

function normalizeUserConstraint(raw: string) {
  return constraintWords
    .reduce((value, word) => value.replaceAll(word, ""), raw.trim())
    .replace(/^[\s：:，,。.;；、]+|[\s：:，,。.;；、]+$/g, "")
}

function normalizeAvoidTerms(values: string[]) {
  const terms = new Set<string>()
  values.forEach((value) => {
    const normalized = normalizeUserConstraint(value)
    if (!normalized) return
    terms.add(value.trim())
    terms.add(normalized)
    Object.entries(categorySynonyms).forEach(([canonical, synonyms]) => {
      if (
        normalized === canonical ||
        synonyms.includes(normalized) ||
        normalized.includes(canonical)
      ) {
        synonyms.forEach((synonym) => terms.add(synonym))
        terms.add(canonical)
      }
    })
  })
  return [...terms]
}

function termMatchesFoodText(searchableText: string, term: string) {
  const normalized = term.trim().toLowerCase()
  if (!normalized) return false
  if (normalized.length < 2 && !safeShortTerms.has(normalized)) return false
  return searchableText.includes(normalized)
}

function getEffectiveExcludedIngredients(selectedTags: string[], excludedAllergens: string[]) {
  const terms = new Set(excludedAllergens)
  if (selectedTags.includes("素食")) {
    terms.add("肉類")
    terms.add("海鮮")
  }
  return [...terms]
}

function mealMatchesExclusion(meal: Meal, excludedAllergens: string[]) {
  const searchableText = [
    meal.name,
    meal.type,
    meal.reason,
    ...meal.tags,
    ...meal.ingredients,
    ...meal.allergens,
  ].join(" ")
  const normalizedSearchableText = searchableText.toLowerCase()
  return normalizeAvoidTerms(excludedAllergens).some((term) =>
    termMatchesFoodText(normalizedSearchableText, term),
  )
}

function filterLocalMeals(
  mealDataset: Meal[],
  goal: HealthGoal,
  selectedTags: DietTag[],
  excludedAllergens: Allergen[],
  keyword: string,
) {
  const normalizedKeyword = keyword.trim().toLowerCase()
  const effectiveExcludedAllergens = getEffectiveExcludedIngredients(
    selectedTags,
    excludedAllergens,
  )
  return mealDataset.filter((meal) => {
    const matchesGoal = meal.goals.includes(goal)
    const matchesTags = selectedTags.every((tag) => meal.tags.includes(tag))
    const avoidsAllergens = !mealMatchesExclusion(meal, effectiveExcludedAllergens)
    const matchesKeyword =
      normalizedKeyword.length === 0 ||
      [meal.name, meal.type, meal.reason, ...meal.tags, ...meal.ingredients, ...meal.allergens]
        .join(" ")
        .toLowerCase()
        .includes(normalizedKeyword)

    return matchesGoal && matchesTags && avoidsAllergens && matchesKeyword
  })
}

type MockNearbyPlace = {
  name: string
  distance: string
  rating: number
  address: string
  types: string[]
}

type NearbyMode = "mock" | "google"

type NearbyPanelState = {
  status: "idle" | "loading" | "success" | "error"
  places: NearbyPlace[]
  message: string
  query: string
  fallbackUsed?: boolean
}

let runtimeEnvOverride: Record<string, string | undefined> | null = null

export function __setNearbyRuntimeEnvForTests(env: Record<string, string | undefined> | null) {
  runtimeEnvOverride = env
}

function readEnv(name: "VITE_NEARBY_MODE" | "VITE_API_BASE_URL") {
  if (runtimeEnvOverride?.[name] !== undefined) return runtimeEnvOverride[name]
  return import.meta.env[name]
}

console.info("Nearby mode:", import.meta.env.VITE_NEARBY_MODE)
console.info("API base URL:", import.meta.env.VITE_API_BASE_URL)

const nearbyMode = (): NearbyMode => (readEnv("VITE_NEARBY_MODE") === "google" ? "google" : "mock")

const configuredApiBaseUrl = () => readEnv("VITE_API_BASE_URL")?.trim() ?? ""

function isDessertNearbyMeal(meal: Meal) {
  const profile = [meal.name, meal.type, ...meal.tags].join(" ")
  return ["冰品", "甜點", "高糖", "杜老爺"].some((term) => profile.includes(term))
}

function mockNearbyPlacesForMeal(meal: Meal): MockNearbyPlace[] {
  if (isDessertNearbyMeal(meal)) {
    return [
      {
        name: "測試冰品店",
        distance: "280m",
        rating: 4.6,
        address: "雲林縣虎尾鎮測試甜品路 1 號",
        types: ["冰品", "甜點"],
      },
      {
        name: "測試便利商店",
        distance: "450m",
        rating: 4.1,
        address: "雲林縣虎尾鎮測試路 2 號",
        types: ["便利商店", "冰品"],
      },
      {
        name: "測試超市",
        distance: "900m",
        rating: 4.3,
        address: "雲林縣虎尾鎮測試路 3 號",
        types: ["超市", "包裝冰品"],
      },
    ]
  }

  return [
    {
      name: "測試健康餐店",
      distance: "350m",
      rating: 4.5,
      address: "雲林縣虎尾鎮測試路 1 號",
      types: ["健康餐", "便當"],
    },
    {
      name: "測試便當店",
      distance: "720m",
      rating: 4.2,
      address: "雲林縣虎尾鎮測試路 2 號",
      types: ["餐盒", "便當"],
    },
  ]
}

function MockNearbyPanel({ meal }: { meal: Meal }) {
  const mockPlaces = mockNearbyPlacesForMeal(meal)

  return (
    <div className="mock-nearby-panel" aria-label={`${meal.name} 附近類似店家`}>
      <div className="mock-nearby-summary">
        <strong>正在模擬查詢 Google Places：</strong>
        <span>查詢餐點：{meal.name}</span>
        <span>餐點類型：{meal.type}</span>
        <span>標籤：{formatList(meal.tags)}</span>
      </div>
      <div>
        <h4>附近類似店家</h4>
        <ol className="mock-place-list">
          {mockPlaces.map((place) => (
            <li key={place.name}>
              <strong>{place.name}</strong>
              <span>距離：{place.distance}</span>
              <span>評分：{place.rating}</span>
              <span>地址：{place.address}</span>
              <span>類型：{place.types.join(" / ")}</span>
            </li>
          ))}
        </ol>
      </div>
    </div>
  )
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function GoogleNearbyPanel({ state }: { state: NearbyPanelState }) {
  if (state.status === "loading") {
    return (
      <div className="mock-nearby-panel" aria-live="polite">
        <p className="nearby-message">正在取得附近店家...</p>
      </div>
    )
  }

  if (state.status === "error") {
    return (
      <div className="mock-nearby-panel" aria-live="polite">
        <p className="nearby-message">{state.message}</p>
      </div>
    )
  }

  return (
    <div className="mock-nearby-panel" aria-live="polite">
      {state.query ? <p className="nearby-message">查詢關鍵字：{state.query}</p> : null}
      {state.places.length === 0 && state.message ? (
        <p className="nearby-message">{state.message}</p>
      ) : null}
      {state.places.length > 0 ? (
        <div>
          <h4>附近類似店家</h4>
          <ol className="mock-place-list">
            {state.places.map((place) => (
              <li key={`${place.name}-${place.mapUrl}`}>
                <strong>{place.name}</strong>
                <span>距離：{place.distanceMeters ?? "未知"}m</span>
                <span>評分：{place.rating ?? "暫無評分"}</span>
                <span>地址：{place.address}</span>
                <span>類型：{place.types.join(" / ")}</span>
                <a className="map-button" href={place.mapUrl} target="_blank" rel="noreferrer">
                  在 Google 地圖查看
                </a>
              </li>
            ))}
          </ol>
        </div>
      ) : null}
    </div>
  )
}

function getCurrentPosition(): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(resolve, reject)
  })
}

function AiMapNearbyPanel({ state }: { state: NearbyPanelState }) {
  if (state.status === "loading") {
    return (
      <div className="mock-nearby-panel" aria-live="polite">
        <p className="nearby-message">正在取得附近店家...</p>
      </div>
    )
  }

  if (state.status === "error") {
    return (
      <div className="mock-nearby-panel" aria-live="polite">
        <p className="nearby-message">{state.message}</p>
      </div>
    )
  }

  return (
    <div className="mock-nearby-panel" aria-live="polite">
      {state.query ? <p className="nearby-message">查詢關鍵字：{state.query}</p> : null}
      {state.message ? <p className="nearby-message">{state.message}</p> : null}
      {state.fallbackUsed && !state.message.includes("示範店家資料") ? (
        <p className="nearby-message">目前使用示範店家資料，正式部署可接 Google Places API。</p>
      ) : null}
      {state.places.length > 0 ? (
        <div>
          <h4>AI 地圖店家推薦</h4>
          <ol className="mock-place-list">
            {state.places.map((place) => (
              <li key={`${place.name}-${place.mapUrl}`}>
                <strong>{place.name}</strong>
                <span>距離：{place.distanceMeters ?? "未知"} 公尺</span>
                <span>評分：{place.rating ?? "尚無評分"}</span>
                <span>
                  營業狀態：
                  {place.openNow === true ? "營業中" : place.openNow === false ? "未營業" : "未知"}
                </span>
                <span>AI 地圖推薦分數：{place.aiMapScore ?? "尚未評分"}</span>
                <span>推薦理由：{place.explanation ?? "此店家與餐點需求相關。"}</span>
                <span>風險提醒：{formatList(place.riskNotes ?? ["實際菜單仍需確認"])}</span>
                <span>地址：{place.address}</span>
                <span>類型：{place.types.join(" / ")}</span>
                <a
                  className="map-button"
                  href={place.googleMapsUrl ?? place.mapUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  打開 Google Maps
                </a>
              </li>
            ))}
          </ol>
        </div>
      ) : null}
    </div>
  )
}

type MealCardProps = {
  meal: Meal
  userTextPreference?: string
  healthGoal?: string
  excludedIngredients?: string[]
}

const defaultDemoPosition = { lat: 25.033, lng: 121.5654 }

function MealCard({
  meal,
  userTextPreference = "",
  healthGoal = "",
  excludedIngredients = [],
}: MealCardProps) {
  const [showNearby, setShowNearby] = useState(false)
  const [nearbyState, setNearbyState] = useState<NearbyPanelState>({
    status: "idle",
    places: [],
    message: "",
    query: "",
  })

  async function fetchAiMapPlaces(lat: number, lng: number, prefixMessage = "") {
    try {
      const sourceMeal = meal as Meal & { mealName?: string; mealType?: string }
      const livePreference =
        userTextPreference ||
        (window as unknown as { __smartDietUserTextPreference?: string })
          .__smartDietUserTextPreference ||
        (document.querySelector('[aria-label="請描述你的飲食需求"]') as HTMLTextAreaElement | null)
          ?.value ||
        ""
      const response = await fetchNearbyPlaces({
        lat,
        lng,
        mealName: sourceMeal.mealName ?? meal.name,
        mealType: sourceMeal.mealType ?? meal.type,
        tags: meal.tags,
        userTextPreference: livePreference,
        healthGoal,
        excludedIngredients,
        radiusMeters: 1500,
      })
      setNearbyState({
        status: "success",
        places: response.places,
        message: [prefixMessage, response.message].filter(Boolean).join(" "),
        query: response.query,
        fallbackUsed: response.fallbackUsed,
      })
    } catch {
      setNearbyState({
        status: "success",
        places: [],
        message: [prefixMessage, "目前使用示範店家資料，正式部署可接 Google Places API。"]
          .filter(Boolean)
          .join(" "),
        query: "",
        fallbackUsed: true,
      })
    }
  }

  async function handleAiMapNearbyClick() {
    if (showNearby) {
      setShowNearby(false)
      return
    }

    setShowNearby(true)

    if (nearbyMode() === "mock") return

    if (!configuredApiBaseUrl()) {
      setNearbyState({
        status: "error",
        places: [],
        message: "尚未設定後端 API 位址。",
        query: "",
      })
      return
    }

    setNearbyState({ status: "loading", places: [], message: "", query: "" })

    if (!navigator.geolocation) {
      await fetchAiMapPlaces(
        defaultDemoPosition.lat,
        defaultDemoPosition.lng,
        "無法取得定位，暫以示範資料顯示。",
      )
      return
    }

    try {
      const position = await getCurrentPosition()
      await fetchAiMapPlaces(position.coords.latitude, position.coords.longitude)
    } catch (error) {
      const geolocationError = error as Partial<GeolocationPositionError>
      const isGeolocationError =
        geolocationError.code === 1 ||
        geolocationError.code === 2 ||
        geolocationError.code === 3 ||
        (typeof GeolocationPositionError !== "undefined" &&
          error instanceof GeolocationPositionError)
      if (isGeolocationError && geolocationError.code === 1) {
        setNearbyState({
          status: "error",
          places: [],
          message: "需要定位權限才能查詢附近店家。",
          query: "",
        })
        return
      }
      await fetchAiMapPlaces(
        defaultDemoPosition.lat,
        defaultDemoPosition.lng,
        "無法取得定位，暫以示範資料顯示。",
      )
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async function handleNearbyClick() {
    if (showNearby) {
      setShowNearby(false)
      return
    }

    setShowNearby(true)

    if (nearbyMode() === "mock") return

    if (!configuredApiBaseUrl()) {
      setNearbyState({
        status: "error",
        places: [],
        message: "尚未設定後端 API 網址",
        query: "",
      })
      return
    }

    if (!navigator.geolocation) {
      setNearbyState({
        status: "error",
        places: [],
        message: "啟用定位以查看附近類似店家",
        query: "",
      })
      return
    }

    setNearbyState({ status: "loading", places: [], message: "", query: "" })

    try {
      const position = await getCurrentPosition()
      const sourceMeal = meal as Meal & { mealName?: string; mealType?: string }
      const response = await fetchNearbyPlaces({
        lat: position.coords.latitude,
        lng: position.coords.longitude,
        mealName: sourceMeal.mealName ?? meal.name,
        mealType: sourceMeal.mealType ?? meal.type,
        tags: meal.tags,
        radiusMeters: 1500,
      })
      setNearbyState({
        status: "success",
        places: response.places,
        message: response.message ?? "",
        query: response.query,
      })
    } catch (error) {
      const geolocationError = error as Partial<GeolocationPositionError>
      const isGeolocationError =
        geolocationError.code === 1 ||
        geolocationError.code === 2 ||
        geolocationError.code === 3 ||
        (typeof GeolocationPositionError !== "undefined" &&
          error instanceof GeolocationPositionError)
      setNearbyState({
        status: "error",
        places: [],
        message: isGeolocationError
          ? "啟用定位以查看附近類似店家"
          : "目前無法取得附近店家，請稍後再試",
        query: "",
      })
    }
  }

  return (
    <article className="meal-card">
      <div className="meal-card-header">
        <div>
          <p className="meal-type">{meal.type}</p>
          <h3>{meal.name}</h3>
        </div>
        <span>{formatCalories(meal.calories)}</span>
      </div>
      <div className="meal-facts">
        <div>
          <span>蛋白質</span>
          <strong>{formatProtein(meal.protein)}</strong>
        </div>
        <div>
          <span>適合目標</span>
          <strong>{meal.goals.join(" / ")}</strong>
        </div>
      </div>
      <div className="tag-list" aria-label={`${meal.name} 飲食標籤`}>
        {meal.tags.map((tag) => (
          <span className="tag" key={tag}>
            {tag}
          </span>
        ))}
      </div>
      <p className="ingredients">
        <strong>主要食材：</strong>
        {meal.ingredients.length > 0 ? meal.ingredients.join("、") : "待確認"}
      </p>
      <p className="ingredients">
        <strong>過敏原 / 禁忌食材：</strong>
        {formatList(meal.allergens)}
      </p>
      <p className="reason">
        <strong>推薦原因：</strong>
        {meal.reason}
      </p>
      {meal.sourceType || meal.confidence ? (
        <p className="source-note">
          {meal.sourceType ? `來源類型：${meal.sourceType}` : null}
          {meal.sourceType && meal.confidence ? "，" : null}
          {formatConfidence(meal.confidence)}
          {meal.isAiGenerated ? "，系統分析" : null}
        </p>
      ) : null}
      {meal.warningMessage || meal.nutritionNote ? (
        <p className="source-note">{meal.warningMessage || meal.nutritionNote}</p>
      ) : null}
      <button
        className="utility-button nearby-toggle-button"
        type="button"
        onClick={handleAiMapNearbyClick}
      >
        查看附近店家
      </button>
      {showNearby && nearbyMode() === "mock" ? <MockNearbyPanel meal={meal} /> : null}
      {showNearby && nearbyMode() === "google" ? <AiMapNearbyPanel state={nearbyState} /> : null}
    </article>
  )
}

type CustomChoiceGroupProps = {
  legend: string
  defaultItems: string[]
  customItems: string[]
  selectedItems: string[]
  inputValue: string
  inputLabel: string
  buttonLabel: string
  placeholder: string
  message: string
  kind: CustomListKind
  onInputChange: (value: string) => void
  onAdd: () => void
  onToggle: (value: string) => void
  onDelete: (value: string) => void
}

function CustomChoiceGroup({
  legend,
  defaultItems,
  customItems,
  selectedItems,
  inputValue,
  inputLabel,
  buttonLabel,
  placeholder,
  message,
  kind,
  onInputChange,
  onAdd,
  onToggle,
  onDelete,
}: CustomChoiceGroupProps) {
  return (
    <fieldset className="control-group">
      <legend>{legend}</legend>
      <div className="choice-grid">
        {defaultItems.map((item) => (
          <label className="choice" htmlFor={`${kind}-${item}`} key={item}>
            <input
              id={`${kind}-${item}`}
              type="checkbox"
              checked={selectedItems.includes(item)}
              onChange={() => onToggle(item)}
            />
            {item}
          </label>
        ))}
        {customItems.map((item) => (
          <span className="choice custom-choice" key={item}>
            <label htmlFor={`${kind}-${item}`}>
              <input
                id={`${kind}-${item}`}
                type="checkbox"
                checked={selectedItems.includes(item)}
                onChange={() => onToggle(item)}
              />
              {item}
            </label>
            <button
              aria-label={`刪除${item}`}
              className="delete-chip"
              type="button"
              onClick={() => onDelete(item)}
            >
              ×
            </button>
          </span>
        ))}
      </div>
      <div className="custom-input-row">
        <label className="sr-only" htmlFor={`${kind}-custom-input`}>
          {inputLabel}
        </label>
        <input
          id={`${kind}-custom-input`}
          value={inputValue}
          onChange={(event) => onInputChange(event.target.value)}
          placeholder={placeholder}
        />
        <button className="utility-button" type="button" onClick={onAdd}>
          {buttonLabel}
        </button>
      </div>
      {message ? <p className="helper-text">{message}</p> : null}
    </fieldset>
  )
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function NearbyPlaceCard({
  place,
}: {
  place: {
    types: string[]
    name: string
    distanceMeters: number | null
    rating: number | null
    address: string
    mapUrl: string
  }
}) {
  return (
    <article className="meal-card nearby-place-card">
      <div className="meal-card-header">
        <div>
          <p className="meal-type">{place.types.slice(0, 3).join(" / ") || "店家"}</p>
          <h3>{place.name}</h3>
        </div>
        <span>
          {place.distanceMeters !== null ? `${Math.round(place.distanceMeters)} m` : "距離未知"}
        </span>
      </div>
      <p className="ingredients">
        <strong>評分：</strong>
        {place.rating ?? "尚無評分"}
      </p>
      <p className="ingredients">
        <strong>地址：</strong>
        {place.address || "未提供地址"}
      </p>
      <a className="utility-button map-button" href={place.mapUrl} target="_blank" rel="noreferrer">
        開啟 Google Maps
      </a>
    </article>
  )
}

export function App() {
  const [localUserMeals, setLocalUserMeals] = useState<Meal[]>(loadStoredMeals)
  const [backendMealCount, setBackendMealCount] = useState<number | null>(null)
  const [mealDataset, setMealDataset] = useState<Meal[]>(() =>
    mergeMealCollections(meals, loadStoredMeals()),
  )
  const [backendHealth, setBackendHealth] = useState<BackendHealth | null>(null)
  const [backendError, setBackendError] = useState("")
  const [isOfflineMode, setIsOfflineMode] = useState(false)
  const [backendLoading, setBackendLoading] = useState(true)
  const [mealDatasetLoading, setMealDatasetLoading] = useState(true)
  const [backendRetrying, setBackendRetrying] = useState(false)
  const [goal, setGoal] = useState<HealthGoal>(defaultGoal)
  const [selectedTags, setSelectedTags] = useState<DietTag[]>([])
  const [excludedAllergens, setExcludedAllergens] = useState<Allergen[]>([])
  const [customDietTags, setCustomDietTags] = useState<DietTag[]>(
    () => loadStoredList(customDietTagsKey) as DietTag[],
  )
  const [customAvoidIngredients, setCustomAvoidIngredients] = useState<Allergen[]>(
    () => loadStoredList(customAvoidIngredientsKey) as Allergen[],
  )
  const [newDietTag, setNewDietTag] = useState("")
  const [newAvoidIngredient, setNewAvoidIngredient] = useState("")
  const [tagMessage, setTagMessage] = useState("")
  const [avoidMessage, setAvoidMessage] = useState("")
  const [keyword, setKeyword] = useState("")
  const [userTextPreference, setUserTextPreference] = useState("")
  const [aiRecommendation, setAiRecommendation] = useState<AiRecommendationSummary | null>(null)
  const [hasSearched, setHasSearched] = useState(false)
  const [recommendedMeals, setRecommendedMeals] = useState<Meal[]>(() =>
    mergeMealCollections(meals, loadStoredMeals()),
  )
  const [history, setHistory] = useState<QueryRecord[]>([])
  const [description, setDescription] = useState("")
  const [mealLink, setMealLink] = useState("")
  const [imageFile, setImageFile] = useState<File | null>(null)
  const [analysisResult, setAnalysisResult] = useState<Meal | null>(null)
  const [analysisMessage, setAnalysisMessage] = useState("")
  const [analysisError, setAnalysisError] = useState("")
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const [isRecommending, setIsRecommending] = useState(false)
  const [isSyncingLocalMeals, setIsSyncingLocalMeals] = useState(false)
  const [syncMessage, setSyncMessage] = useState("")
  const [showPersistenceNote, setShowPersistenceNote] = useState(false)

  useEffect(() => {
    let cancelled = false
    async function loadBackendData() {
      setBackendLoading(true)
      setMealDatasetLoading(true)
      setBackendRetrying(false)
      const retryDelay = import.meta.env.MODE === "test" ? 10 : 1500
      const markRetrying = () => {
        if (!cancelled) setBackendRetrying(true)
      }

      try {
        const [health, backendMeals] = await Promise.all([
          fetchWithRetry(fetchHealth, { retries: 3, delayMs: retryDelay, onRetry: markRetrying }),
          fetchWithRetry(fetchMeals, { retries: 3, delayMs: retryDelay, onRetry: markRetrying }),
        ])
        if (cancelled) return
        setBackendHealth(health)
        setBackendMealCount(backendMeals.length)
        const mergedMeals = mergeMealCollections(backendMeals, localUserMeals)
        setMealDataset(mergedMeals)
        setRecommendedMeals(mergedMeals)
        setBackendError("")
        setIsOfflineMode(false)
      } catch {
        if (cancelled) return
        setBackendHealth(null)
        setBackendMealCount(null)
        const offlineMeals = mergeMealCollections(meals, localUserMeals)
        setMealDataset(offlineMeals)
        setRecommendedMeals(offlineMeals)
        setBackendError(
          "目前無法連線後端，系統暫時使用離線示範資料。部分 AI 分析與資料集可能不是最新版本。",
        )
        setIsOfflineMode(true)
      } finally {
        if (!cancelled) {
          setBackendLoading(false)
          setMealDatasetLoading(false)
          setBackendRetrying(false)
        }
      }
    }

    void loadBackendData()

    return () => {
      cancelled = true
    }
  }, [])

  const completeRecommendedMeals = useMemo(
    () => recommendedMeals.filter(isCompleteMeal),
    [recommendedMeals],
  )
  const displayedMeals = hasSearched ? completeRecommendedMeals : mealDataset
  const aiStatusLabel = backendLoading ? "連線中" : backendError ? "未連線" : "已連線"
  const apiStatusLabel = backendLoading
    ? "檢查中"
    : backendError
      ? "暫時無法連線"
      : backendHealth?.aiConfigured
        ? "已設定"
        : "未設定"
  const allDietTags = useMemo(() => [...dietTags, ...customDietTags], [customDietTags])
  const allAvoidIngredients = useMemo(
    () => [...allergens, ...customAvoidIngredients],
    [customAvoidIngredients],
  )

  const localRecommendation = useMemo(
    () => filterLocalMeals(mealDataset, goal, selectedTags, excludedAllergens, keyword),
    [excludedAllergens, goal, keyword, mealDataset, selectedTags],
  )

  const addCustomDietTag = () => {
    const { value, error } = validateCustomItem(newDietTag, allDietTags, "標籤")
    if (error) {
      setTagMessage(error)
      return
    }
    if (customDietTags.length >= maxCustomItems) {
      setTagMessage("自訂標籤數量已達上限。")
      return
    }
    const next = [...customDietTags, value]
    setCustomDietTags(next)
    saveStoredList(customDietTagsKey, next)
    setNewDietTag("")
    setTagMessage("標籤已新增。")
  }

  const addCustomAvoidIngredient = () => {
    const { value, error } = validateCustomItem(newAvoidIngredient, allAvoidIngredients, "禁忌食材")
    if (error) {
      setAvoidMessage(error)
      return
    }
    if (customAvoidIngredients.length >= maxCustomItems) {
      setAvoidMessage("自訂禁忌食材數量已達上限。")
      return
    }
    const next = [...customAvoidIngredients, value]
    setCustomAvoidIngredients(next)
    saveStoredList(customAvoidIngredientsKey, next)
    setNewAvoidIngredient("")
    setAvoidMessage("禁忌食材已新增。")
  }

  const deleteCustomDietTag = (tag: string) => {
    const next = customDietTags.filter((item) => item !== tag)
    setCustomDietTags(next)
    saveStoredList(customDietTagsKey, next)
    setSelectedTags((items) => items.filter((item) => item !== tag))
    setTagMessage("自訂標籤已刪除。")
  }

  const deleteCustomAvoidIngredient = (item: string) => {
    const next = customAvoidIngredients.filter((value) => value !== item)
    setCustomAvoidIngredients(next)
    saveStoredList(customAvoidIngredientsKey, next)
    setExcludedAllergens((items) => items.filter((value) => value !== item))
    setAvoidMessage("自訂禁忌食材已刪除。")
  }

  const handleImageChange = (file: File | null) => {
    setAnalysisError("")
    if (!file) {
      setImageFile(null)
      return
    }
    if (!supportedImageTypes.has(file.type)) {
      setImageFile(null)
      setAnalysisError("不支援此圖片格式，請使用 JPG、PNG 或 WebP。")
      return
    }
    if (file.size > maxImageFileSize) {
      setImageFile(null)
      setAnalysisError("圖片檔案過大，請壓縮後再上傳。")
      return
    }
    setImageFile(file)
  }

  const handleAnalyzeMeal = async () => {
    const trimmedDescription = description.trim()
    const trimmedLink = mealLink.trim()
    setAnalysisError("")
    setAnalysisMessage("")
    if (!trimmedDescription && !imageFile && !trimmedLink) {
      setAnalysisResult(null)
      setAnalysisError("請至少輸入文字描述、上傳餐點圖片，或貼上餐點連結。")
      return
    }
    if (
      trimmedDescription &&
      !imageFile &&
      !trimmedLink &&
      !isLikelyFoodDescription(trimmedDescription)
    ) {
      setAnalysisResult(null)
      setAnalysisError("無法判斷此內容是否為食物，請輸入餐點名稱、食材、圖片或餐點連結。")
      return
    }

    setIsAnalyzing(true)

    try {
      let result: Meal
      const effectiveExcludedAllergens = getEffectiveExcludedIngredients(
        selectedTags,
        excludedAllergens,
      )
      if (trimmedLink) {
        result = await analyzeUrl(trimmedLink, effectiveExcludedAllergens)
      } else if (imageFile) {
        result = await analyzeImage(imageFile, trimmedDescription, effectiveExcludedAllergens)
      } else {
        result = await analyzeText(trimmedDescription, effectiveExcludedAllergens)
      }
      const enrichedResult = enrichMealFromDescription(result, trimmedDescription)
      setAnalysisResult(enrichedResult)
      setAnalysisMessage("AI 分析完成，可加入餐點資料集。")
    } catch (error) {
      setAnalysisError(analysisErrorMessage(error))
    } finally {
      setIsAnalyzing(false)
    }
  }

  const handleAddAnalysis = async () => {
    if (!analysisResult) return
    if (!isJoinableMeal(analysisResult)) {
      setAnalysisError(
        "目前無法判斷完整餐點。若圖片是單一食材，請補充食材名稱；若是餐點，請補充餐點名稱或主要配料。",
      )
      return
    }

    let savedMeal: Meal
    let action: "created" | "merged"
    try {
      if (isOfflineMode) throw new Error("offline")
      const response = await addMeal(analysisResult)
      savedMeal = response.meal
      action = response.action
    } catch {
      const pendingMeal = { ...analysisResult, pendingSync: true }
      const nextLocalMeals = mergeMealCollections(localUserMeals, [pendingMeal]).map((meal) => ({
        ...meal,
        pendingSync: true,
      }))
      setLocalUserMeals(nextLocalMeals)
      saveStoredMeals(nextLocalMeals)
      setMealDataset((current) => mergeMealCollections(current, [analysisResult]))
      setRecommendedMeals((current) => mergeMealCollections(current, [analysisResult]))
      setAnalysisMessage("後端新增失敗，已暫存在此裝置。")
      setAnalysisError("")
      return
    }

    try {
      const backendMeals = await fetchMeals()
      const mergedMeals = mergeMealCollections(backendMeals, localUserMeals)
      setBackendMealCount(backendMeals.length)
      setMealDataset(mergedMeals)
      setRecommendedMeals(mergedMeals)
    } catch {
      setMealDataset((current) => mergeMealCollections(current, [savedMeal]))
      setRecommendedMeals((current) => mergeMealCollections(current, [savedMeal]))
      if (action === "created") {
        setBackendMealCount((current) => (current === null ? current : current + 1))
      }
    }
    setAnalysisMessage(action === "merged" ? "已合併至後端餐點資料集" : "已新增至後端餐點資料集")
    setAnalysisError("")
  }

  const handleSyncLocalMeals = async () => {
    if (localUserMeals.length === 0 || isSyncingLocalMeals) return
    setIsSyncingLocalMeals(true)
    setSyncMessage("")
    setShowPersistenceNote(false)

    const { successful, failed } = await syncMealsToBackend(localUserMeals)
    const remainingMeals = failed.map(({ meal, reason }) => ({
      ...meal,
      pendingSync: true,
      syncError: reason,
    }))
    setLocalUserMeals(remainingMeals)
    saveStoredMeals(remainingMeals)

    if (successful.length > 0) {
      try {
        const backendMeals = await fetchMeals()
        const mergedMeals = mergeMealCollections(backendMeals, remainingMeals)
        setBackendMealCount(backendMeals.length)
        setMealDataset(mergedMeals)
        setRecommendedMeals(mergedMeals)
        setBackendError("")
        setIsOfflineMode(false)
      } catch {
        const savedMeals = successful.map(({ savedMeal }) => savedMeal)
        setMealDataset((current) => mergeMealCollections(current, savedMeals, remainingMeals))
        setRecommendedMeals((current) => mergeMealCollections(current, savedMeals, remainingMeals))
        const createdCount = successful.filter(({ action }) => action === "created").length
        setBackendMealCount((current) => (current === null ? current : current + createdCount))
      }
    }

    if (failed.length > 0) {
      const summary = failed
        .map(({ meal, reason }) => `${meal.name || "未命名餐點"}：${reason}`)
        .join("；")
      setSyncMessage(`${failed.length} 筆資料同步失敗：${summary}，已保留在此裝置。`)
    } else {
      setSyncMessage("本機暫存餐點已同步至後端")
      setShowPersistenceNote(true)
    }
    setIsSyncingLocalMeals(false)
  }

  const handleRemoveLocalMeal = (mealId: string) => {
    const nextLocalMeals = localUserMeals.filter((meal) => meal.id !== mealId)
    setLocalUserMeals(nextLocalMeals)
    saveStoredMeals(nextLocalMeals)
    setMealDataset((current) => current.filter((meal) => meal.id !== mealId))
    setRecommendedMeals((current) => current.filter((meal) => meal.id !== mealId))
    setSyncMessage("已移除此本機暫存餐點。")
  }

  const handleRepairAndSyncLocalMeal = async (meal: Meal) => {
    if (isSyncingLocalMeals) return
    setIsSyncingLocalMeals(true)
    setSyncMessage("")
    setShowPersistenceNote(false)
    const repairedMeal = repairLocalMealDraft(meal)
    if (!repairedMeal) {
      const reason = "無法自動修復，請移除或重新新增"
      const nextLocalMeals = localUserMeals.map((item) =>
        item.id === meal.id ? { ...item, pendingSync: true, syncError: reason } : item,
      )
      setLocalUserMeals(nextLocalMeals)
      saveStoredMeals(nextLocalMeals)
      setSyncMessage(`${meal.name || "未命名餐點"}：${reason}。`)
      setIsSyncingLocalMeals(false)
      return
    }

    const { successful, failed } = await syncMealsToBackend([repairedMeal])
    const otherLocalMeals = localUserMeals.filter((item) => item.id !== meal.id)
    const nextLocalMeals = failed.length
      ? [
          ...otherLocalMeals,
          {
            ...repairedMeal,
            pendingSync: true,
            syncError: failed[0].reason,
          },
        ]
      : otherLocalMeals
    setLocalUserMeals(nextLocalMeals)
    saveStoredMeals(nextLocalMeals)

    if (successful.length > 0) {
      try {
        const backendMeals = await fetchMeals()
        const mergedMeals = mergeMealCollections(backendMeals, nextLocalMeals)
        setBackendMealCount(backendMeals.length)
        setMealDataset(mergedMeals)
        setRecommendedMeals(mergedMeals)
        setBackendError("")
        setIsOfflineMode(false)
      } catch {
        const [{ savedMeal, action }] = successful
        setMealDataset((current) =>
          mergeMealCollections(
            current.filter((item) => item.id !== meal.id),
            [savedMeal],
            nextLocalMeals,
          ),
        )
        setRecommendedMeals((current) =>
          mergeMealCollections(
            current.filter((item) => item.id !== meal.id),
            [savedMeal],
            nextLocalMeals,
          ),
        )
        if (action === "created") {
          setBackendMealCount((current) => (current === null ? current : current + 1))
        }
      }
      setSyncMessage(`${repairedMeal.name}已修復並同步至後端。`)
      setShowPersistenceNote(true)
    } else {
      setSyncMessage(
        `${repairedMeal.name}：${failed[0]?.reason || "後端同步失敗"}，已保留在此裝置。`,
      )
    }
    setIsSyncingLocalMeals(false)
  }

  const handleRecommend = async () => {
    setHasSearched(true)
    setIsRecommending(true)
    let results = localRecommendation
    const effectiveExcludedAllergens = getEffectiveExcludedIngredients(
      selectedTags,
      excludedAllergens,
    )

    try {
      if (!isOfflineMode) {
        const response = await recommendMeals({
          healthGoal: goal,
          tags: selectedTags,
          excludedIngredients: effectiveExcludedAllergens,
          keyword: keyword.trim() || null,
          userTextPreference: userTextPreference.trim(),
          queryHistory: history.map((record) => ({
            healthGoal: record.goal,
            tags: record.tags,
            excludedIngredients: record.excludedAllergens,
            keyword: record.keyword,
          })),
        })
        results = response.meals
        setAiRecommendation(response.ai ?? null)
        setBackendError("")
      } else {
        setAiRecommendation({
          interpretedNeeds: {
            healthGoal: goal,
            preferredTags: selectedTags,
            excludedIngredients: effectiveExcludedAllergens,
            notes: userTextPreference.trim() || "離線模式未使用 AI 解析。",
          },
          rankedMeals: [],
          usedAiRanking: false,
          fallbackMessage: "AI 推薦排序暫時不可用，已改用基本條件推薦。",
        })
      }
    } catch {
      setBackendError("AI 後端尚未啟動，請先啟動 FastAPI server。")
      setIsOfflineMode(true)
      results = localRecommendation
      setAiRecommendation({
        interpretedNeeds: {
          healthGoal: goal,
          preferredTags: selectedTags,
          excludedIngredients: effectiveExcludedAllergens,
          notes: userTextPreference.trim() || "後端暫時無法使用。",
        },
        rankedMeals: [],
        usedAiRanking: false,
        fallbackMessage: "AI 推薦排序暫時不可用，已改用基本條件推薦。",
      })
    } finally {
      setIsRecommending(false)
    }

    setRecommendedMeals(results)
    setHistory((records) =>
      [
        {
          goal,
          tags: selectedTags,
          excludedAllergens,
          keyword: keyword.trim(),
          resultCount: results.length,
        },
        ...records,
      ].slice(0, 5),
    )
  }

  return (
    <div className="app-shell">
      <aside className="sidebar" aria-label="主要導覽">
        <div className="brand">
          <div className="brand-mark">
            <Apple size={22} aria-hidden="true" />
          </div>
          <div>
            <strong>智慧飲食建議系統</strong>
            <span>AI 餐點分析與推薦</span>
          </div>
        </div>
        <nav>
          <a href="#home">
            <Utensils size={18} aria-hidden="true" />
            系統介紹
          </a>
          <a href="#ai-analysis">
            <Sparkles size={18} aria-hidden="true" />
            AI 餐點分析
          </a>
          <a href="#recommendation">
            <SlidersHorizontal size={18} aria-hidden="true" />
            餐點推薦
          </a>
          <a href="#results">
            <ShieldCheck size={18} aria-hidden="true" />
            推薦結果
          </a>
          <a href="#meal-dataset">
            <Database size={18} aria-hidden="true" />
            餐點資料集
          </a>
          <a href="#history">
            <History size={18} aria-hidden="true" />
            查詢紀錄
          </a>
        </nav>
      </aside>

      <main>
        <section className="hero" id="home">
          <div className="eyebrow">Smart Diet Recommendation System</div>
          <h1>智慧飲食建議系統</h1>
          <p>
            本系統定位為日常飲食建議與輔助決策工具，可依照使用者輸入的文字、圖片或連結進行餐點分析，
            並根據健康目標、飲食標籤與禁忌食材提供餐點推薦。
          </p>
          <div className="hero-actions">
            <a className="primary-action" href="#ai-analysis">
              AI 分析餐點
            </a>
            <a href="#meal-dataset">查看餐點資料集</a>
          </div>
        </section>

        <section className="metrics" aria-label="餐點資料摘要">
          <div aria-label={`首頁後端餐點：${backendMealCount ?? "無法取得"}`}>
            <span>{mealDatasetLoading ? "載入中" : (backendMealCount ?? "無法取得")}</span>
            <p>後端餐點</p>
          </div>
          {localUserMeals.length > 0 ? (
            <>
              <div aria-label={`首頁本機暫存：${localUserMeals.length}`}>
                <span>{localUserMeals.length}</span>
                <p>本機暫存</p>
              </div>
              <div aria-label={`首頁合併顯示：${mealDataset.length}`}>
                <span>{mealDatasetLoading ? "載入中" : mealDataset.length}</span>
                <p>合併顯示</p>
              </div>
            </>
          ) : null}
          <div>
            <span>{allDietTags.length}</span>
            <p>飲食標籤</p>
          </div>
          <div>
            <span>{allAvoidIngredients.length}</span>
            <p>禁忌條件</p>
          </div>
        </section>

        {backendLoading ? (
          <p className="status-message">
            {backendRetrying
              ? "正在重新連線後端服務，免費主機首次啟動可能需要較久時間..."
              : "正在連線後端服務，免費主機首次啟動可能需要較久時間..."}
          </p>
        ) : null}

        {!backendLoading && backendError ? <p className="status-message">{backendError}</p> : null}

        <section className="section" id="ai-analysis">
          <div className="section-heading">
            <div>
              <div className="eyebrow">AI Analysis</div>
              <h2>AI 餐點分析與資料集擴充</h2>
            </div>
            <p>
              AI 後端狀態：{aiStatusLabel}，API 狀態：{apiStatusLabel}
              {backendHealth
                ? `，Provider：${backendHealth.aiProvider}，Model：${backendHealth.model}，系統分析：${
                    backendHealth.fallbackEnabled ? "啟用" : "停用"
                  }`
                : ""}
            </p>
          </div>

          <div className="analysis-panel">
            <p className="notice">
              AI 分析結果僅供參考，實際營養數值仍需以餐點標示或專業資料為準。
            </p>
            <div className="control-row">
              <label className="control-group">
                文字描述
                <textarea
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                  placeholder="例如：雞胸肉便當，白飯半碗，青菜"
                />
              </label>
              <div className="control-group">
                <label htmlFor="meal-image">圖片上傳</label>
                <input
                  id="meal-image"
                  type="file"
                  accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp"
                  onChange={(event) => handleImageChange(event.target.files?.[0] ?? null)}
                />
                <span className="helper-text">{imageFile?.name || "尚未選擇餐點照片"}</span>
              </div>
            </div>
            <label className="control-group">
              連結輸入
              <input
                type="url"
                value={mealLink}
                onChange={(event) => setMealLink(event.target.value)}
                placeholder="貼上餐點介紹或菜單網址"
              />
            </label>
            <button
              className={`primary-action recommend-button${isAnalyzing ? " button-loading" : ""}`}
              onClick={handleAnalyzeMeal}
              disabled={isAnalyzing}
            >
              {isAnalyzing ? "分析中..." : "AI 分析餐點"}
            </button>
            {isAnalyzing ? (
              <div className="loading-card" role="status" aria-live="polite">
                <span className="loading-spinner" aria-hidden="true" />
                <div>
                  <strong>系統正在分析餐點，請稍候...</strong>
                  <p>正在整理餐點名稱、主要食材與營養估算。</p>
                </div>
              </div>
            ) : null}
            {!isAnalyzing && analysisMessage ? (
              <p className="status-message">{analysisMessage}</p>
            ) : null}
            {analysisError ? <p className="error-message">{analysisError}</p> : null}

            {analysisResult && shouldShowAnalysisError(analysisResult) ? (
              <p className="error-message">
                目前無法判斷完整餐點。若圖片是單一食材，請補充食材名稱；若是餐點，請補充餐點名稱或主要配料。
              </p>
            ) : null}

            {analysisResult && isJoinableMeal(analysisResult) ? (
              <div className="analysis-result" aria-label="AI 分析結果">
                {analysisResult.type.includes("食材") || analysisResult.tags.includes("食材") ? (
                  <p className="status-message">
                    此結果為食材分析，營養數值僅供後續搭配餐點時參考。
                  </p>
                ) : null}
                {shouldShowAnalysisWarning(analysisResult) ? (
                  <p className="status-message">{analysisWarningMessage(analysisResult)}</p>
                ) : null}
                <MealCard
                  meal={analysisResult}
                  userTextPreference={userTextPreference}
                  healthGoal={goal}
                  excludedIngredients={getEffectiveExcludedIngredients(
                    selectedTags,
                    excludedAllergens,
                  )}
                />
                <button className="utility-button" onClick={handleAddAnalysis}>
                  加入餐點資料集
                </button>
              </div>
            ) : null}
          </div>
        </section>

        <section className="section" id="recommendation">
          <div className="section-heading">
            <div>
              <div className="eyebrow">Recommendation</div>
              <h2>餐點推薦</h2>
            </div>
            <p>選擇健康目標、飲食標籤與禁忌食材後，系統會推薦較符合條件的餐點。</p>
          </div>

          <div className="recommendation-panel">
            <div className="control-row">
              <div className="control-group">
                <label htmlFor="health-goal">健康目標</label>
                <select
                  id="health-goal"
                  value={goal}
                  onChange={(event) => setGoal(event.target.value as HealthGoal)}
                >
                  {healthGoals.map((item) => (
                    <option key={item} value={item}>
                      {item}
                    </option>
                  ))}
                </select>
              </div>

              <label className="control-group">
                搜尋關鍵字
                <span className="search-field">
                  <Search size={17} aria-hidden="true" />
                  <input
                    type="search"
                    value={keyword}
                    onChange={(event) => setKeyword(event.target.value)}
                    placeholder="搜尋餐點、食材或推薦原因"
                  />
                </span>
              </label>
            </div>

            <label className="control-group">
              請描述你的飲食需求
              <textarea
                aria-label="請描述你的飲食需求"
                value={userTextPreference}
                onChange={(event) => {
                  setUserTextPreference(event.target.value)
                  ;(
                    window as unknown as { __smartDietUserTextPreference?: string }
                  ).__smartDietUserTextPreference = event.target.value
                }}
                placeholder="例如：我想減脂、不要海鮮、晚餐想吃高蛋白但不要太油。"
                rows={3}
              />
            </label>

            <CustomChoiceGroup
              legend="飲食標籤"
              defaultItems={dietTags}
              customItems={customDietTags}
              selectedItems={selectedTags}
              inputValue={newDietTag}
              inputLabel="自訂飲食標籤"
              buttonLabel="新增標籤"
              placeholder="例如：少油、無糖、低鈉"
              message={tagMessage}
              kind="tag"
              onInputChange={setNewDietTag}
              onAdd={addCustomDietTag}
              onToggle={(tag) => setSelectedTags((tags) => toggleValue(tags, tag))}
              onDelete={deleteCustomDietTag}
            />

            <CustomChoiceGroup
              legend="過敏原或禁忌食材"
              defaultItems={allergens}
              customItems={customAvoidIngredients}
              selectedItems={excludedAllergens}
              inputValue={newAvoidIngredient}
              inputLabel="自訂禁忌食材"
              buttonLabel="新增禁忌食材"
              placeholder="例如：不吃辣、無麩質、不吃豬肉"
              message={avoidMessage}
              kind="avoid"
              onInputChange={setNewAvoidIngredient}
              onAdd={addCustomAvoidIngredient}
              onToggle={(item) => setExcludedAllergens((items) => toggleValue(items, item))}
              onDelete={deleteCustomAvoidIngredient}
            />

            <button
              className={`primary-action recommend-button${isRecommending ? " button-loading" : ""}`}
              onClick={handleRecommend}
              disabled={isRecommending}
            >
              {isRecommending ? "篩選中..." : "搜尋 / 推薦"}
            </button>
            {isRecommending ? (
              <div className="loading-card" role="status" aria-live="polite">
                <span className="loading-spinner" aria-hidden="true" />
                <div>
                  <strong>正在根據條件篩選餐點...</strong>
                  <p>禁忌食材會優先作為硬性排除條件。</p>
                </div>
              </div>
            ) : null}
          </div>
        </section>

        <section className="section" id="results">
          <div className="section-heading">
            <div>
              <div className="eyebrow">Results</div>
              <h2>推薦結果</h2>
            </div>
            <p>
              目前條件：{goal}，標籤：{formatList(selectedTags)}，排除：
              {formatList(excludedAllergens)}
            </p>
          </div>

          {!hasSearched ? (
            <p className="empty-state">請選擇條件後開始推薦，或先查看下方餐點資料集。</p>
          ) : null}

          {hasSearched && completeRecommendedMeals.length === 0 ? (
            <p className="empty-state">
              目前沒有符合條件的完整餐點資料，請調整條件或補充餐點資訊。
            </p>
          ) : null}

          {aiRecommendation ? (
            <div className="analysis-result" aria-label="AI 個人化推薦說明">
              {aiRecommendation.fallbackMessage ? (
                <p className="status-message">{aiRecommendation.fallbackMessage}</p>
              ) : null}
              <h3>AI 理解到的需求</h3>
              <p>
                目標：{aiRecommendation.interpretedNeeds.healthGoal || "未指定"}；偏好：
                {formatList(aiRecommendation.interpretedNeeds.preferredTags)}；排除：
                {formatList(aiRecommendation.interpretedNeeds.excludedIngredients)}
              </p>
              <p>{aiRecommendation.interpretedNeeds.notes}</p>
              {aiRecommendation.rankedMeals.map((item) => (
                <article className="meal-card" key={item.mealId}>
                  <h3>
                    {item.mealName} · AI 推薦分數 {item.aiScore}
                  </h3>
                  <p>
                    <strong>推薦原因：</strong>
                    {item.explanation}
                  </p>
                  <p>
                    <strong>符合條件：</strong>
                    {formatList(item.matchedNeeds)}
                  </p>
                  <p>
                    <strong>風險提醒：</strong>
                    {formatList(item.riskNotes)}
                  </p>
                </article>
              ))}
            </div>
          ) : null}

          <div className="meal-grid" aria-label="推薦清單">
            {displayedMeals.map((meal) => (
              <MealCard
                meal={meal}
                key={meal.id}
                userTextPreference={userTextPreference}
                healthGoal={goal}
                excludedIngredients={getEffectiveExcludedIngredients(
                  selectedTags,
                  excludedAllergens,
                )}
              />
            ))}
          </div>
        </section>

        <section className="section" id="meal-dataset">
          <div className="section-heading">
            <div>
              <div className="eyebrow">Dataset</div>
              <h2>餐點資料集</h2>
            </div>
            <p>預設資料集與 AI 分析新增的餐點會顯示於此，並可作為推薦依據。</p>
          </div>

          <div className="dataset-source-summary" aria-label="餐點資料來源摘要">
            <div aria-label={`後端餐點數：${backendMealCount ?? "無法取得"}`}>
              <span>後端餐點數</span>
              <strong>{mealDatasetLoading ? "載入中" : (backendMealCount ?? "無法取得")}</strong>
            </div>
            <div aria-label={`本機暫存餐點數：${localUserMeals.length}`}>
              <span>本機暫存餐點數</span>
              <strong>{localUserMeals.length}</strong>
            </div>
            <div aria-label={`合併後餐點數：${mealDataset.length}`}>
              <span>合併後餐點數</span>
              <strong>{mealDatasetLoading ? "載入中" : mealDataset.length}</strong>
            </div>
          </div>
          {localUserMeals.length > 0 ? (
            <div className="dataset-sync-panel">
              <div className="dataset-sync-actions">
                <p className="dataset-source-note">此裝置有本機暫存餐點，其他裝置不會同步。</p>
                <button
                  className="utility-button"
                  type="button"
                  disabled={isSyncingLocalMeals}
                  onClick={handleSyncLocalMeals}
                >
                  {isSyncingLocalMeals ? "同步中..." : "同步本機暫存至後端"}
                </button>
              </div>
              {localUserMeals
                .filter((meal) => meal.syncError)
                .map((meal) => (
                  <div className="local-meal-action" key={meal.id}>
                    <span>
                      {meal.name || "未命名餐點"}
                      {meal.syncError ? `：${meal.syncError}` : ""}
                    </span>
                    <button
                      className="utility-button"
                      type="button"
                      disabled={isSyncingLocalMeals}
                      onClick={() => handleRepairAndSyncLocalMeal(meal)}
                    >
                      修復資料並重新同步
                    </button>
                    <button
                      className="utility-button"
                      type="button"
                      disabled={isSyncingLocalMeals}
                      onClick={() => handleRemoveLocalMeal(meal.id)}
                    >
                      移除此本機暫存
                    </button>
                  </div>
                ))}
            </div>
          ) : null}
          {syncMessage ? <p className="status-message">{syncMessage}</p> : null}
          {showPersistenceNote ? (
            <p className="dataset-source-note">
              已同步至後端；若部署環境未啟用永久磁碟，重新部署後使用者新增資料可能遺失。
            </p>
          ) : null}
          {!mealDatasetLoading && isOfflineMode ? (
            <p className="dataset-source-note">目前使用本機暫存資料。</p>
          ) : null}

          <div className="meal-data-grid" aria-label="餐點資料集清單">
            {mealDatasetLoading ? (
              <p className="empty-state">餐點資料載入中...</p>
            ) : (
              mealDataset.map((meal) => (
                <MealCard
                  meal={meal}
                  key={meal.id}
                  userTextPreference={userTextPreference}
                  healthGoal={goal}
                  excludedIngredients={getEffectiveExcludedIngredients(
                    selectedTags,
                    excludedAllergens,
                  )}
                />
              ))
            )}
          </div>
        </section>

        <section className="section" id="history">
          <div className="section-heading">
            <div>
              <div className="eyebrow">History</div>
              <h2>查詢紀錄</h2>
            </div>
            <p>記錄最近幾次搜尋條件與結果數量，方便比較調整。</p>
          </div>

          {history.length === 0 ? (
            <p className="empty-state">尚未建立查詢紀錄，請先執行搜尋 / 推薦。</p>
          ) : (
            <div className="history-list" aria-label="最近查詢紀錄">
              {history.map((record, index) => (
                <article className="history-item" key={`${record.goal}-${record.keyword}-${index}`}>
                  <strong>查詢 {history.length - index}</strong>
                  <p>目標：{record.goal}</p>
                  <p>標籤：{formatList(record.tags)}</p>
                  <p>排除：{formatList(record.excludedAllergens)}</p>
                  <p>關鍵字：{record.keyword || "未設定"}</p>
                  <span>結果數量：{record.resultCount}</span>
                </article>
              ))}
            </div>
          )}
        </section>
      </main>
    </div>
  )
}
