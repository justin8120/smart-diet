import { render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { App, __setNearbyRuntimeEnvForTests } from "./App"
import { backendMealToMeal, inferGoals, repairLocalMealDraft, type BackendMeal } from "./api"

const backendMeals: BackendMeal[] = [
  {
    id: "seed-tea-egg",
    mealName: "茶葉蛋",
    mealType: "蛋白點心",
    estimatedCalories: 80,
    estimatedProtein: 7,
    tags: ["低卡", "高蛋白", "低脂"],
    mainIngredients: ["雞蛋", "茶葉"],
    allergens: ["蛋"],
    recommendationReason: "茶葉蛋熱量低且含蛋白質，適合作為份量較小的蛋白質補充。",
    confidence: 1,
    sourceType: "text",
    createdAt: "2026-06-03T00:00:00+00:00",
    isAiGenerated: false,
    recommendedGoals: ["減脂", "健康維持"],
  },
  {
    id: "seed-salmon-salad",
    mealName: "鮭魚沙拉",
    mealType: "沙拉",
    estimatedCalories: 360,
    estimatedProtein: 28,
    tags: ["低卡", "高蛋白", "健康餐"],
    mainIngredients: ["鮭魚", "生菜"],
    allergens: ["海鮮"],
    recommendationReason: "鮭魚提供蛋白質與脂肪酸，搭配蔬菜可作為清爽主餐。",
    confidence: 1,
    sourceType: "text",
    createdAt: "2026-06-03T00:00:00+00:00",
    isAiGenerated: false,
    recommendedGoals: ["減脂", "健康維持"],
  },
  {
    id: "seed-seafood-congee",
    mealName: "海鮮粥",
    mealType: "粥品",
    estimatedCalories: 420,
    estimatedProtein: 25,
    tags: ["低脂", "健康餐"],
    mainIngredients: ["白飯", "蝦仁", "蛤蜊"],
    allergens: ["海鮮"],
    recommendationReason: "粥品口感溫和並含海鮮蛋白質，但海鮮禁忌者需避免。",
    confidence: 1,
    sourceType: "text",
    createdAt: "2026-06-03T00:00:00+00:00",
    isAiGenerated: false,
    recommendedGoals: ["均衡飲食", "健康維持"],
  },
]

const analysisMeal: BackendMeal = {
  id: "ai-tea-egg",
  mealName: "茶葉蛋",
  mealType: "蛋白點心",
  estimatedCalories: 80,
  estimatedProtein: 7,
  tags: ["低卡", "高蛋白", "低脂"],
  mainIngredients: ["雞蛋", "茶葉", "醬油"],
  allergens: ["蛋"],
  recommendationReason: "系統辨識此餐點為茶葉蛋，熱量較低並可補充蛋白質。",
  confidence: 0.91,
  sourceType: "text",
  createdAt: "2026-06-03T00:00:00+00:00",
  isAiGenerated: true,
  recommendedGoals: ["減脂", "健康維持"],
}

const incompleteMeal: BackendMeal = {
  id: "incomplete",
  mealName: "湯包",
  mealType: "綜合餐",
  estimatedCalories: 500,
  estimatedProtein: 20,
  tags: ["綜合餐"],
  mainIngredients: ["主要食材待確認"],
  allergens: [],
  recommendationReason: "系統已根據候選餐點與可見食材特徵重新校正辨識結果。",
  confidence: 0.95,
  sourceType: "image",
  createdAt: "2026-06-13T00:00:00+00:00",
  isAiGenerated: true,
}

const cinnamonRollMeal: BackendMeal = {
  id: "url-cinnamon",
  mealName: "肉桂捲",
  mealType: "甜點 / 烘焙點心",
  estimatedCalories: 320,
  estimatedProtein: 6,
  tags: ["甜點", "烘焙", "高糖", "高碳水"],
  mainIngredients: ["麵粉", "糖", "肉桂", "奶油"],
  allergens: ["麩質", "奶類"],
  recommendationReason: "系統根據 URL 產品名稱推測為肉桂捲，屬甜點，建議偶爾享用。",
  confidence: 0.55,
  sourceType: "url",
  createdAt: "2026-06-12T00:00:00+00:00",
  isAiGenerated: true,
  recommendedGoals: ["偶爾享用", "甜點", "高糖提醒"],
}

const friedChickenCutletMeal: BackendMeal = {
  id: "fried-chicken-cutlet",
  mealName: "炸雞排",
  mealType: "炸物 / 小吃",
  estimatedCalories: 600,
  estimatedProtein: 35,
  tags: ["炸物", "雞肉", "高蛋白"],
  mainIngredients: ["雞肉", "麵衣", "油"],
  allergens: ["麩質"],
  recommendationReason:
    "系統根據圖片中可見的大型裹粉油炸雞排判斷此餐點為炸雞排，油炸料理熱量與油脂也較高。",
  confidence: 0.85,
  sourceType: "image",
  createdAt: "2026-06-12T00:00:00+00:00",
  isAiGenerated: true,
}

const leanChickenMeal: BackendMeal = {
  id: "lean-chicken",
  mealName: "雞胸肉健康餐",
  mealType: "健康餐",
  estimatedCalories: 420,
  estimatedProtein: 32,
  tags: ["低卡", "高蛋白", "低脂", "健康餐"],
  mainIngredients: ["雞胸肉", "蔬菜", "糙米"],
  allergens: [],
  recommendationReason: "雞胸肉搭配蔬菜與糙米，適合日常均衡飲食。",
  confidence: 0.8,
  sourceType: "text",
  createdAt: "2026-06-12T00:00:00+00:00",
  isAiGenerated: true,
}

const chickenRiceRateLimitFallback: BackendMeal = {
  id: "fallback-chicken-rice",
  mealName: "雞肉飯",
  mealType: "飯類 / 台式小吃",
  estimatedCalories: 550,
  estimatedProtein: 25,
  tags: ["飯類", "台式", "高碳水", "一般餐點"],
  mainIngredients: ["白飯", "雞肉", "醬汁"],
  allergens: [],
  recommendationReason:
    "雞肉飯以白飯與雞肉為主，能提供碳水化合物與蛋白質，但醬汁與油脂可能提高熱量與鈉含量。",
  confidence: 0.55,
  sourceType: "text",
  createdAt: "2026-06-16T00:00:00+00:00",
  isAiGenerated: true,
  warningMessage: "Gemini API 目前請求過多，已改用保守規則分析；實際營養仍需以店家標示為準。",
  nutritionNote: "此為依餐點名稱與圖片外觀推估，非精準營養標示。",
}

function jsonResponse(payload: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "Content-Type": "application/json" },
    ...init,
  })
}

function delayedJsonResponse(payload: unknown, delay = 50) {
  return new Promise<Response>((resolve) => {
    window.setTimeout(() => resolve(jsonResponse(payload)), delay)
  })
}

function mockOnlineApi() {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (url.endsWith("/api/health")) {
      return jsonResponse({
        status: "ok",
        aiProvider: "gemini",
        aiConfigured: true,
        model: "gemini-2.5-flash-lite",
        fallbackEnabled: true,
      })
    }
    if (url.endsWith("/api/meals") && init?.method === "POST")
      return jsonResponse({ meal: analysisMeal, action: "created" })
    if (url.endsWith("/api/meals")) return jsonResponse(backendMeals)
    if (url.endsWith("/api/analyze/text")) return jsonResponse(analysisMeal)
    if (url.endsWith("/api/analyze/image"))
      return jsonResponse({ ...analysisMeal, sourceType: "image" })
    if (url.endsWith("/api/analyze/url")) return jsonResponse(cinnamonRollMeal)
    if (url.endsWith("/api/recommend")) {
      const body = JSON.parse(String(init?.body))
      if (body.keyword === "不存在的餐點") return jsonResponse([])
      if (body.excludedIngredients?.includes("豬肉")) return jsonResponse([])
      if (body.excludedIngredients?.includes("肉類")) return jsonResponse([])
      if (body.excludedIngredients?.includes("海鮮")) return jsonResponse([backendMeals[0]])
      return jsonResponse([backendMeals[0]])
    }
    if (url.endsWith("/api/nearby-places")) {
      return jsonResponse({
        query: "健康餐 雞胸肉餐盒",
        places: [
          {
            name: "附近健康餐盒",
            address: "台北市信義區測試路 1 號",
            rating: 4.5,
            distanceMeters: 320,
            types: ["restaurant", "food"],
            mapUrl: "https://maps.google.com/?cid=123",
          },
        ],
      })
    }
    return jsonResponse({ detail: "Not found" }, { status: 404 })
  })
}

describe("App", () => {
  beforeEach(() => {
    window.localStorage.clear()
    vi.stubGlobal("fetch", mockOnlineApi())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
    __setNearbyRuntimeEnvForTests(null)
    delete import.meta.env.VITE_NEARBY_MODE
    delete import.meta.env.VITE_API_BASE_URL
    delete (navigator as { geolocation?: Geolocation }).geolocation
    window.localStorage.clear()
  })

  test("renders the smart diet recommendation system and AI analysis section", async () => {
    render(<App />)

    expect(screen.getByRole("heading", { name: "智慧飲食建議系統" })).toBeInTheDocument()
    expect(screen.getByRole("heading", { name: "AI 餐點分析與資料集擴充" })).toBeInTheDocument()
    await waitFor(() => expect(screen.getByText(/Provider：gemini/)).toBeInTheDocument())
  })

  test("shows backend and dataset loading state on initial render", () => {
    render(<App />)

    expect(screen.getByText(/AI 後端狀態：連線中/)).toBeInTheDocument()
    expect(screen.getByText(/API 狀態：檢查中/)).toBeInTheDocument()
    expect(screen.getAllByText("載入中").length).toBeGreaterThan(0)
    expect(screen.getByText(/正在連線後端服務/)).toBeInTheDocument()
    expect(screen.queryByText("資料集餐點：9")).not.toBeInTheDocument()
    expect(screen.queryByText(/API 狀態：未設定/)).not.toBeInTheDocument()
  })

  test("loads meal dataset from the backend", async () => {
    render(<App />)

    const mealDataset = await screen.findByLabelText("餐點資料集清單")
    expect(within(mealDataset).getByText("茶葉蛋")).toBeInTheDocument()
  })

  test("syncs one local meal into 121 backend meals and refreshes the counts", async () => {
    const user = userEvent.setup()
    let serverMeals = Array.from({ length: 121 }, (_, index) => ({
      ...backendMeals[0],
      id: `backend-${index + 1}`,
      mealName: `後端餐點 ${index + 1}`,
    }))
    const localMeal = {
      ...backendMealToMeal(analysisMeal),
      id: "local-only-meal",
      name: "本機限定餐點",
    }
    window.localStorage.setItem("smartDiet.localUserMeals", JSON.stringify([localMeal]))
    const onlineApi = mockOnlineApi()
    let mealGetCalls = 0
    let mealPostCalls = 0
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input)
        if (url.endsWith("/api/meals") && init?.method === "POST") {
          mealPostCalls += 1
          const payload = JSON.parse(String(init.body)) as BackendMeal
          serverMeals = [...serverMeals, payload]
          return jsonResponse({ meal: payload, action: "created" })
        }
        if (url.endsWith("/api/meals")) {
          mealGetCalls += 1
          return jsonResponse(serverMeals)
        }
        return onlineApi(input, init)
      }),
    )

    render(<App />)

    expect(await screen.findByLabelText("後端餐點數：121")).toBeInTheDocument()
    expect(screen.getByLabelText("本機暫存餐點數：1")).toBeInTheDocument()
    expect(screen.getByLabelText("合併後餐點數：122")).toBeInTheDocument()
    expect(screen.getByText("此裝置有本機暫存餐點，其他裝置不會同步。")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "同步本機暫存至後端" })).toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: "同步本機暫存至後端" }))

    expect(await screen.findByText("本機暫存餐點已同步至後端")).toBeInTheDocument()
    expect(screen.getByLabelText("後端餐點數：122")).toBeInTheDocument()
    expect(screen.getByLabelText("本機暫存餐點數：0")).toBeInTheDocument()
    expect(screen.getByLabelText("合併後餐點數：122")).toBeInTheDocument()
    expect(window.localStorage.getItem("smartDiet.localUserMeals")).toBeNull()
    expect(mealPostCalls).toBe(1)
    expect(mealGetCalls).toBeGreaterThanOrEqual(2)
    expect(screen.getByText(/已同步至後端；若部署環境未啟用永久磁碟/)).toBeInTheDocument()
  })

  test("keeps local meal count separate when it duplicates a backend meal", async () => {
    const manyBackendMeals = Array.from({ length: 121 }, (_, index) => ({
      ...backendMeals[0],
      id: `backend-${index + 1}`,
      mealName: index === 0 ? "茶葉蛋" : `後端餐點 ${index + 1}`,
    }))
    window.localStorage.setItem(
      "smartDiet.localUserMeals",
      JSON.stringify([{ ...backendMealToMeal(backendMeals[0]), id: "local-tea-egg" }]),
    )
    const onlineApi = mockOnlineApi()
    let mealPostCalls = 0
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        if (String(input).endsWith("/api/meals") && init?.method === "POST") {
          mealPostCalls += 1
          return jsonResponse({ meal: backendMeals[0], action: "merged" })
        }
        if (String(input).endsWith("/api/meals")) {
          return jsonResponse(manyBackendMeals)
        }
        return onlineApi(input, init)
      }),
    )

    render(<App />)

    expect(await screen.findByLabelText("後端餐點數：121")).toBeInTheDocument()
    expect(screen.getByLabelText("本機暫存餐點數：1")).toBeInTheDocument()
    expect(screen.getByLabelText("合併後餐點數：121")).toBeInTheDocument()

    await userEvent.click(screen.getByRole("button", { name: "同步本機暫存至後端" }))

    expect(await screen.findByLabelText("本機暫存餐點數：0")).toBeInTheDocument()
    expect(screen.getByLabelText("合併後餐點數：121")).toBeInTheDocument()
    const dataset = screen.getByLabelText("餐點資料集清單")
    expect(within(dataset).getAllByText("茶葉蛋")).toHaveLength(1)
    expect(mealPostCalls).toBe(1)
  })

  test("keeps failed meals in localStorage when only part of a sync succeeds", async () => {
    const user = userEvent.setup()
    const successfulLocalMeal = {
      ...backendMealToMeal(analysisMeal),
      id: "local-success",
      name: "可同步餐點",
      pendingSync: true,
    }
    const failedLocalMeal = {
      ...backendMealToMeal(cinnamonRollMeal),
      id: "local-failure",
      name: "保留餐點",
      pendingSync: true,
    }
    window.localStorage.setItem(
      "smartDiet.localUserMeals",
      JSON.stringify([successfulLocalMeal, failedLocalMeal]),
    )
    let serverMeals = [...backendMeals]
    const onlineApi = mockOnlineApi()
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input)
        if (url.endsWith("/api/meals") && init?.method === "POST") {
          const payload = JSON.parse(String(init.body)) as BackendMeal
          if (payload.mealName === "保留餐點") {
            return jsonResponse({ detail: "offline" }, { status: 503 })
          }
          serverMeals = [...serverMeals, payload]
          return jsonResponse({ meal: payload, action: "created" })
        }
        if (url.endsWith("/api/meals")) return jsonResponse(serverMeals)
        return onlineApi(input, init)
      }),
    )

    render(<App />)
    await screen.findByLabelText("本機暫存餐點數：2")
    await user.click(screen.getByRole("button", { name: "同步本機暫存至後端" }))

    expect(
      await screen.findByText("1 筆資料同步失敗：保留餐點：後端服務暫時無法使用，已保留在此裝置。"),
    ).toBeInTheDocument()
    expect(screen.getByLabelText("本機暫存餐點數：1")).toBeInTheDocument()
    const storedMeals = JSON.parse(
      window.localStorage.getItem("smartDiet.localUserMeals") ?? "[]",
    ) as Array<{ name: string; pendingSync: boolean; syncError: string }>
    expect(storedMeals).toEqual([
      expect.objectContaining({
        name: "保留餐點",
        pendingSync: true,
        syncError: "後端服務暫時無法使用",
      }),
    ])
  })

  test("sanitizes a legacy manual meal and excludes local-only fields from POST", async () => {
    const legacyMeal = {
      ...backendMealToMeal(analysisMeal),
      id: "legacy-manual",
      name: "舊版手動餐點",
      sourceType: "manual",
      pendingSync: true,
      localOnly: true,
      syncError: "舊錯誤",
      debugPayload: { trace: true },
      calories: "450",
      protein: "20",
    }
    window.localStorage.setItem("smartDiet.localUserMeals", JSON.stringify([legacyMeal]))
    let postedPayload: Record<string, unknown> | null = null
    const onlineApi = mockOnlineApi()
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        if (String(input).endsWith("/api/meals") && init?.method === "POST") {
          postedPayload = JSON.parse(String(init.body)) as Record<string, unknown>
          return jsonResponse({ meal: postedPayload, action: "created" })
        }
        return onlineApi(input, init)
      }),
    )

    render(<App />)
    await screen.findByLabelText("本機暫存餐點數：1")
    await userEvent.click(screen.getByRole("button", { name: "同步本機暫存至後端" }))

    await screen.findByText("本機暫存餐點已同步至後端")
    expect(postedPayload).toEqual(
      expect.objectContaining({
        sourceType: "text",
        estimatedCalories: 450,
        estimatedProtein: 20,
      }),
    )
    expect(postedPayload).not.toHaveProperty("pendingSync")
    expect(postedPayload).not.toHaveProperty("localOnly")
    expect(postedPayload).not.toHaveProperty("syncError")
    expect(postedPayload).not.toHaveProperty("debugPayload")
    expect(window.localStorage.getItem("smartDiet.localUserMeals")).toBeNull()
  })

  test("does not POST a legacy meal without ingredients and keeps its specific sync error", async () => {
    window.localStorage.setItem(
      "smartDiet.localUserMeals",
      JSON.stringify([
        {
          ...backendMealToMeal(analysisMeal),
          id: "missing-ingredients",
          name: "炸雞排",
          ingredients: "雞肉",
        },
      ]),
    )
    const fetchMock = vi.fn(mockOnlineApi())
    vi.stubGlobal("fetch", fetchMock)

    render(<App />)
    await screen.findByLabelText("本機暫存餐點數：1")
    await userEvent.click(screen.getByRole("button", { name: "同步本機暫存至後端" }))

    expect(
      await screen.findByText("1 筆資料同步失敗：炸雞排：缺少主要食材，已保留在此裝置。"),
    ).toBeInTheDocument()
    expect(
      fetchMock.mock.calls.filter(
        ([input, init]) => String(input).endsWith("/api/meals") && init?.method === "POST",
      ),
    ).toHaveLength(0)
    expect(JSON.parse(window.localStorage.getItem("smartDiet.localUserMeals") ?? "[]")).toEqual([
      expect.objectContaining({ pendingSync: true, syncError: "缺少主要食材" }),
    ])
  })

  test("removes a failed local meal from localStorage", async () => {
    window.localStorage.setItem(
      "smartDiet.localUserMeals",
      JSON.stringify([
        {
          ...backendMealToMeal(analysisMeal),
          id: "removable-local",
          name: "待移除餐點",
          ingredients: [],
          syncError: "缺少主要食材",
        },
      ]),
    )

    render(<App />)
    await screen.findByLabelText("本機暫存餐點數：1")
    await userEvent.click(screen.getByRole("button", { name: "移除此本機暫存" }))

    expect(screen.getByLabelText("本機暫存餐點數：0")).toBeInTheDocument()
    expect(window.localStorage.getItem("smartDiet.localUserMeals")).toBeNull()
    expect(screen.getByText("已移除此本機暫存餐點。")).toBeInTheDocument()
  })

  test("shows a backend 422 detail instead of a generic sync rejection", async () => {
    window.localStorage.setItem(
      "smartDiet.localUserMeals",
      JSON.stringify([
        {
          ...backendMealToMeal(analysisMeal),
          id: "invalid-source-local",
          name: "格式錯誤餐點",
          pendingSync: true,
        },
      ]),
    )
    const onlineApi = mockOnlineApi()
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        if (String(input).endsWith("/api/meals") && init?.method === "POST") {
          return jsonResponse({ detail: "sourceType 格式不合法" }, { status: 422 })
        }
        return onlineApi(input, init)
      }),
    )

    render(<App />)
    await screen.findByLabelText("本機暫存餐點數：1")
    await userEvent.click(screen.getByRole("button", { name: "同步本機暫存至後端" }))

    expect(
      await screen.findByText(
        "1 筆資料同步失敗：格式錯誤餐點：sourceType 格式不合法，已保留在此裝置。",
      ),
    ).toBeInTheDocument()
    expect(window.localStorage.getItem("smartDiet.localUserMeals")).toContain(
      '"syncError":"sourceType 格式不合法"',
    )
  })

  test("repairs and syncs a sparse local shrimp vegetable bowl", async () => {
    const sparseMeal = {
      id: "legacy-shrimp-bowl",
      name: "鮮蝦蔬菜碗",
      type: "",
      calories: 0,
      protein: 0,
      tags: "健康餐",
      goals: [],
      ingredients: [],
      allergens: [],
      reason: "",
      sourceType: "manual",
      pendingSync: true,
      localOnly: true,
      syncError: "缺少主要食材",
      debug: { legacy: true },
    }
    window.localStorage.setItem("smartDiet.localUserMeals", JSON.stringify([sparseMeal]))
    let serverMeals = Array.from({ length: 121 }, (_, index) => ({
      ...backendMeals[0],
      id: `backend-${index + 1}`,
      mealName: `後端餐點 ${index + 1}`,
    }))
    let postedPayload: Record<string, unknown> | null = null
    const onlineApi = mockOnlineApi()
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input)
        if (url.endsWith("/api/meals") && init?.method === "POST") {
          postedPayload = JSON.parse(String(init.body)) as Record<string, unknown>
          serverMeals = [...serverMeals, postedPayload as BackendMeal]
          return jsonResponse({ meal: postedPayload, action: "created" })
        }
        if (url.endsWith("/api/meals")) return jsonResponse(serverMeals)
        return onlineApi(input, init)
      }),
    )

    render(<App />)
    expect(await screen.findByLabelText("後端餐點數：121")).toBeInTheDocument()
    expect(screen.getByLabelText("首頁後端餐點：121")).toBeInTheDocument()
    expect(screen.getByLabelText("首頁本機暫存：1")).toBeInTheDocument()
    expect(screen.getByLabelText("首頁合併顯示：122")).toBeInTheDocument()

    await userEvent.click(screen.getByRole("button", { name: "修復資料並重新同步" }))

    expect(await screen.findByText("鮮蝦蔬菜碗已修復並同步至後端。")).toBeInTheDocument()
    expect(postedPayload).toEqual(
      expect.objectContaining({
        mealName: "鮮蝦蔬菜碗",
        mealType: "健康餐 / 飯類",
        estimatedCalories: 450,
        estimatedProtein: 25,
        tags: ["健康餐", "海鮮", "蔬菜", "高蛋白"],
        mainIngredients: ["蝦仁", "蔬菜", "米飯"],
        allergens: ["甲殼類"],
        sourceType: "text",
      }),
    )
    expect(postedPayload).not.toHaveProperty("pendingSync")
    expect(postedPayload).not.toHaveProperty("localOnly")
    expect(postedPayload).not.toHaveProperty("syncError")
    expect(postedPayload).not.toHaveProperty("debug")
    expect(screen.getByLabelText("後端餐點數：122")).toBeInTheDocument()
    expect(screen.getByLabelText("本機暫存餐點數：0")).toBeInTheDocument()
    expect(screen.getByLabelText("合併後餐點數：122")).toBeInTheDocument()
    expect(window.localStorage.getItem("smartDiet.localUserMeals")).toBeNull()
  })

  test("repairLocalMealDraft fills the minimum shrimp bowl fields", () => {
    const repaired = repairLocalMealDraft({
      id: "repair-unit",
      name: "鮮蝦蔬菜碗",
      type: "",
      calories: Number.NaN,
      protein: Number.NaN,
      tags: [],
      goals: [],
      ingredients: [],
      allergens: [],
      reason: "",
    })

    expect(repaired).toEqual(
      expect.objectContaining({
        type: "健康餐 / 飯類",
        calories: 450,
        protein: 25,
        ingredients: ["蝦仁", "蔬菜", "米飯"],
        allergens: ["甲殼類"],
      }),
    )
  })

  test("retries health check and eventually shows connected backend status", async () => {
    let healthCalls = 0
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input)
        if (url.endsWith("/api/health")) {
          healthCalls += 1
          if (healthCalls === 1) throw new Error("cold start")
          return jsonResponse({
            status: "ok",
            aiProvider: "gemini",
            aiConfigured: true,
            model: "gemini-2.5-flash-lite",
            fallbackEnabled: true,
          })
        }
        if (url.endsWith("/api/meals")) return jsonResponse(backendMeals)
        return jsonResponse({ detail: "Not found" }, { status: 404 })
      }),
    )

    render(<App />)

    await waitFor(() => expect(screen.getByText(/AI 後端狀態：已連線/)).toBeInTheDocument())
    expect(screen.getByText(/API 狀態：已設定/)).toBeInTheDocument()
    expect(healthCalls).toBe(2)
  })

  test("retries meal dataset loading and eventually shows backend meal count", async () => {
    let mealCalls = 0
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input)
        if (url.endsWith("/api/health")) {
          return jsonResponse({
            status: "ok",
            aiProvider: "gemini",
            aiConfigured: true,
            model: "gemini-2.5-flash-lite",
            fallbackEnabled: true,
          })
        }
        if (url.endsWith("/api/meals")) {
          mealCalls += 1
          if (mealCalls === 1) throw new Error("cold start")
          return jsonResponse(backendMeals)
        }
        return jsonResponse({ detail: "Not found" }, { status: 404 })
      }),
    )

    render(<App />)

    await waitFor(() =>
      expect(screen.getByLabelText(`後端餐點數：${backendMeals.length}`)).toBeInTheDocument(),
    )
    expect(screen.queryByText("載入中")).not.toBeInTheDocument()
    expect(mealCalls).toBe(2)
  })

  test("runs mocked AI text analysis and adds the result to the dataset", async () => {
    const user = userEvent.setup()
    const fetchMock = vi.fn(mockOnlineApi())
    vi.stubGlobal("fetch", fetchMock)
    render(<App />)

    await user.type(screen.getByLabelText("文字描述"), "茶葉蛋")
    await user.click(screen.getByRole("button", { name: "AI 分析餐點" }))

    const analysis = await screen.findByLabelText("AI 分析結果")
    expect(within(analysis).getByText("茶葉蛋")).toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: "加入餐點資料集" }))
    await waitFor(() => expect(screen.getByText("已新增至後端餐點資料集")).toBeInTheDocument())
    expect(
      fetchMock.mock.calls.some(
        ([input, init]) => String(input).endsWith("/api/meals") && init?.method === "POST",
      ),
    ).toBe(true)
  })

  test("shows merged message when backend upserts an existing meal", async () => {
    const user = userEvent.setup()
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input)
        if (url.endsWith("/api/health")) {
          return jsonResponse({
            status: "ok",
            aiProvider: "gemini",
            aiConfigured: true,
            model: "gemini-2.5-flash-lite",
            fallbackEnabled: true,
          })
        }
        if (url.endsWith("/api/meals") && init?.method === "POST")
          return jsonResponse({ meal: analysisMeal, action: "merged" })
        if (url.endsWith("/api/meals")) return jsonResponse(backendMeals)
        if (url.endsWith("/api/analyze/text")) return jsonResponse(analysisMeal)
        return jsonResponse({ detail: "Not found" }, { status: 404 })
      }),
    )
    render(<App />)

    await user.type(screen.getByLabelText("文字描述"), "茶葉蛋")
    await user.click(screen.getByRole("button", { name: "AI 分析餐點" }))
    await screen.findByLabelText("AI 分析結果")
    await user.click(screen.getByRole("button", { name: "加入餐點資料集" }))

    expect(await screen.findByText("已合併至後端餐點資料集")).toBeInTheDocument()
  })

  test("stores analyzed meal locally when backend add fails", async () => {
    const user = userEvent.setup()
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input)
        if (url.endsWith("/api/health")) {
          return jsonResponse({
            status: "ok",
            aiProvider: "gemini",
            aiConfigured: true,
            model: "gemini-2.5-flash-lite",
            fallbackEnabled: true,
          })
        }
        if (url.endsWith("/api/meals") && init?.method === "POST") {
          return jsonResponse({ detail: "offline" }, { status: 503 })
        }
        if (url.endsWith("/api/meals")) return jsonResponse(backendMeals)
        if (url.endsWith("/api/analyze/text")) return jsonResponse(analysisMeal)
        return jsonResponse({ detail: "Not found" }, { status: 404 })
      }),
    )
    render(<App />)

    await user.type(screen.getByLabelText("文字描述"), "茶葉蛋")
    await user.click(screen.getByRole("button", { name: "AI 分析餐點" }))
    await screen.findByLabelText("AI 分析結果")
    await user.click(screen.getByRole("button", { name: "加入餐點資料集" }))

    expect(await screen.findByText("後端新增失敗，已暫存在此裝置。")).toBeInTheDocument()
    expect(screen.getByText("此裝置有本機暫存餐點，其他裝置不會同步。")).toBeInTheDocument()
    expect(screen.getByLabelText("本機暫存餐點數：1")).toBeInTheDocument()
    expect(window.localStorage.getItem("smartDiet.localUserMeals")).toContain("茶葉蛋")
    expect(window.localStorage.getItem("smartDiet.localUserMeals")).toContain('"pendingSync":true')
  })

  test("local user meals merge with backend meals without duplicate cards", async () => {
    window.localStorage.setItem(
      "smartDiet.localUserMeals",
      JSON.stringify([
        {
          id: "local-tea-egg",
          name: "茶葉蛋",
          type: "蛋白點心",
          calories: 85,
          protein: 8,
          tags: ["小吃"],
          goals: ["健康維持"],
          ingredients: ["雞蛋", "胡椒"],
          allergens: ["蛋"],
          reason: "本機補充的茶葉蛋資料。",
          confidence: 0.7,
          sourceType: "文字",
          isAiGenerated: true,
        },
      ]),
    )

    render(<App />)

    const dataset = await screen.findByLabelText("餐點資料集清單")
    await waitFor(() => expect(within(dataset).getAllByText("茶葉蛋")).toHaveLength(1))
    expect(within(dataset).getByText(/胡椒/)).toBeInTheDocument()
  })

  test("shows red error only when analysis cannot infer name and type", async () => {
    const user = userEvent.setup()
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input)
        if (url.endsWith("/api/health")) {
          return jsonResponse({
            status: "ok",
            aiProvider: "gemini",
            aiConfigured: true,
            model: "gemini-2.5-flash-lite",
            fallbackEnabled: true,
          })
        }
        if (url.endsWith("/api/meals")) return jsonResponse(backendMeals)
        if (url.endsWith("/api/analyze/text"))
          return jsonResponse({
            ...incompleteMeal,
            mealName: "",
            mealType: "",
            tags: [],
            mainIngredients: [],
          })
        return jsonResponse({ detail: "Not found" }, { status: 404 })
      }),
    )
    render(<App />)

    await user.type(screen.getByLabelText("文字描述"), "餐點")
    await user.click(screen.getByRole("button", { name: "AI 分析餐點" }))

    expect(
      await screen.findByText(
        "目前無法判斷完整餐點。若圖片是單一食材，請補充食材名稱；若是餐點，請補充餐點名稱或主要配料。",
      ),
    ).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "加入餐點資料集" })).not.toBeInTheDocument()
  })

  test("uses structured text description to allow adding an otherwise incomplete analysis", async () => {
    const user = userEvent.setup()
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input)
        if (url.endsWith("/api/health")) {
          return jsonResponse({
            status: "ok",
            aiProvider: "gemini",
            aiConfigured: true,
            model: "gemini-2.5-flash-lite",
            fallbackEnabled: true,
          })
        }
        if (url.endsWith("/api/meals")) return jsonResponse(backendMeals)
        if (url.endsWith("/api/analyze/text"))
          return jsonResponse({
            id: "partial-structured",
            name: "",
            type: "",
            calories: 420,
            protein: 32,
            dietTags: [],
            ingredients: ["主要食材待確認"],
            allergens: [],
            reason: "系統已根據輸入內容提供餐點健康建議。",
            confidence: 0.4,
            sourceType: "text",
            createdAt: "2026-06-13T00:00:00+00:00",
            isAiGenerated: true,
          })
        return jsonResponse({ detail: "Not found" }, { status: 404 })
      }),
    )
    render(<App />)

    await user.type(
      screen.getByLabelText("文字描述"),
      [
        "餐點名稱：雞胸肉健康餐",
        "主要食材：雞胸肉、黑米飯、花椰菜、毛豆、南瓜泥、彩椒、洋蔥",
        "餐點類型：健康餐、便當、低油餐",
        "飲食標籤：高蛋白、低脂、低油、蔬菜多、適合減脂",
      ].join("\n"),
    )
    await user.click(screen.getByRole("button", { name: "AI 分析餐點" }))

    expect(await screen.findByText("AI 分析完成，可加入餐點資料集。")).toBeInTheDocument()
    expect(screen.queryByText(/主要食材或說明不足/)).not.toBeInTheDocument()
    const analysis = await screen.findByLabelText("AI 分析結果")
    expect(within(analysis).getByText("雞胸肉健康餐")).toBeInTheDocument()
    expect(within(analysis).getByText(/黑米飯/)).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "加入餐點資料集" })).toBeInTheDocument()
  })

  test("allows packaged dessert image guess with limited ingredient warning", async () => {
    const user = userEvent.setup()
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input)
        if (url.endsWith("/api/health")) {
          return jsonResponse({
            status: "ok",
            aiProvider: "gemini",
            aiConfigured: true,
            model: "gemini-2.5-flash-lite",
            fallbackEnabled: true,
          })
        }
        if (url.endsWith("/api/meals")) return jsonResponse(backendMeals)
        if (url.endsWith("/api/analyze/image"))
          return jsonResponse({
            id: "ice-cream-guess",
            mealName: "杜老爺冰品",
            mealType: "冰品 / 甜點",
            estimatedCalories: 260,
            estimatedProtein: 4,
            tags: ["冰品", "甜點", "高糖"],
            mainIngredients: [],
            allergens: ["乳製品"],
            recommendationReason: "系統根據使用者提供的品牌或圖片線索推測此項目為杜老爺相關冰品。",
            confidence: 0.35,
            sourceType: "image",
            createdAt: "2026-06-13T00:00:00+00:00",
            isAiGenerated: true,
            warningMessage:
              "此結果為 AI 根據有限資訊推測，實際營養與成分仍需以包裝標示或店家資料為準。",
          })
        return jsonResponse({ detail: "Not found" }, { status: 404 })
      }),
    )
    render(<App />)

    await user.type(screen.getByLabelText("文字描述"), "杜老爺")
    await user.upload(
      screen.getByLabelText("圖片上傳"),
      new File(["fake"], "高級冰淇淋甜筒.jpg", { type: "image/jpeg" }),
    )
    await user.click(screen.getByRole("button", { name: "AI 分析餐點" }))

    expect(await screen.findByText("AI 分析完成，可加入餐點資料集。")).toBeInTheDocument()
    expect(
      screen.queryByText(
        "目前無法判斷完整餐點。若圖片是單一食材，請補充食材名稱；若是餐點，請補充餐點名稱或主要配料。",
      ),
    ).not.toBeInTheDocument()
    expect(screen.getAllByText(/包裝標示或店家資料為準/).length).toBeGreaterThan(0)
    expect(screen.getByRole("button", { name: "加入餐點資料集" })).toBeInTheDocument()
  })

  test("allows image-only analysis without no-input error", async () => {
    const user = userEvent.setup()
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.endsWith("/api/health")) {
        return jsonResponse({
          status: "ok",
          aiProvider: "gemini",
          aiConfigured: true,
          model: "gemini-2.5-flash-lite",
          fallbackEnabled: true,
        })
      }
      if (url.endsWith("/api/meals")) return jsonResponse(backendMeals)
      if (url.endsWith("/api/analyze/image"))
        return jsonResponse({
          id: "image-only-dessert",
          mealName: "杜老爺冰品",
          mealType: "冰品 / 甜點",
          estimatedCalories: 260,
          estimatedProtein: 4,
          tags: ["冰品", "甜點", "高糖"],
          mainIngredients: [],
          allergens: ["乳製品"],
          recommendationReason: "系統根據圖片推測此項目為冰品或甜點。",
          confidence: 0.45,
          sourceType: "image",
          createdAt: "2026-06-14T00:00:00+00:00",
          isAiGenerated: true,
          warningMessage:
            "此結果為 AI 根據有限資訊推測，實際營養與成分仍需以包裝標示或店家資料為準。",
        })
      return jsonResponse({ detail: "Not found" }, { status: 404 })
    })
    vi.stubGlobal("fetch", fetchMock)
    render(<App />)

    await user.upload(
      screen.getByLabelText("圖片上傳"),
      new File(["fake"], "高甜.png", { type: "image/png" }),
    )
    await user.click(screen.getByRole("button", { name: "AI 分析餐點" }))

    expect(await screen.findByText("AI 分析完成，可加入餐點資料集。")).toBeInTheDocument()
    expect(
      screen.queryByText("請至少輸入文字描述、上傳餐點圖片，或貼上餐點連結。"),
    ).not.toBeInTheDocument()
    expect(screen.getByText("杜老爺冰品")).toBeInTheDocument()
    expect(screen.getByText(/信心分數：45%（中 \/ medium）/)).toBeInTheDocument()
    expect(
      fetchMock.mock.calls.some(([input]) => String(input).endsWith("/api/analyze/image")),
    ).toBe(true)
  })

  test("allows brand-only packaged food guess without ingredient blocking", async () => {
    const user = userEvent.setup()
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input)
        if (url.endsWith("/api/health")) {
          return jsonResponse({
            status: "ok",
            aiProvider: "gemini",
            aiConfigured: true,
            model: "gemini-2.5-flash-lite",
            fallbackEnabled: true,
          })
        }
        if (url.endsWith("/api/meals")) return jsonResponse(backendMeals)
        if (url.endsWith("/api/analyze/text"))
          return jsonResponse({
            id: "brand-only",
            mealName: "杜老爺冰品",
            mealType: "冰品 / 甜點",
            estimatedCalories: 260,
            estimatedProtein: 4,
            tags: ["冰品", "甜點", "高糖"],
            mainIngredients: [],
            allergens: ["乳製品"],
            recommendationReason: "系統根據使用者提供的品牌線索推測此項目為杜老爺相關冰品。",
            confidence: 0.35,
            sourceType: "text",
            createdAt: "2026-06-13T00:00:00+00:00",
            isAiGenerated: true,
            warningMessage:
              "此結果為 AI 根據有限資訊推測，實際營養與成分仍需以包裝標示或店家資料為準。",
          })
        return jsonResponse({ detail: "Not found" }, { status: 404 })
      }),
    )
    render(<App />)

    await user.type(screen.getByLabelText("文字描述"), "杜老爺")
    await user.click(screen.getByRole("button", { name: "AI 分析餐點" }))

    expect(await screen.findByText("AI 分析完成，可加入餐點資料集。")).toBeInTheDocument()
    expect(screen.getByText(/信心分數：35%（低 \/ low）/)).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "加入餐點資料集" })).toBeInTheDocument()
  })

  test("rejects meaningless text without creating an analysis card", async () => {
    const user = userEvent.setup()
    const fetchMock = vi.fn(mockOnlineApi())
    vi.stubGlobal("fetch", fetchMock)
    render(<App />)

    await user.type(screen.getByLabelText("文字描述"), "abc123")
    await user.click(screen.getByRole("button", { name: "AI 分析餐點" }))

    expect(
      screen.getByText("無法判斷此內容是否為食物，請輸入餐點名稱、食材、圖片或餐點連結。"),
    ).toBeInTheDocument()
    expect(screen.queryByLabelText("AI 分析結果")).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "加入餐點資料集" })).not.toBeInTheDocument()
    expect(fetchMock.mock.calls.some(([input]) => String(input).includes("/api/analyze/"))).toBe(
      false,
    )
  })

  test("does not call analysis API when all analysis inputs are empty", async () => {
    const user = userEvent.setup()
    const fetchMock = vi.fn(mockOnlineApi())
    vi.stubGlobal("fetch", fetchMock)
    render(<App />)

    await screen.findByText(/Provider：gemini/)
    await user.click(screen.getByRole("button", { name: "AI 分析餐點" }))

    expect(
      screen.getByText("請至少輸入文字描述、上傳餐點圖片，或貼上餐點連結。"),
    ).toBeInTheDocument()
    expect(fetchMock.mock.calls.some(([input]) => String(input).includes("/api/analyze/"))).toBe(
      false,
    )
  })

  test("analyzes with only text description", async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.type(screen.getByLabelText("文字描述"), "茶葉蛋")
    await user.click(screen.getByRole("button", { name: "AI 分析餐點" }))

    expect(await screen.findByLabelText("AI 分析結果")).toBeInTheDocument()
  })

  test("shows Gemini rate-limit fallback warning while keeping the analysis result", async () => {
    const user = userEvent.setup()
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.endsWith("/api/health")) {
        return jsonResponse({
          status: "ok",
          aiProvider: "gemini",
          aiConfigured: true,
          model: "gemini-2.5-flash-lite",
          fallbackEnabled: true,
        })
      }
      if (url.endsWith("/api/meals")) return jsonResponse(backendMeals)
      if (url.endsWith("/api/analyze/text")) return jsonResponse(chickenRiceRateLimitFallback)
      return jsonResponse({ detail: "Not found" }, { status: 404 })
    })
    vi.stubGlobal("fetch", fetchMock)
    render(<App />)

    await user.type(screen.getByLabelText("文字描述"), "雞肉飯")
    await user.click(screen.getByRole("button", { name: "AI 分析餐點" }))

    const analysis = await screen.findByLabelText("AI 分析結果")
    expect(analysis).toBeInTheDocument()
    expect(within(analysis).getByText("雞肉飯")).toBeInTheDocument()
    expect(screen.getAllByText(/Gemini API 目前請求過多/).length).toBeGreaterThan(0)
    expect(
      screen.queryByText(
        "目前無法判斷完整餐點。若圖片是單一食材，請補充食材名稱；若是餐點，請補充餐點名稱或主要配料。",
      ),
    ).not.toBeInTheDocument()
  })

  test("shows explicit loading state while AI analysis is running", async () => {
    const user = userEvent.setup()
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input)
        if (url.endsWith("/api/health")) {
          return jsonResponse({
            status: "ok",
            aiProvider: "gemini",
            aiConfigured: true,
            model: "gemini-2.5-flash-lite",
            fallbackEnabled: true,
          })
        }
        if (url.endsWith("/api/meals")) return jsonResponse(backendMeals)
        if (url.endsWith("/api/analyze/text") && init?.method === "POST") {
          return delayedJsonResponse(analysisMeal, 300)
        }
        return jsonResponse({ detail: "Not found" }, { status: 404 })
      }),
    )
    render(<App />)

    await user.type(screen.getByLabelText("文字描述"), "茶葉蛋")
    await user.click(screen.getByRole("button", { name: "AI 分析餐點" }))

    const loadingButton = screen.getByRole("button", { name: "分析中..." })
    expect(loadingButton).toBeDisabled()
    expect(screen.getByText("系統正在分析餐點，請稍候...")).toBeInTheDocument()
    await waitFor(() =>
      expect(screen.queryByText("系統正在分析餐點，請稍候...")).not.toBeInTheDocument(),
    )
    expect(await screen.findByLabelText("AI 分析結果")).toBeInTheDocument()
  })

  test("analyzes with only image upload", async () => {
    const user = userEvent.setup()
    render(<App />)
    const file = new File(["fake"], "meal.jpg", { type: "image/jpeg" })

    await user.upload(screen.getByLabelText("圖片上傳"), file)
    await user.click(screen.getByRole("button", { name: "AI 分析餐點" }))

    expect(await screen.findByLabelText("AI 分析結果")).toBeInTheDocument()
  })

  test("shows the selected filename and renders a pork ingredient analysis", async () => {
    const user = userEvent.setup()
    const onlineApi = mockOnlineApi()
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).endsWith("/api/analyze/image")) {
        return jsonResponse({
          id: "ingredient-pork-slices",
          mealName: "豬肉片",
          mealType: "食材 / 肉類",
          estimatedCalories: 250,
          estimatedProtein: 20,
          tags: ["食材", "肉類", "豬肉", "高蛋白"],
          mainIngredients: ["豬肉"],
          allergens: [],
          recommendationReason: "此結果較接近單一食材分析，可作為後續餐點搭配與推薦參考。",
          confidence: 0.65,
          sourceType: "image",
          createdAt: "2026-06-22T00:00:00+00:00",
          isAiGenerated: true,
        })
      }
      return onlineApi(input, init)
    })
    vi.stubGlobal("fetch", fetchMock)
    render(<App />)
    const file = new File(["pork-image"], "豬肉片.webp", { type: "image/webp" })

    await user.type(screen.getByLabelText("文字描述"), "豬肉片")
    await user.upload(screen.getByLabelText("圖片上傳"), file)
    expect(screen.getByText("豬肉片.webp")).toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "AI 分析餐點" }))

    const analysis = await screen.findByLabelText("AI 分析結果")
    expect(within(analysis).getByText("豬肉片")).toBeInTheDocument()
    expect(
      within(analysis).getByText("此結果為食材分析，營養數值僅供後續搭配餐點時參考。"),
    ).toBeInTheDocument()
    const imageCall = fetchMock.mock.calls.find(([input]) =>
      String(input).endsWith("/api/analyze/image"),
    )
    const body = imageCall?.[1]?.body as FormData
    expect(body.get("file")).toBe(file)
    expect(body.get("text")).toBe("豬肉片")
  })

  test("rejects an unsupported image format before calling the API", async () => {
    const user = userEvent.setup({ applyAccept: false })
    const fetchMock = vi.fn(mockOnlineApi())
    vi.stubGlobal("fetch", fetchMock)
    render(<App />)

    await user.upload(
      screen.getByLabelText("圖片上傳"),
      new File(["gif"], "meal.gif", { type: "image/gif" }),
    )

    expect(screen.getByText("不支援此圖片格式，請使用 JPG、PNG 或 WebP。")).toBeInTheDocument()
    expect(screen.getByText("尚未選擇餐點照片")).toBeInTheDocument()
    expect(
      fetchMock.mock.calls.some(
        ([input, init]) => String(input).endsWith("/api/analyze/image") && init?.method === "POST",
      ),
    ).toBe(false)
  })

  test("rejects an oversized image before calling the API", async () => {
    const user = userEvent.setup()
    const fetchMock = vi.fn(mockOnlineApi())
    vi.stubGlobal("fetch", fetchMock)
    render(<App />)

    await user.upload(
      screen.getByLabelText("圖片上傳"),
      new File([new Uint8Array(8 * 1024 * 1024 + 1)], "large.jpg", { type: "image/jpeg" }),
    )

    expect(screen.getByText("圖片檔案過大，請壓縮後再上傳。")).toBeInTheDocument()
    expect(screen.getByText("尚未選擇餐點照片")).toBeInTheDocument()
    expect(
      fetchMock.mock.calls.some(
        ([input, init]) => String(input).endsWith("/api/analyze/image") && init?.method === "POST",
      ),
    ).toBe(false)
  })

  test("sends text description as image analysis hint when text and image are provided", async () => {
    const user = userEvent.setup()
    const fetchMock = vi.fn(mockOnlineApi())
    vi.stubGlobal("fetch", fetchMock)
    render(<App />)
    const file = new File(["fake"], "meal.jpg", { type: "image/jpeg" })

    await user.type(screen.getByLabelText("文字描述"), "小籠包")
    await user.upload(screen.getByLabelText("圖片上傳"), file)
    await user.click(screen.getByRole("button", { name: "AI 分析餐點" }))

    await screen.findByLabelText("AI 分析結果")
    const imageCall = fetchMock.mock.calls.find(([input]) =>
      String(input).endsWith("/api/analyze/image"),
    )
    expect(imageCall?.[1]?.body).toBeInstanceOf(FormData)
    expect((imageCall?.[1]?.body as FormData).get("text")).toBe("小籠包")
    expect((imageCall?.[1]?.body as FormData).get("description")).toBe("小籠包")
  })

  test("sends selected custom avoid ingredients to AI analysis requests", async () => {
    const user = userEvent.setup()
    const fetchMock = vi.fn(mockOnlineApi())
    vi.stubGlobal("fetch", fetchMock)
    render(<App />)

    await user.type(screen.getByLabelText("自訂禁忌食材"), "不吃辣")
    await user.click(screen.getByRole("button", { name: "新增禁忌食材" }))
    await user.click(screen.getByLabelText("不吃辣"))
    await user.type(screen.getByLabelText("文字描述"), "麻辣豆腐")
    await user.click(screen.getByRole("button", { name: "AI 分析餐點" }))

    await screen.findByLabelText("AI 分析結果")
    const analyzeCall = fetchMock.mock.calls.find(([input]) =>
      String(input).endsWith("/api/analyze/text"),
    )
    expect(JSON.parse(String(analyzeCall?.[1]?.body)).excludedIngredients).toContain("不吃辣")
  })

  test("analyzes with only URL input and displays backend recommendation categories", async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.type(screen.getByLabelText("連結輸入"), "https://example.com/cinnamon-swirl.html")
    await user.click(screen.getByRole("button", { name: "AI 分析餐點" }))

    const analysis = await screen.findByLabelText("AI 分析結果")
    expect(within(analysis).getByText("肉桂捲")).toBeInTheDocument()
    expect(within(analysis).getByText("偶爾享用 / 甜點 / 高糖提醒")).toBeInTheDocument()
  })

  test("uses URL analysis without sending stale image text hint when URL is provided", async () => {
    const user = userEvent.setup()
    const fetchMock = vi.fn(mockOnlineApi())
    vi.stubGlobal("fetch", fetchMock)
    render(<App />)
    const file = new File(["fake"], "dumpling.jpg", { type: "image/jpeg" })

    await user.type(screen.getByLabelText("文字描述"), "小籠包")
    await user.upload(screen.getByLabelText("圖片上傳"), file)
    await user.type(screen.getByLabelText("連結輸入"), "https://example.com/menu")
    await user.click(screen.getByRole("button", { name: "AI 分析餐點" }))

    await screen.findByLabelText("AI 分析結果")
    expect(fetchMock.mock.calls.some(([input]) => String(input).endsWith("/api/analyze/url"))).toBe(
      true,
    )
    expect(
      fetchMock.mock.calls.some(([input]) => String(input).endsWith("/api/analyze/image")),
    ).toBe(false)
  })

  test("shows backend offline message when API is unavailable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Promise.reject(new Error("offline"))),
    )
    render(<App />)

    expect(await screen.findByText(/目前無法連線後端/)).toBeInTheDocument()
    expect(screen.getByText("目前使用本機暫存資料。")).toBeInTheDocument()
    expect(screen.getByLabelText("首頁後端餐點：無法取得")).toBeInTheDocument()
    expect(screen.getByText(/API 狀態：暫時無法連線/)).toBeInTheDocument()
  })

  test("adds custom diet tag and sends it in recommendation payload", async () => {
    const user = userEvent.setup()
    const fetchMock = vi.fn(mockOnlineApi())
    vi.stubGlobal("fetch", fetchMock)
    render(<App />)

    await user.type(screen.getByLabelText("自訂飲食標籤"), "少油")
    await user.click(screen.getByRole("button", { name: "新增標籤" }))
    await user.click(screen.getByLabelText("少油"))
    await user.click(screen.getByRole("button", { name: "搜尋 / 推薦" }))

    expect(screen.getByText("標籤已新增。")).toBeInTheDocument()
    const recommendCall = fetchMock.mock.calls.find(([input]) =>
      String(input).endsWith("/api/recommend"),
    )
    expect(JSON.parse(String(recommendCall?.[1]?.body)).tags).toContain("少油")
  })

  test("expands and collapses mock nearby places on an individual meal card", async () => {
    const user = userEvent.setup()
    const fetchMock = vi.fn(mockOnlineApi())
    const getCurrentPosition = vi.fn()
    vi.stubGlobal("fetch", fetchMock)
    Object.defineProperty(navigator, "geolocation", {
      value: { getCurrentPosition },
      configurable: true,
    })
    render(<App />)

    await screen.findByText(/Provider/)
    const nearbyButtonName = "\u67e5\u770b\u9644\u8fd1\u5e97\u5bb6"
    const healthyStoreName = "\u6e2c\u8a66\u5065\u5eb7\u9910\u5e97"
    const lunchboxStoreName = "\u6e2c\u8a66\u4fbf\u7576\u5e97"
    const buttons = await screen.findAllByRole("button", { name: nearbyButtonName })

    expect(buttons.length).toBeGreaterThan(0)

    await user.click(buttons[0])

    expect(await screen.findByText(/Google Places/)).toBeInTheDocument()
    expect(screen.getByText(healthyStoreName)).toBeInTheDocument()
    expect(screen.getByText(lunchboxStoreName)).toBeInTheDocument()
    expect(
      fetchMock.mock.calls.some(([input]) => String(input).endsWith("/api/nearby-places")),
    ).toBe(false)
    expect(getCurrentPosition).not.toHaveBeenCalled()

    await user.click(buttons[0])
    expect(screen.queryByText(healthyStoreName)).not.toBeInTheDocument()
  })

  test("google nearby mode asks for geolocation", async () => {
    const user = userEvent.setup()
    const getCurrentPosition = vi.fn()
    __setNearbyRuntimeEnvForTests({
      VITE_NEARBY_MODE: "google",
      VITE_API_BASE_URL: "https://smart-diet-api.onrender.com",
    })
    Object.defineProperty(navigator, "geolocation", {
      value: { getCurrentPosition },
      configurable: true,
    })
    render(<App />)

    await screen.findByText(/Provider/)
    const buttons = await screen.findAllByRole("button", {
      name: "\u67e5\u770b\u9644\u8fd1\u5e97\u5bb6",
    })

    await user.click(buttons[0])

    expect(getCurrentPosition).toHaveBeenCalled()
  })

  test("google nearby mode calls nearby places API with location and meal context", async () => {
    const user = userEvent.setup()
    const fetchMock = vi.fn(mockOnlineApi())
    const getCurrentPosition = vi.fn((success: PositionCallback) =>
      success({
        coords: {
          latitude: 25.033,
          longitude: 121.5654,
          accuracy: 10,
          altitude: null,
          altitudeAccuracy: null,
          heading: null,
          speed: null,
        },
        timestamp: Date.now(),
      } as GeolocationPosition),
    )
    __setNearbyRuntimeEnvForTests({
      VITE_NEARBY_MODE: "google",
      VITE_API_BASE_URL: "https://smart-diet-api.onrender.com",
    })
    vi.stubGlobal("fetch", fetchMock)
    Object.defineProperty(navigator, "geolocation", {
      value: { getCurrentPosition },
      configurable: true,
    })
    render(<App />)

    await screen.findByText(/Provider/)
    const buttons = await screen.findAllByRole("button", {
      name: "\u67e5\u770b\u9644\u8fd1\u5e97\u5bb6",
    })

    await user.click(buttons[0])

    const nearbyCall = await waitFor(() => {
      const call = fetchMock.mock.calls.find(([input]) =>
        String(input).endsWith("/api/nearby-places"),
      )
      expect(call).toBeTruthy()
      return call
    })
    const body = JSON.parse(String(nearbyCall?.[1]?.body))

    expect(body).toMatchObject({
      lat: 25.033,
      lng: 121.5654,
      radiusMeters: 1500,
    })
    expect(body.mealName).toBeTruthy()
    expect(body.mealType).toBeTruthy()
    expect(body.tags).toEqual(expect.any(Array))
    expect(
      screen.queryByText(/\u6b63\u5728\u6a21\u64ec\u67e5\u8a62 Google Places/),
    ).not.toBeInTheDocument()
    expect(screen.queryByText("\u6e2c\u8a66\u5065\u5eb7\u9910\u5e97")).not.toBeInTheDocument()
    expect(await screen.findByText(/restaurant \/ food/)).toBeInTheDocument()
  })

  test("google nearby mode shows a location prompt when geolocation is denied", async () => {
    const user = userEvent.setup()
    const fetchMock = vi.fn(mockOnlineApi())
    const getCurrentPosition = vi.fn((_success: PositionCallback, error: PositionErrorCallback) =>
      error({
        code: 1,
        message: "denied",
        PERMISSION_DENIED: 1,
        POSITION_UNAVAILABLE: 2,
        TIMEOUT: 3,
      }),
    )
    __setNearbyRuntimeEnvForTests({
      VITE_NEARBY_MODE: "google",
      VITE_API_BASE_URL: "https://smart-diet-api.onrender.com",
    })
    vi.stubGlobal("fetch", fetchMock)
    Object.defineProperty(navigator, "geolocation", {
      value: { getCurrentPosition },
      configurable: true,
    })
    render(<App />)

    await screen.findByText(/Provider/)
    const buttons = await screen.findAllByRole("button", {
      name: "\u67e5\u770b\u9644\u8fd1\u5e97\u5bb6",
    })

    await user.click(buttons[0])

    expect(
      await screen.findByText(
        "\u555f\u7528\u5b9a\u4f4d\u4ee5\u67e5\u770b\u9644\u8fd1\u985e\u4f3c\u5e97\u5bb6",
      ),
    ).toBeInTheDocument()
    expect(
      fetchMock.mock.calls.some(([input]) => String(input).endsWith("/api/nearby-places")),
    ).toBe(false)
  })

  test("uses ice cream mock places for dessert meal cards", async () => {
    const user = userEvent.setup()
    const fetchMock = vi.fn(mockOnlineApi())
    vi.stubGlobal("fetch", fetchMock)
    window.localStorage.setItem(
      "smartDiet.localUserMeals",
      JSON.stringify([
        backendMealToMeal({
          ...cinnamonRollMeal,
          id: "local-ice-cream",
          mealName: "\u675c\u8001\u723a\u51b0\u54c1",
          mealType: "\u51b0\u54c1 / \u751c\u9ede",
          tags: ["\u51b0\u54c1", "\u751c\u9ede", "\u9ad8\u7cd6"],
        }),
      ]),
    )
    render(<App />)

    const dessertTitle = await screen.findByText("\u675c\u8001\u723a\u51b0\u54c1")
    const dessertCard = dessertTitle.closest("article")
    expect(dessertCard).not.toBeNull()

    await user.click(
      within(dessertCard as HTMLElement).getByRole("button", {
        name: "\u67e5\u770b\u9644\u8fd1\u5e97\u5bb6",
      }),
    )

    expect(
      within(dessertCard as HTMLElement).getByText("\u6e2c\u8a66\u51b0\u54c1\u5e97"),
    ).toBeInTheDocument()
    expect(
      within(dessertCard as HTMLElement).getByText("\u6e2c\u8a66\u4fbf\u5229\u5546\u5e97"),
    ).toBeInTheDocument()
    expect(
      within(dessertCard as HTMLElement).getByText("\u6e2c\u8a66\u8d85\u5e02"),
    ).toBeInTheDocument()
    expect(
      fetchMock.mock.calls.some(([input]) => String(input).endsWith("/api/nearby-places")),
    ).toBe(false)
  })

  test("rejects blank and duplicate custom diet tags", async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.click(screen.getByRole("button", { name: "新增標籤" }))
    expect(screen.getByText("標籤不可為空。")).toBeInTheDocument()

    await user.type(screen.getByLabelText("自訂飲食標籤"), "低鈉")
    await user.click(screen.getByRole("button", { name: "新增標籤" }))
    await user.type(screen.getByLabelText("自訂飲食標籤"), "低鈉")
    await user.click(screen.getByRole("button", { name: "新增標籤" }))
    expect(screen.getByText("此標籤已存在。")).toBeInTheDocument()
  })

  test("custom diet tag persists after rerender and can be deleted", async () => {
    const user = userEvent.setup()
    const { unmount } = render(<App />)

    await user.type(screen.getByLabelText("自訂飲食標籤"), "高纖")
    await user.click(screen.getByRole("button", { name: "新增標籤" }))
    expect(window.localStorage.getItem("smartDiet.customDietTags")).toContain("高纖")
    unmount()

    render(<App />)
    expect(await screen.findByLabelText("高纖")).toBeInTheDocument()
    await user.click(screen.getByLabelText("高纖"))
    await user.click(screen.getByRole("button", { name: "刪除高纖" }))
    expect(screen.queryByLabelText("高纖")).not.toBeInTheDocument()
    expect(window.localStorage.getItem("smartDiet.customDietTags")).not.toContain("高纖")
  })

  test("adds custom avoid ingredient and sends it in recommendation payload", async () => {
    const user = userEvent.setup()
    const fetchMock = vi.fn(mockOnlineApi())
    vi.stubGlobal("fetch", fetchMock)
    render(<App />)

    await user.type(screen.getByLabelText("自訂禁忌食材"), "不吃辣")
    await user.click(screen.getByRole("button", { name: "新增禁忌食材" }))
    await user.click(screen.getByLabelText("不吃辣"))
    await user.click(screen.getByRole("button", { name: "搜尋 / 推薦" }))

    expect(screen.getByText("禁忌食材已新增。")).toBeInTheDocument()
    const recommendCall = fetchMock.mock.calls.find(([input]) =>
      String(input).endsWith("/api/recommend"),
    )
    expect(JSON.parse(String(recommendCall?.[1]?.body)).excludedIngredients).toContain("不吃辣")
  })

  test("sends custom pork exclusion and shows empty result when backend filters all meals", async () => {
    const user = userEvent.setup()
    const fetchMock = vi.fn(mockOnlineApi())
    vi.stubGlobal("fetch", fetchMock)
    render(<App />)

    await user.type(screen.getByLabelText("自訂禁忌食材"), "豬肉")
    await user.click(screen.getByRole("button", { name: "新增禁忌食材" }))
    await user.click(screen.getByLabelText("豬肉"))
    await user.click(screen.getByRole("button", { name: "搜尋 / 推薦" }))

    const recommendCall = fetchMock.mock.calls.find(([input]) =>
      String(input).endsWith("/api/recommend"),
    )
    expect(JSON.parse(String(recommendCall?.[1]?.body)).excludedIngredients).toContain("豬肉")
    expect(
      await screen.findByText("目前沒有符合條件的完整餐點資料，請調整條件或補充餐點資訊。"),
    ).toBeInTheDocument()
  })

  test("sends custom meat category exclusion in recommendation payload", async () => {
    const user = userEvent.setup()
    const fetchMock = vi.fn(mockOnlineApi())
    vi.stubGlobal("fetch", fetchMock)
    render(<App />)

    await user.type(screen.getByLabelText("自訂禁忌食材"), "肉類")
    await user.click(screen.getByRole("button", { name: "新增禁忌食材" }))
    await user.click(screen.getByLabelText("肉類"))
    await user.click(screen.getByRole("button", { name: "搜尋 / 推薦" }))

    const recommendCall = fetchMock.mock.calls.find(([input]) =>
      String(input).endsWith("/api/recommend"),
    )
    expect(JSON.parse(String(recommendCall?.[1]?.body)).excludedIngredients).toContain("肉類")
    expect(
      await screen.findByText("目前沒有符合條件的完整餐點資料，請調整條件或補充餐點資訊。"),
    ).toBeInTheDocument()
  })

  test("sends meat and seafood exclusions when vegetarian tag is selected", async () => {
    const user = userEvent.setup()
    const fetchMock = vi.fn(mockOnlineApi())
    vi.stubGlobal("fetch", fetchMock)
    render(<App />)

    await user.click(screen.getByLabelText("素食"))
    await user.click(screen.getByRole("button", { name: "搜尋 / 推薦" }))

    const recommendCall = fetchMock.mock.calls.find(([input]) =>
      String(input).endsWith("/api/recommend"),
    )
    const payload = JSON.parse(String(recommendCall?.[1]?.body))
    expect(payload.tags).toContain("素食")
    expect(payload.excludedIngredients).toContain("肉類")
    expect(payload.excludedIngredients).toContain("海鮮")
  })

  test("offline local recommendation also excludes meat category constraints", async () => {
    const user = userEvent.setup()
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Promise.reject(new Error("offline"))),
    )
    render(<App />)

    await screen.findByText(/目前無法連線後端/)
    await user.type(screen.getByLabelText("自訂禁忌食材"), "肉類")
    await user.click(screen.getByRole("button", { name: "新增禁忌食材" }))
    await user.click(screen.getByLabelText("肉類"))
    await user.click(screen.getByRole("button", { name: "搜尋 / 推薦" }))

    const results = screen.getByLabelText("推薦清單")
    await waitFor(() => expect(within(results).queryByText("雞胸肉便當")).not.toBeInTheDocument())
    expect(within(results).queryByText("牛肉蔬菜飯")).not.toBeInTheDocument()
  })

  test("shows explicit loading state while recommendation is running", async () => {
    const user = userEvent.setup()
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input)
        if (url.endsWith("/api/health")) {
          return jsonResponse({
            status: "ok",
            aiProvider: "gemini",
            aiConfigured: true,
            model: "gemini-2.5-flash-lite",
            fallbackEnabled: true,
          })
        }
        if (url.endsWith("/api/meals")) return jsonResponse(backendMeals)
        if (url.endsWith("/api/recommend")) return delayedJsonResponse([backendMeals[0]], 300)
        return jsonResponse({ detail: "Not found" }, { status: 404 })
      }),
    )
    render(<App />)

    await user.click(screen.getByRole("button", { name: "搜尋 / 推薦" }))

    const loadingButton = screen.getByRole("button", { name: "篩選中..." })
    expect(loadingButton).toBeDisabled()
    expect(screen.getByText("正在根據條件篩選餐點...")).toBeInTheDocument()
    await waitFor(() =>
      expect(screen.queryByText("正在根據條件篩選餐點...")).not.toBeInTheDocument(),
    )
    expect(await screen.findByLabelText("最近查詢紀錄")).toBeInTheDocument()
  })

  test("excludes seafood meals through mocked recommendation API", async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.click(screen.getByLabelText("海鮮"))
    await user.click(screen.getByRole("button", { name: "搜尋 / 推薦" }))

    const results = screen.getByLabelText("推薦清單")
    await waitFor(() => expect(within(results).getByText("茶葉蛋")).toBeInTheDocument())
    expect(within(results).queryByText("海鮮粥")).not.toBeInTheDocument()
    expect(within(results).queryByText("鮭魚沙拉")).not.toBeInTheDocument()
  })

  test("shows no-result message", async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.type(screen.getByRole("searchbox"), "不存在的餐點")
    await user.click(screen.getByRole("button", { name: "搜尋 / 推薦" }))

    expect(
      await screen.findByText("目前沒有符合條件的完整餐點資料，請調整條件或補充餐點資訊。"),
    ).toBeInTheDocument()
  })

  test("does not render incomplete recommendation cards as normal results", async () => {
    const user = userEvent.setup()
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input)
        if (url.endsWith("/api/health")) {
          return jsonResponse({
            status: "ok",
            aiProvider: "gemini",
            aiConfigured: true,
            model: "gemini-2.5-flash-lite",
            fallbackEnabled: true,
          })
        }
        if (url.endsWith("/api/meals")) return jsonResponse(backendMeals)
        if (url.endsWith("/api/recommend")) return jsonResponse([incompleteMeal])
        return jsonResponse({ detail: "Not found" }, { status: 404 })
      }),
    )
    render(<App />)

    await user.click(screen.getByRole("button", { name: "搜尋 / 推薦" }))

    const results = screen.getByLabelText("推薦清單")
    await screen.findByText("目前沒有符合條件的完整餐點資料，請調整條件或補充餐點資訊。")
    expect(within(results).queryByText("湯包")).not.toBeInTheDocument()
  })

  test("adds query history after searching", async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.click(screen.getByLabelText("低卡"))
    await user.click(screen.getByRole("button", { name: "搜尋 / 推薦" }))

    const history = await screen.findByLabelText("最近查詢紀錄")
    expect(within(history).getByText("目標：均衡飲食")).toBeInTheDocument()
    expect(within(history).getByText("標籤：低卡")).toBeInTheDocument()
    expect(within(history).getByText(/結果數量：/)).toBeInTheDocument()
  })

  test("uses backend recommendation goals when provided", () => {
    const meal = backendMealToMeal(cinnamonRollMeal)

    expect(meal.goals).toEqual(["偶爾享用", "甜點", "高糖提醒"])
  })

  test("infers conservative goals for fried chicken cutlet", () => {
    const goals = inferGoals(friedChickenCutletMeal)

    expect(goals).toContain("增肌")
    expect(goals).toContain("高蛋白補充")
    expect(goals).toContain("偶爾享用")
    expect(goals).toContain("油炸提醒")
    expect(goals).not.toContain("健康維持")
    expect(goals).not.toContain("均衡飲食")
    expect(goals).not.toContain("減脂")
  })

  test("infers fat loss and health maintenance goals for lean high-protein meals", () => {
    const goals = inferGoals(leanChickenMeal)

    expect(goals).toContain("減脂")
    expect(goals).toContain("健康維持")
    expect(goals).toContain("均衡飲食")
    expect(goals).toContain("增肌")
  })
})
