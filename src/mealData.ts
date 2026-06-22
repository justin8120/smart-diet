export type HealthGoal = "減脂" | "增肌" | "均衡飲食" | "健康維持"
export type MealGoal =
  | HealthGoal
  | "高蛋白補充"
  | "偶爾享用"
  | "甜點"
  | "高糖提醒"
  | "油炸提醒"
  | string

export type DietTag =
  | "低卡"
  | "高蛋白"
  | "低脂"
  | "健康餐"
  | "素食"
  | "甜點"
  | "烘焙"
  | "炸物"
  | "高糖"
  | "高脂肪"
  | string

export type Allergen = "花生" | "牛肉" | "海鮮" | "乳製品" | "蛋" | "麩質" | string

export type MealSourceType = "文字" | "圖片" | "連結" | "資料集"

export type Meal = {
  id: string
  name: string
  type: string
  calories: number
  protein: number
  tags: DietTag[]
  goals: MealGoal[]
  ingredients: string[]
  allergens: Allergen[]
  reason: string
  confidence?: number
  warningMessage?: string
  nutritionNote?: string
  sourceType?: MealSourceType
  createdAt?: string
  isAiGenerated?: boolean
  pendingSync?: boolean
  localOnly?: boolean
  syncError?: string
}

export const healthGoals: HealthGoal[] = ["減脂", "增肌", "均衡飲食", "健康維持"]

export const dietTags: DietTag[] = ["低卡", "高蛋白", "低脂", "健康餐", "素食"]

export const allergens: Allergen[] = ["花生", "牛肉", "海鮮", "乳製品"]

export const meals: Meal[] = [
  {
    id: "chicken-bento",
    name: "雞胸肉便當",
    type: "健康便當",
    calories: 480,
    protein: 38,
    tags: ["高蛋白", "低脂", "健康餐"],
    goals: ["減脂", "增肌", "均衡飲食"],
    ingredients: ["雞胸肉", "蔬菜", "糙米飯", "花椰菜"],
    allergens: [],
    reason: "雞胸肉提供充足蛋白質，搭配糙米與蔬菜，適合作為日常均衡餐點。",
    sourceType: "資料集",
  },
  {
    id: "tea-egg",
    name: "茶葉蛋",
    type: "蛋白點心",
    calories: 80,
    protein: 7,
    tags: ["低卡", "高蛋白", "低脂"],
    goals: ["減脂", "均衡飲食", "健康維持"],
    ingredients: ["雞蛋", "茶葉", "醬油", "香料"],
    allergens: ["蛋"],
    reason: "茶葉蛋熱量低且含蛋白質，適合作為份量較小的蛋白質補充。",
    sourceType: "資料集",
  },
  {
    id: "salmon-salad",
    name: "鮭魚沙拉",
    type: "沙拉",
    calories: 360,
    protein: 28,
    tags: ["低卡", "高蛋白", "健康餐"],
    goals: ["減脂", "均衡飲食", "健康維持"],
    ingredients: ["鮭魚", "生菜", "番茄", "酪梨"],
    allergens: ["海鮮"],
    reason: "鮭魚提供蛋白質與脂肪酸，搭配蔬菜可作為清爽主餐。",
    sourceType: "資料集",
  },
  {
    id: "tofu-veggie-bowl",
    name: "豆腐蔬菜碗",
    type: "素食餐",
    calories: 410,
    protein: 22,
    tags: ["低卡", "低脂", "健康餐", "素食"],
    goals: ["減脂", "均衡飲食", "健康維持"],
    ingredients: ["豆腐", "蔬菜", "藜麥", "菇類"],
    allergens: [],
    reason: "豆腐與藜麥提供植物性蛋白質，適合想增加蔬食比例的使用者。",
    sourceType: "資料集",
  },
  {
    id: "oat-yogurt-cup",
    name: "燕麥優格杯",
    type: "早餐",
    calories: 290,
    protein: 18,
    tags: ["低卡", "低脂", "健康餐"],
    goals: ["減脂", "均衡飲食", "健康維持"],
    ingredients: ["燕麥", "無糖優格", "莓果", "堅果"],
    allergens: ["乳製品"],
    reason: "燕麥與優格能提供飽足感與蛋白質，適合作為早餐或點心。",
    sourceType: "資料集",
  },
  {
    id: "beef-veggie-rice",
    name: "牛肉蔬菜飯",
    type: "飯類",
    calories: 610,
    protein: 40,
    tags: ["高蛋白", "健康餐"],
    goals: ["增肌", "均衡飲食"],
    ingredients: ["牛肉", "蔬菜", "白飯", "洋蔥"],
    allergens: ["牛肉"],
    reason: "牛肉提供較高蛋白質，適合蛋白質需求較高者，但牛肉禁忌者需避開。",
    sourceType: "資料集",
  },
  {
    id: "sweet-potato-egg-plate",
    name: "地瓜雞蛋餐",
    type: "輕食",
    calories: 330,
    protein: 16,
    tags: ["低卡", "低脂", "健康餐"],
    goals: ["減脂", "均衡飲食", "健康維持"],
    ingredients: ["地瓜", "雞蛋", "小黃瓜", "生菜"],
    allergens: ["蛋"],
    reason: "地瓜提供碳水與纖維，雞蛋補充蛋白質，適合作為輕量餐點。",
    sourceType: "資料集",
  },
  {
    id: "seafood-congee",
    name: "海鮮粥",
    type: "粥品",
    calories: 420,
    protein: 25,
    tags: ["低脂", "健康餐"],
    goals: ["均衡飲食", "健康維持"],
    ingredients: ["白飯", "蝦仁", "蛤蜊", "魚片"],
    allergens: ["海鮮"],
    reason: "粥品口感溫和並含海鮮蛋白質，但海鮮禁忌者需避免。",
    sourceType: "資料集",
  },
  {
    id: "veggie-bento",
    name: "蔬食便當",
    type: "素食便當",
    calories: 450,
    protein: 20,
    tags: ["低脂", "健康餐", "素食"],
    goals: ["均衡飲食", "健康維持"],
    ingredients: ["豆製品", "蔬菜", "糙米飯", "菇類"],
    allergens: [],
    reason: "蔬食便當能增加纖維與植化素攝取，適合作為日常均衡選擇。",
    sourceType: "資料集",
  },
]
