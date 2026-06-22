import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from uuid import uuid4

from app.models import MealAnalysisResult
from app.services.ai_provider import (
    normalize_meal_name,
    normalize_user_facing_list,
    normalize_user_facing_text,
)


DEFAULT_REASON = (
    "\u7cfb\u7d71\u6839\u64da\u9910\u9ede\u540d\u7a31\u8207\u53ef\u898b\u98df\u6750"
    "\u9032\u884c\u5206\u6790\uff0c\u4e26\u53c3\u8003\u5e38\u898b\u9910\u9ede\u7d44\u6210"
    "\u4f30\u7b97\u71b1\u91cf\u3001\u86cb\u767d\u8cea\u8207\u53ef\u80fd\u904e\u654f\u539f\u3002"
)
BUTADON_REASON = (
    "\u7cfb\u7d71\u8fa8\u8b58\u6b64\u9910\u9ede\u70ba\u8c5a\u4e3c\u3002"
    "\u96d6\u7136\u7167\u7247\u4e2d\u6709\u86cb\u8207\u767d\u98ef\uff0c"
    "\u5916\u89c0\u5bb9\u6613\u8207\u89aa\u5b50\u4e3c\u6df7\u6dc6\uff0c"
    "\u4f46\u756b\u9762\u4e2d\u7684\u8089\u7247\u8f03\u63a5\u8fd1\u8c6c\u8089\u7247\uff0c"
    "\u4e14\u672a\u660e\u78ba\u770b\u5230\u96de\u8089\u584a\uff0c\u56e0\u6b64\u5224\u65b7\u70ba\u8c5a\u4e3c\u3002"
)
KATSUDON_REASON = (
    "\u7cfb\u7d71\u8fa8\u8b58\u6b64\u9910\u9ede\u70ba\u8c6c\u6392\u4e3c\uff0c"
    "\u4e3b\u8981\u7531\u767d\u98ef\u3001\u70b8\u8c6c\u6392\u3001\u96de\u86cb\u8207\u6d0b\u8525\u7d44\u6210\u3002"
    "\u6b64\u9910\u9ede\u86cb\u767d\u8cea\u542b\u91cf\u8f03\u9ad8\uff0c"
    "\u4f46\u56e0\u542b\u70b8\u7269\uff0c\u71b1\u91cf\u8207\u6cb9\u8102\u4e5f\u76f8\u5c0d\u8f03\u9ad8\uff0c"
    "\u5efa\u8b70\u63a7\u5236\u4efd\u91cf\u4e26\u642d\u914d\u852c\u83dc\u3002"
)
CHICKEN_STEAK_NOODLES_REASON = (
    "\u7cfb\u7d71\u8fa8\u8b58\u6b64\u9910\u9ede\u70ba\u96de\u6392\u9eb5\uff0c"
    "\u4e3b\u8981\u7531\u9eb5\u689d\u3001\u96de\u6392\u8207\u9752\u83dc\u7d44\u6210\u3002"
    "\u6b64\u9910\u9ede\u86cb\u767d\u8cea\u542b\u91cf\u8f03\u9ad8\uff0c"
    "\u4f46\u82e5\u96de\u6392\u70ba\u6cb9\u70b8\u6599\u7406\uff0c"
    "\u71b1\u91cf\u8207\u6cb9\u8102\u4e5f\u6703\u504f\u9ad8\uff0c"
    "\u5efa\u8b70\u642d\u914d\u852c\u83dc\u4e26\u63a7\u5236\u4efd\u91cf\u3002"
)
FRIED_CHICKEN_CUTLET_REASON = (
    "\u7cfb\u7d71\u6839\u64da\u5716\u7247\u4e2d\u53ef\u898b\u7684\u5927\u578b\u88f9\u7c89"
    "\u6cb9\u70b8\u96de\u6392\u5224\u65b7\u6b64\u9910\u9ede\u70ba\u70b8\u96de\u6392\u3002"
    "\u5716\u7247\u4e2d\u672a\u660e\u78ba\u770b\u5230\u9eb5\u689d\u6216\u6e6f\u54c1\uff0c"
    "\u56e0\u6b64\u4e0d\u5224\u65b7\u70ba\u96de\u6392\u9eb5\u3002"
    "\u6b64\u9910\u9ede\u86cb\u767d\u8cea\u542b\u91cf\u8f03\u9ad8\uff0c"
    "\u4f46\u6cb9\u70b8\u6599\u7406\u71b1\u91cf\u8207\u6cb9\u8102\u4e5f\u8f03\u9ad8\uff0c"
    "\u5efa\u8b70\u63a7\u5236\u4efd\u91cf\u3002"
)
STEAK_EGG_NOODLES_REASON = (
    "\u7cfb\u7d71\u8fa8\u8b58\u6b64\u9910\u9ede\u70ba\u725b\u6392\u86cb\u9eb5\uff0c"
    "\u4e3b\u8981\u7531\u9eb5\u689d\u3001\u725b\u6392\u3001\u96de\u86cb\u8207\u9752\u83dc\u7d44\u6210\u3002"
    "\u6b64\u9910\u9ede\u86cb\u767d\u8cea\u542b\u91cf\u8f03\u9ad8\uff0c"
    "\u4f46\u4efd\u91cf\u8207\u8abf\u5473\u53ef\u80fd\u4f7f\u71b1\u91cf\u504f\u9ad8\uff0c"
    "\u5efa\u8b70\u642d\u914d\u852c\u83dc\u4e26\u7559\u610f\u91ac\u6599\u651d\u53d6\u3002"
)
SOUP_DUMPLING_REASON = (
    "\u7cfb\u7d71\u8fa8\u8b58\u6b64\u9910\u9ede\u70ba\u5c0f\u7c60\u5305\uff0c"
    "\u4e3b\u8981\u7531\u9eb5\u76ae\u3001\u8089\u9921\u8207\u6e6f\u6c41\u7d44\u6210\u3002"
    "\u6b64\u985e\u9910\u9ede\u71b1\u91cf\u591a\u4f86\u81ea\u9eb5\u76ae\u8207\u8089\u9921\uff0c"
    "\u5efa\u8b70\u6ce8\u610f\u4efd\u91cf\u8207\u9209\u542b\u91cf\u3002"
)
WATERMELON_REASON = (
    "\u7cfb\u7d71\u6839\u64da\u4f7f\u7528\u8005\u63d0\u4f9b\u7684\u6587\u5b57\u63cf\u8ff0"
    "\u5224\u65b7\u6b64\u9910\u9ede\u70ba\u897f\u74dc\u3002\u897f\u74dc\u542b\u6c34\u91cf\u9ad8\u3001"
    "\u71b1\u91cf\u8f03\u4f4e\uff0c\u9069\u5408\u4f5c\u70ba\u9ede\u5fc3\u6216\u98ef\u5f8c\u6c34\u679c\uff0c"
    "\u4f46\u4ecd\u5efa\u8b70\u7559\u610f\u4efd\u91cf\u8207\u7cd6\u5206\u651d\u53d6\u3002"
)
PEANUT_REASON = (
    "\u7cfb\u7d71\u6839\u64da\u4f7f\u7528\u8005\u63d0\u4f9b\u7684\u6587\u5b57\u63cf\u8ff0"
    "\u5224\u65b7\u6b64\u9805\u76ee\u70ba\u82b1\u751f\u3002\u82b1\u751f\u542b\u6709\u86cb\u767d\u8cea"
    "\u8207\u8102\u80aa\uff0c\u71b1\u91cf\u8f03\u9ad8\uff0c\u9069\u5408\u4f5c\u70ba\u5c11\u91cf\u9ede\u5fc3"
    "\u6216\u71df\u990a\u88dc\u5145\uff0c\u4f46\u5c0d\u82b1\u751f\u904e\u654f\u8005\u61c9\u907f\u514d\u98df\u7528\u3002"
)
INGREDIENT_ANALYSIS_REASON = "此結果較接近單一食材分析，可作為後續餐點搭配與推薦參考。"
INGREDIENT_ANALYSIS_NOTE = "此結果為食材分析，營養數值僅供後續搭配餐點時參考。"
URL_CONSERVATIVE_REASON = (
    "\u7cfb\u7d71\u5df2\u63a5\u6536\u9910\u9ede\u9023\u7d50\uff0c"
    "\u4f46\u7121\u6cd5\u5b8c\u6574\u89e3\u6790\u8a72\u9801\u9762\u7684\u83dc\u55ae\u5167\u5bb9\uff0c"
    "\u56e0\u6b64\u50c5\u80fd\u6839\u64da\u53ef\u53d6\u5f97\u7684\u9910\u9ede\u540d\u7a31\u6216"
    "\u9810\u8a2d\u8cc7\u6599\u9032\u884c\u521d\u6b65\u4f30\u7b97\u3002"
    "\u5efa\u8b70\u88dc\u5145\u9910\u9ede\u540d\u7a31\u6216\u4e3b\u8981\u98df\u6750\u4ee5\u63d0\u9ad8\u6e96\u78ba\u5ea6\u3002"
)
CINNAMON_SWIRL_REASON = (
    "\u7cfb\u7d71\u6839\u64da URL \u7522\u54c1\u540d\u7a31\u63a8\u6e2c\u70ba\u8089\u6842\u6372\uff0c"
    "\u5c6c\u65bc\u751c\u9ede\u8207\u70d8\u7119\u9ede\u5fc3\uff0c\u7cd6\u5206\u8207\u78b3\u6c34\u5316\u5408\u7269\u8f03\u9ad8\uff0c"
    "\u5efa\u8b70\u5076\u723e\u4eab\u7528\u3002"
)
LIMITED_INFO_WARNING = "此結果為 AI 根據有限資訊推測，實際營養與成分仍需以包裝標示或店家資料為準。"
DULOA_ICE_CREAM_REASON = (
    "系統根據使用者提供的品牌或圖片線索推測此項目為杜老爺相關冰品。"
    "冰品與甜點通常糖分較高，營養與成分仍需以包裝標示或店家資料為準。"
)
RECOMMENDATION_CATEGORIES_PATH = Path(__file__).resolve().parents[2] / "data" / "recommendation_categories.json"

KNOWN_MEALS: dict[str, dict[str, Any]] = {
    "豬肉片": {
        "estimatedCalories": 250,
        "estimatedProtein": 20,
        "mealType": "食材 / 肉類",
        "tags": ["食材", "肉類", "豬肉", "高蛋白"],
        "mainIngredients": ["豬肉"],
        "allergens": [],
        "recommendationReason": INGREDIENT_ANALYSIS_REASON,
        "nutritionNote": INGREDIENT_ANALYSIS_NOTE,
    },
    "雞胸肉": {
        "estimatedCalories": 165,
        "estimatedProtein": 31,
        "mealType": "食材 / 肉類",
        "tags": ["食材", "肉類", "雞肉", "高蛋白", "低脂"],
        "mainIngredients": ["雞胸肉"],
        "allergens": [],
        "recommendationReason": INGREDIENT_ANALYSIS_REASON,
        "nutritionNote": INGREDIENT_ANALYSIS_NOTE,
    },
    "牛肉片": {
        "estimatedCalories": 250,
        "estimatedProtein": 26,
        "mealType": "食材 / 肉類",
        "tags": ["食材", "肉類", "牛肉", "高蛋白"],
        "mainIngredients": ["牛肉"],
        "allergens": [],
        "recommendationReason": INGREDIENT_ANALYSIS_REASON,
        "nutritionNote": INGREDIENT_ANALYSIS_NOTE,
    },
    "豆腐": {
        "estimatedCalories": 80,
        "estimatedProtein": 8,
        "mealType": "食材 / 豆類",
        "tags": ["食材", "豆類", "植物性蛋白"],
        "mainIngredients": ["豆腐"],
        "allergens": ["大豆"],
        "recommendationReason": INGREDIENT_ANALYSIS_REASON,
        "nutritionNote": INGREDIENT_ANALYSIS_NOTE,
    },
    "青菜": {
        "estimatedCalories": 30,
        "estimatedProtein": 2,
        "mealType": "食材 / 蔬菜",
        "tags": ["食材", "蔬菜", "低熱量"],
        "mainIngredients": ["青菜"],
        "allergens": [],
        "recommendationReason": INGREDIENT_ANALYSIS_REASON,
        "nutritionNote": INGREDIENT_ANALYSIS_NOTE,
    },
    "鮭魚": {
        "estimatedCalories": 208,
        "estimatedProtein": 20,
        "mealType": "食材 / 魚類",
        "tags": ["食材", "魚類", "高蛋白"],
        "mainIngredients": ["鮭魚"],
        "allergens": ["魚"],
        "recommendationReason": INGREDIENT_ANALYSIS_REASON,
        "nutritionNote": INGREDIENT_ANALYSIS_NOTE,
    },
    "杜老爺": {
        "estimatedCalories": 260,
        "estimatedProtein": 4,
        "mealType": "冰品 / 甜點",
        "tags": ["冰品", "甜點", "高糖"],
        "mainIngredients": [],
        "allergens": ["乳製品"],
        "recommendationReason": DULOA_ICE_CREAM_REASON,
        "warningMessage": LIMITED_INFO_WARNING,
        "nutritionNote": "僅能依品牌與食品類型做粗略估算，若需更準確資訊請參考包裝營養標示。",
    },
    "杜老爺冰品": {
        "estimatedCalories": 260,
        "estimatedProtein": 4,
        "mealType": "冰品 / 甜點",
        "tags": ["冰品", "甜點", "高糖"],
        "mainIngredients": [],
        "allergens": ["乳製品"],
        "recommendationReason": DULOA_ICE_CREAM_REASON,
        "warningMessage": LIMITED_INFO_WARNING,
        "nutritionNote": "僅能依品牌與食品類型做粗略估算，若需更準確資訊請參考包裝營養標示。",
    },
    "\u5c0f\u7c60\u5305": {
        "estimatedCalories": 380,
        "estimatedProtein": 16,
        "mealType": "\u4e2d\u5f0f\u9ede\u5fc3",
        "tags": ["\u4e2d\u5f0f", "\u9ede\u5fc3", "\u9eb5\u98df"],
        "mainIngredients": ["\u9eb5\u76ae", "\u8c6c\u8089\u9921", "\u6e6f\u6c41"],
        "allergens": ["\u9ea9\u8cea"],
        "recommendationReason": SOUP_DUMPLING_REASON,
    },
    "\u897f\u74dc": {
        "estimatedCalories": 30,
        "estimatedProtein": 1,
        "mealType": "食材 / 水果",
        "tags": ["食材", "\u6c34\u679c", "\u4f4e\u71b1\u91cf", "\u6c34\u5206\u9ad8"],
        "mainIngredients": ["\u897f\u74dc"],
        "allergens": [],
        "recommendationReason": WATERMELON_REASON,
        "nutritionNote": INGREDIENT_ANALYSIS_NOTE,
    },
    "\u82b1\u751f": {
        "estimatedCalories": 567,
        "estimatedProtein": 26,
        "mealType": "\u5805\u679c / \u8c46\u985e\u98df\u6750",
        "tags": ["食材", "\u5805\u679c", "\u9ad8\u86cb\u767d", "\u9ad8\u8102\u80aa"],
        "mainIngredients": ["\u82b1\u751f"],
        "allergens": ["\u82b1\u751f"],
        "recommendationReason": PEANUT_REASON,
        "nutritionNote": INGREDIENT_ANALYSIS_NOTE,
    },
    "\u8089\u6842\u6372": {
        "estimatedCalories": 320,
        "estimatedProtein": 6,
        "mealType": "\u751c\u9ede / \u70d8\u7119\u9ede\u5fc3",
        "tags": ["\u751c\u9ede", "\u70d8\u7119", "\u9ad8\u7cd6", "\u9ad8\u78b3\u6c34"],
        "mainIngredients": ["\u9eb5\u7c89", "\u7cd6", "\u8089\u6842", "\u5976\u6cb9"],
        "allergens": ["\u9ea9\u8cea", "\u5976\u985e"],
        "recommendationReason": CINNAMON_SWIRL_REASON,
    },
    "\u725b\u6392\u86cb\u9eb5": {
        "estimatedCalories": 850,
        "estimatedProtein": 38,
        "mealType": "\u725b\u6392\u9eb5",
        "tags": ["\u725b\u6392", "\u9eb5\u98df", "\u9ad8\u86cb\u767d"],
        "mainIngredients": ["\u9eb5\u689d", "\u725b\u6392", "\u96de\u86cb", "\u9752\u83dc", "\u9ad8\u6e6f"],
        "allergens": ["\u86cb", "\u9ea9\u8cea"],
        "recommendationReason": STEAK_EGG_NOODLES_REASON,
    },
    "\u725b\u6392\u9eb5": {
        "estimatedCalories": 900,
        "estimatedProtein": 42,
        "mealType": "\u725b\u6392\u9eb5",
        "tags": ["\u725b\u6392", "\u9eb5\u98df", "\u725b\u8089", "\u9ad8\u86cb\u767d"],
        "mainIngredients": ["\u9eb5\u689d", "\u725b\u6392", "\u9752\u83dc", "\u9ad8\u6e6f"],
        "allergens": ["\u9ea9\u8cea"],
    },
    "\u96de\u6392\u86cb\u9eb5": {
        "estimatedCalories": 850,
        "estimatedProtein": 40,
        "mealType": "\u9eb5\u98df",
        "tags": ["\u9eb5\u98df", "\u96de\u8089", "\u9ad8\u86cb\u767d"],
        "mainIngredients": ["\u9eb5\u689d", "\u96de\u6392", "\u96de\u86cb", "\u9752\u83dc", "\u9ad8\u6e6f"],
        "allergens": ["\u86cb", "\u9ea9\u8cea"],
        "recommendationReason": CHICKEN_STEAK_NOODLES_REASON,
    },
    "\u725b\u6392\u86cb": {
        "estimatedCalories": 700,
        "estimatedProtein": 42,
        "mealType": "\u86cb\u767d\u8cea\u9910",
        "tags": ["\u725b\u8089", "\u9ad8\u86cb\u767d"],
        "mainIngredients": ["\u725b\u6392", "\u96de\u86cb"],
        "allergens": ["\u86cb"],
    },
    "\u725b\u6392": {
        "estimatedCalories": 650,
        "estimatedProtein": 40,
        "mealType": "\u86cb\u767d\u8cea\u9910",
        "tags": ["\u725b\u8089", "\u9ad8\u86cb\u767d"],
        "mainIngredients": ["\u725b\u6392"],
        "allergens": [],
    },
    "\u96de\u86cb": {
        "estimatedCalories": 80,
        "estimatedProtein": 7,
        "mealType": "食材 / 蛋類",
        "tags": ["食材", "蛋類", "\u9ad8\u86cb\u767d"],
        "mainIngredients": ["\u96de\u86cb"],
        "allergens": ["\u86cb"],
        "recommendationReason": INGREDIENT_ANALYSIS_REASON,
        "nutritionNote": INGREDIENT_ANALYSIS_NOTE,
    },
    "\u96de\u6392\u9eb5": {
        "estimatedCalories": 850,
        "estimatedProtein": 38,
        "mealType": "\u9eb5\u98df",
        "tags": ["\u9eb5\u98df", "\u96de\u8089", "\u9ad8\u86cb\u767d"],
        "mainIngredients": ["\u9eb5\u689d", "\u96de\u6392", "\u9752\u83dc", "\u9ad8\u6e6f"],
        "allergens": ["\u9ea9\u8cea"],
        "recommendationReason": CHICKEN_STEAK_NOODLES_REASON,
    },
    "\u96de\u6392": {
        "estimatedCalories": 600,
        "estimatedProtein": 35,
        "mealType": "\u70b8\u7269 / \u5c0f\u5403",
        "tags": ["\u96de\u8089", "\u70b8\u7269", "\u9ad8\u86cb\u767d"],
        "mainIngredients": ["\u96de\u8089", "\u9eb5\u8863", "\u6cb9"],
        "allergens": ["\u9ea9\u8cea"],
        "recommendationReason": FRIED_CHICKEN_CUTLET_REASON,
    },
    "\u70b8\u96de\u6392": {
        "estimatedCalories": 600,
        "estimatedProtein": 35,
        "mealType": "\u70b8\u7269 / \u5c0f\u5403",
        "tags": ["\u70b8\u7269", "\u96de\u8089", "\u9ad8\u86cb\u767d"],
        "mainIngredients": ["\u96de\u8089", "\u9eb5\u8863", "\u6cb9"],
        "allergens": ["\u9ea9\u8cea"],
        "recommendationReason": FRIED_CHICKEN_CUTLET_REASON,
    },
    "\u96de\u8089\u9eb5": {
        "estimatedCalories": 650,
        "estimatedProtein": 32,
        "mealType": "\u9eb5\u98df",
        "tags": ["\u9eb5\u98df", "\u96de\u8089"],
        "mainIngredients": ["\u9eb5\u689d", "\u96de\u8089", "\u9752\u83dc", "\u9ad8\u6e6f"],
        "allergens": ["\u9ea9\u8cea"],
    },
    "\u9eb5\u98df": {
        "estimatedCalories": 600,
        "estimatedProtein": 20,
        "mealType": "\u9eb5\u98df",
        "tags": ["\u9eb5\u98df"],
        "mainIngredients": ["\u9eb5\u689d", "\u9ad8\u6e6f"],
        "allergens": ["\u9ea9\u8cea"],
    },
    "\u8c5a\u4e3c": {
        "estimatedCalories": 650,
        "estimatedProtein": 28,
        "mealType": "\u65e5\u5f0f\u4e3c\u98ef",
        "tags": ["\u65e5\u5f0f", "\u4e3c\u98ef", "\u8c6c\u8089"],
        "mainIngredients": ["\u767d\u98ef", "\u8c6c\u8089\u7247", "\u96de\u86cb", "\u6d77\u82d4"],
        "allergens": ["\u86cb"],
        "recommendationReason": BUTADON_REASON,
    },
    "\u8c6c\u6392\u4e3c": {
        "estimatedCalories": 780,
        "estimatedProtein": 32,
        "mealType": "\u65e5\u5f0f\u4e3c\u98ef",
        "tags": ["\u65e5\u5f0f", "\u4e3c\u98ef", "\u70b8\u7269", "\u8c6c\u8089"],
        "mainIngredients": ["\u767d\u98ef", "\u70b8\u8c6c\u6392", "\u96de\u86cb", "\u6d0b\u8525"],
        "allergens": ["\u86cb", "\u9ea9\u8cea"],
        "recommendationReason": KATSUDON_REASON,
    },
    "\u89aa\u5b50\u4e3c": {
        "estimatedCalories": 620,
        "estimatedProtein": 30,
        "mealType": "\u65e5\u5f0f\u4e3c\u98ef",
        "tags": ["\u65e5\u5f0f", "\u4e3c\u98ef", "\u96de\u8089"],
        "mainIngredients": ["\u767d\u98ef", "\u96de\u8089", "\u96de\u86cb", "\u6d0b\u8525"],
        "allergens": ["\u86cb"],
    },
    "\u725b\u4e3c": {
        "estimatedCalories": 700,
        "estimatedProtein": 30,
        "mealType": "\u65e5\u5f0f\u4e3c\u98ef",
        "tags": ["\u65e5\u5f0f", "\u4e3c\u98ef", "\u725b\u8089"],
        "mainIngredients": ["\u767d\u98ef", "\u725b\u8089\u7247", "\u6d0b\u8525"],
        "allergens": [],
    },
    "\u8766\u4ec1\u7092\u98ef": {
        "estimatedCalories": 650,
        "estimatedProtein": 22,
        "mealType": "\u98ef\u985e",
        "tags": ["\u98ef\u985e", "\u6d77\u9bae", "\u4e2d\u5f0f\u6599\u7406"],
        "mainIngredients": ["\u8766\u4ec1", "\u767d\u98ef", "\u96de\u86cb", "\u9752\u8525"],
        "allergens": ["\u8766", "\u86cb"],
    },
    "\u7092\u98ef": {
        "estimatedCalories": 620,
        "estimatedProtein": 18,
        "mealType": "\u98ef\u985e",
        "tags": ["\u98ef\u985e", "\u4e2d\u5f0f\u6599\u7406"],
        "mainIngredients": ["\u767d\u98ef", "\u96de\u86cb", "\u9752\u8525"],
        "allergens": ["\u86cb"],
    },
    "\u96de\u80f8\u8089\u5065\u5eb7\u9910": {
        "estimatedCalories": 420,
        "estimatedProtein": 32,
        "mealType": "\u5065\u5eb7\u9910",
        "tags": ["\u4f4e\u5361", "\u9ad8\u86cb\u767d"],
        "mainIngredients": ["\u96de\u80f8\u8089", "\u852c\u83dc", "\u7cd9\u7c73"],
        "allergens": [],
    },
}


def normalize_and_enrich_result(result: MealAnalysisResult | dict[str, Any], original_text: str | None = None) -> MealAnalysisResult:
    payload = result.model_dump() if isinstance(result, MealAnalysisResult) else dict(result)
    payload = _coerce_payload_aliases(payload)
    structured = _parse_structured_description(original_text or "")
    if structured.get("mealName"):
        payload["mealName"] = structured["mealName"]
    if structured.get("mealType"):
        payload["mealType"] = structured["mealType"]
    if structured.get("tags"):
        payload["tags"] = _merge_lists(_string_list(payload.get("tags")), structured["tags"])
    if structured.get("mainIngredients"):
        payload["mainIngredients"] = _merge_lists(
            _string_list(payload.get("mainIngredients")),
            structured["mainIngredients"],
        )
    source_type = payload.get("sourceType") if payload.get("sourceType") in {"text", "image", "url"} else "text"
    meal_name = normalize_meal_name(str(payload.get("mealName") or original_text or "\u672a\u547d\u540d\u9910\u9ede"))
    original_meal_name = normalize_meal_name(str(original_text or ""))
    if _is_generic_name(meal_name) and original_meal_name in KNOWN_MEALS:
        meal_name = original_meal_name
    if _is_generic_name(meal_name):
        inferred_name = _infer_name_from_context(original_text or "")
        if inferred_name:
            meal_name = inferred_name
    if meal_name == "杜老爺":
        meal_name = "杜老爺冰品"
    meal_name = _contextual_meal_name(meal_name, payload, original_text)
    known = KNOWN_MEALS.get(meal_name, {})
    raw_meal_type = normalize_user_facing_text(str(payload.get("mealType") or ""))
    meal_type = str(known.get("mealType") or "") if _is_generic_meal_type(raw_meal_type) else raw_meal_type
    if meal_name == "杜老爺冰品" and known.get("mealType"):
        meal_type = str(known["mealType"])
    tags = _merge_lists(_string_list(payload.get("tags")), _string_list(known.get("tags")))
    main_ingredients = [
        ingredient
        for ingredient in _merge_lists(_string_list(payload.get("mainIngredients")), _string_list(known.get("mainIngredients")))
        if not _is_invalid_user_value(ingredient)
    ]
    allergens = _merge_lists(_string_list(payload.get("allergens")), _string_list(known.get("allergens")))
    if meal_name == "杜老爺冰品":
        tags = _string_list(known.get("tags"))
        main_ingredients = _string_list(known.get("mainIngredients"))
        allergens = _string_list(known.get("allergens"))

    calories = _positive_float(payload.get("estimatedCalories")) or _positive_float(known.get("estimatedCalories"))
    protein = _positive_float(payload.get("estimatedProtein")) or _positive_float(known.get("estimatedProtein"))

    if not meal_type:
        meal_type = _infer_type(meal_name, tags)
    if not calories or not protein:
        estimated = _estimate_by_type(meal_type, tags)
        calories = calories or estimated["estimatedCalories"]
        protein = protein or estimated["estimatedProtein"]
    if not main_ingredients and known.get("mainIngredients"):
        main_ingredients = _string_list(known["mainIngredients"])
    warning_message = normalize_user_facing_text(str(payload.get("warningMessage") or known.get("warningMessage") or ""))
    nutrition_note = normalize_user_facing_text(str(payload.get("nutritionNote") or known.get("nutritionNote") or ""))
    allows_limited_ingredients = bool(warning_message or nutrition_note)
    if not main_ingredients and not allows_limited_ingredients:
        main_ingredients = ["\u4e3b\u8981\u98df\u6750\u5f85\u78ba\u8a8d"]

    allergens = _merge_lists(allergens, _infer_allergens(main_ingredients))
    reason = normalize_user_facing_text(str(payload.get("recommendationReason") or known.get("recommendationReason") or ""))
    if _is_forbidden_reason(reason) or _is_generic_reason(reason) or not reason:
        reason = str(known.get("recommendationReason") or DEFAULT_REASON)

    confidence = max(0, min(float(payload.get("confidence") or 0.55), 1))
    if source_type == "url" and (_has_stale_image_hint_reason(reason) or _has_incomplete_ingredients(main_ingredients)):
        reason = URL_CONSERVATIVE_REASON
    confidence = calibrate_confidence(
        {
            **payload,
            "mealName": meal_name,
            "mealType": meal_type,
            "estimatedCalories": calories,
            "estimatedProtein": protein,
            "tags": tags,
            "mainIngredients": main_ingredients,
            "recommendationReason": reason,
            "confidence": confidence,
            "sourceType": source_type,
            "warningMessage": warning_message,
            "nutritionNote": nutrition_note,
        },
        source_type=source_type,
        validation_errors=validate_analysis_result(
            {
                **payload,
                "mealName": meal_name,
                "mealType": meal_type,
                "estimatedCalories": calories,
                "estimatedProtein": protein,
                "tags": tags,
                "mainIngredients": main_ingredients,
                "recommendationReason": reason,
                "confidence": confidence,
                "sourceType": source_type,
            },
        ),
        used_fallback=str(payload.get("id") or "").startswith("system-"),
        parsed_evidence=original_text,
    )

    enriched = MealAnalysisResult(
        id=str(payload.get("id") or f"system-{uuid4()}"),
        mealName=meal_name,
        mealType=meal_type or "\u7d9c\u5408\u9910",
        estimatedCalories=calories,
        estimatedProtein=protein,
        tags=normalize_user_facing_list(tags),
        mainIngredients=normalize_user_facing_list(main_ingredients),
        allergens=normalize_user_facing_list(allergens),
        recommendationReason=normalize_user_facing_text(reason),
        confidence=confidence,
        sourceType=source_type,
        createdAt=str(payload.get("createdAt") or datetime.now(timezone.utc).isoformat()),
        isAiGenerated=bool(payload.get("isAiGenerated", True)),
        recommendedGoals=infer_recommendation_labels(meal_name, meal_type, tags, calories, protein),
        warningMessage=warning_message or None,
        nutritionNote=nutrition_note or None,
    )
    if validate_analysis_result(enriched):
        fixed = enriched.model_dump()
        if _is_invalid_user_value(fixed["mealName"]):
            fixed["mealName"] = "\u7d9c\u5408\u9910"
        if (
            not fixed["mainIngredients"]
            and not fixed.get("warningMessage")
            and not fixed.get("nutritionNote")
        ) or (
            fixed["mainIngredients"]
            and all(_is_invalid_user_value(item) for item in fixed["mainIngredients"])
        ):
            fixed["mainIngredients"] = ["\u4e3b\u8981\u98df\u6750\u9700\u4eba\u5de5\u78ba\u8a8d"]
        if not fixed["tags"]:
            fixed["tags"] = ["\u7d9c\u5408\u9910"]
        if fixed["estimatedCalories"] <= 0:
            fixed["estimatedCalories"] = 500
        if fixed["estimatedProtein"] <= 0:
            fixed["estimatedProtein"] = 20
        if _is_forbidden_reason(fixed["recommendationReason"]) or not fixed["recommendationReason"]:
            fixed["recommendationReason"] = DEFAULT_REASON
        fixed["recommendedGoals"] = infer_recommendation_labels(
            str(fixed.get("mealName") or ""),
            str(fixed.get("mealType") or ""),
            _string_list(fixed.get("tags")),
            float(fixed.get("estimatedCalories") or 0),
            float(fixed.get("estimatedProtein") or 0),
        )
        fixed["confidence"] = calibrate_confidence(
            fixed,
            source_type=str(fixed.get("sourceType") or source_type),
            validation_errors=validate_analysis_result(fixed),
            used_fallback=str(fixed.get("id") or "").startswith("system-"),
            parsed_evidence=original_text,
        )
        enriched = MealAnalysisResult(**fixed)
    return enriched


def load_recommendation_categories() -> list[dict[str, Any]]:
    try:
        with RECOMMENDATION_CATEGORIES_PATH.open("r", encoding="utf-8") as file:
            payload = json.load(file)
    except (OSError, json.JSONDecodeError):
        return []
    return payload if isinstance(payload, list) else []


def infer_recommendation_labels(
    meal_name: str,
    meal_type: str,
    tags: list[str],
    calories: float,
    protein: float,
) -> list[str]:
    categories = load_recommendation_categories()
    profile_tokens = set(tags)
    profile = f"{meal_name} {meal_type} {' '.join(tags)}"
    if protein >= 25:
        profile_tokens.add("\u9ad8\u86cb\u767d")
    is_high_calorie = calories >= 700
    is_low_calorie = calories <= 450 or "\u4f4e\u5361" in profile_tokens
    is_risky = _has_any(profile, ["\u751c\u9ede", "\u9ad8\u7cd6", "\u70d8\u7119", "\u70b8\u7269", "\u6cb9\u70b8", "\u9ad8\u8102\u80aa"])

    labels: list[str] = []
    for category in categories:
        label = str(category.get("label") or "")
        include_rules = [str(item) for item in category.get("includeRules", [])]
        exclude_rules = [str(item) for item in category.get("excludeRules", [])]
        has_include = not include_rules or any(rule in profile_tokens or rule in profile for rule in include_rules)
        has_excluded = any(rule in profile_tokens or rule in profile for rule in exclude_rules)
        if not label or not has_include or has_excluded:
            continue
        if label == "\u6e1b\u8102" and (is_high_calorie and "\u4f4e\u5361" not in profile_tokens):
            continue
        labels.append(label)

    if is_low_calorie and not is_risky:
        labels = _label_add(labels, "\u6e1b\u8102")
        labels = _label_add(labels, "\u5065\u5eb7\u7dad\u6301")
    if protein >= 25:
        labels = _label_add(labels, "\u589e\u808c")
        labels = _label_add(labels, "\u9ad8\u86cb\u767d\u88dc\u5145")
    if is_risky:
        labels = [label for label in labels if label not in {"\u6e1b\u8102", "\u5747\u8861\u98f2\u98df", "\u5065\u5eb7\u7dad\u6301"}]
    elif protein >= 15:
        labels = _label_add(labels, "\u5747\u8861\u98f2\u98df")
    return labels


def _label_add(labels: list[str], label: str) -> list[str]:
    return labels if label in labels else [*labels, label]


def calibrate_confidence(
    result: MealAnalysisResult | dict[str, Any],
    source_type: str,
    validation_errors: list[str] | None = None,
    used_fallback: bool = False,
    parsed_evidence: str | None = None,
) -> float:
    payload = result.model_dump() if isinstance(result, MealAnalysisResult) else dict(result)
    confidence = max(0, min(float(payload.get("confidence") or 0.55), 1))
    ingredients = _string_list(payload.get("mainIngredients"))
    reason = str(payload.get("recommendationReason") or "")
    meal_name = str(payload.get("mealName") or "")
    calories = _positive_float(payload.get("estimatedCalories"))
    protein = _positive_float(payload.get("estimatedProtein"))
    source = source_type if source_type in {"text", "image", "url"} else str(payload.get("sourceType") or "text")
    validation_errors = validation_errors or []
    evidence = str(parsed_evidence or "")
    has_limited_info_warning = bool(payload.get("warningMessage") or payload.get("nutritionNote"))
    is_ingredient_result = _is_ingredient_result(payload)

    if _has_incomplete_ingredients(ingredients):
        confidence = min(confidence, 0.45)
    if has_limited_info_warning and not ingredients:
        confidence = min(confidence, 0.35)
    if used_fallback:
        confidence = min(confidence, 0.55)
    if source == "url":
        if "URL fetch failed" in evidence or "URL fetch failed" in reason:
            confidence = min(confidence, 0.35)
        elif _has_incomplete_ingredients(ingredients):
            confidence = min(confidence, 0.45)
        elif len(ingredients) < 2:
            confidence = min(confidence, 0.6)
    if source == "image" and used_fallback and validation_errors:
        confidence = min(confidence, 0.4)
    if not _is_complete_result(meal_name, calories, protein, ingredients, reason, source, is_ingredient_result):
        confidence = min(confidence, 0.4 if source in {"image", "url"} else 0.75)
    if is_ingredient_result:
        confidence = min(confidence, 0.85)
    if meal_name == "\u70b8\u96de\u6392":
        confidence = min(confidence, 0.85)
    return confidence


def validate_analysis_result(result: MealAnalysisResult | dict[str, Any]) -> list[str]:
    payload = result.model_dump() if isinstance(result, MealAnalysisResult) else dict(result)
    issues: list[str] = []
    meal_name = str(payload.get("mealName") or "")
    meal_type = str(payload.get("mealType") or "")
    reason = str(payload.get("recommendationReason") or "")
    tags = payload.get("tags") if isinstance(payload.get("tags"), list) else []
    ingredients = payload.get("mainIngredients") if isinstance(payload.get("mainIngredients"), list) else []
    confidence = float(payload.get("confidence") or 0)
    calories = _positive_float(payload.get("estimatedCalories"))

    if not meal_name or _is_invalid_user_value(meal_name) or _has_english_meal_name(meal_name) or _is_overly_generic_name(meal_name):
        issues.append("mealName must be localized Traditional Chinese")
    if not meal_type or _is_invalid_user_value(meal_type):
        issues.append("mealType is missing")
    if calories is None:
        issues.append("estimatedCalories must be greater than zero")
    if _positive_float(payload.get("estimatedProtein")) is None:
        issues.append("estimatedProtein must be greater than zero")
    if not tags:
        issues.append("tags must not be empty")
    ingredients_incomplete = not ingredients or any(_is_invalid_user_value(str(item)) for item in ingredients)
    if ingredients_incomplete:
        issues.append("mainIngredients must be meaningful")
    if (
        not reason
        or _is_forbidden_reason(reason)
        or _is_invalid_user_value(reason)
        or _has_english_meal_name(reason)
        or _is_generic_reason(reason)
    ):
        issues.append("recommendationReason must be localized and user friendly")
    if meal_name in {"\u6e6f\u5305", "\u5c0f\u7c60\u5305"} and ingredients_incomplete:
        issues.append("soup dumpling requires concrete ingredients")
    if confidence >= 0.9 and ingredients_incomplete:
        issues.append("high confidence requires concrete ingredients")
    if calories == 500 and ingredients_incomplete:
        issues.append("generic nutrition defaults require concrete ingredients")
    return issues


def _positive_float(value: Any) -> float | None:
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        return None
    return parsed if parsed > 0 else None


def _coerce_payload_aliases(payload: dict[str, Any]) -> dict[str, Any]:
    coerced = dict(payload)
    alias_pairs = {
        "mealName": ["name", "meal_name"],
        "mealType": ["type", "meal_type"],
        "mainIngredients": ["ingredients", "main_ingredients"],
        "tags": ["dietTags", "diet_tags"],
        "estimatedCalories": ["calories", "estimated_calories"],
        "estimatedProtein": ["protein", "estimated_protein"],
        "recommendationReason": ["reason", "recommendation_reason"],
    }
    for canonical, aliases in alias_pairs.items():
        if coerced.get(canonical):
            continue
        for alias in aliases:
            if coerced.get(alias):
                coerced[canonical] = coerced[alias]
                break
    return coerced


def _parse_structured_description(text: str) -> dict[str, Any]:
    if not text.strip():
        return {}
    fields: dict[str, str] = {}
    current_key = ""
    key_map = {
        "餐點名稱": "mealName",
        "名稱": "mealName",
        "name": "mealName",
        "餐點類型": "mealType",
        "類型": "mealType",
        "type": "mealType",
        "主要食材": "mainIngredients",
        "食材": "mainIngredients",
        "ingredients": "mainIngredients",
        "飲食標籤": "tags",
        "標籤": "tags",
        "dietTags": "tags",
        "tags": "tags",
    }
    for raw_line in text.splitlines():
        line = raw_line.strip()
        if not line:
            continue
        matched = False
        for label, key in key_map.items():
            prefixes = (f"{label}：", f"{label}:")
            if line.startswith(prefixes):
                fields[key] = line.split("：", 1)[1].strip() if "：" in line else line.split(":", 1)[1].strip()
                current_key = key
                matched = True
                break
        if matched:
            continue
        if current_key:
            fields[current_key] = f"{fields.get(current_key, '')} {line}".strip()

    structured: dict[str, Any] = {}
    if fields.get("mealName"):
        structured["mealName"] = normalize_user_facing_text(fields["mealName"])
    if fields.get("mealType"):
        structured["mealType"] = "、".join(_split_user_list(fields["mealType"]))
    if fields.get("mainIngredients"):
        structured["mainIngredients"] = _split_user_list(fields["mainIngredients"])
    if fields.get("tags"):
        structured["tags"] = _split_user_list(fields["tags"])
    return structured


def _split_user_list(value: str) -> list[str]:
    normalized = value.replace("\n", " ")
    for separator in ["、", "，", ",", "；", ";", "/", "／", "｜", "|"]:
        normalized = normalized.replace(separator, " ")
    values: list[str] = []
    for item in normalized.split():
        cleaned = normalize_user_facing_text(item.strip())
        if cleaned and cleaned not in values:
            values.append(cleaned)
    return values


def _string_list(value: Any) -> list[str]:
    if isinstance(value, list):
        return [normalize_user_facing_text(str(item)) for item in value if str(item)]
    if isinstance(value, str) and value:
        return [normalize_user_facing_text(value)]
    return []


def _merge_lists(primary: list[str], fallback: list[str]) -> list[str]:
    values: list[str] = []
    for item in [*primary, *fallback]:
        if item and item not in values:
            values.append(item)
    return values


def _contextual_meal_name(meal_name: str, payload: dict[str, Any], original_text: str | None) -> str:
    source_type = payload.get("sourceType")
    context_parts = [
        meal_name,
        str(original_text or ""),
        str(payload.get("mealType") or ""),
        str(payload.get("recommendationReason") or ""),
        " ".join(_string_list(payload.get("tags"))),
        " ".join(_string_list(payload.get("mainIngredients"))),
    ]
    context = normalize_user_facing_text(" ".join(context_parts)).lower()
    evidence_context_parts = [
        str(original_text or ""),
        str(payload.get("mealType") or ""),
        str(payload.get("recommendationReason") or ""),
        " ".join(_string_list(payload.get("tags"))),
        " ".join(_string_list(payload.get("mainIngredients"))),
    ]
    evidence_context = normalize_user_facing_text(" ".join(evidence_context_parts)).lower()
    has_noodles = _has_noodle_evidence(evidence_context if source_type == "image" else context)
    egg_context = context.replace("\u86cb\u767d\u8cea", "").replace("\u9ad8\u86cb\u767d", "")
    has_egg = _has_any(
        egg_context,
        ["\u96de\u86cb", "\u53ef\u898b\u86cb", "\u86cb\u6db2", "\u6ed1\u86cb", " \u86cb ", "\u86cb,", "egg"],
    )
    has_steak = _has_any(context, ["\u725b\u6392", "steak"])
    has_chicken_steak = _has_any(context, ["\u96de\u6392", "chicken steak"])
    has_chicken = _has_any(context, ["\u96de\u8089", "chicken"])
    has_fried_chicken_cutlet = _has_any(
        context,
        ["\u70b8\u96de\u6392", "\u96de\u6392", "chicken steak", "fried chicken steak", "fried chicken cutlet"],
    )

    if source_type == "image" and meal_name == "\u70b8\u96de\u6392":
        return "\u70b8\u96de\u6392"
    if source_type == "image" and has_fried_chicken_cutlet and not has_noodles:
        return "\u70b8\u96de\u6392"

    if has_chicken_steak and has_noodles and has_egg:
        return "\u96de\u6392\u86cb\u9eb5"
    if has_steak and has_noodles and has_egg and not has_chicken:
        return "\u725b\u6392\u86cb\u9eb5"
    if has_chicken_steak and has_noodles:
        return "\u96de\u6392\u9eb5"
    if has_steak and has_noodles and not has_chicken:
        return "\u725b\u6392\u9eb5"
    if has_steak and has_egg and meal_name in {"\u725b\u6392", "\u725b\u6392\u86cb", "\u9eb5\u98df", "\u672a\u547d\u540d\u9910\u9ede"}:
        return "\u725b\u6392\u86cb"
    return meal_name


def _infer_name_from_context(text: str) -> str:
    if "杜老爺" in text:
        return "杜老爺冰品"
    return ""


def _has_noodle_evidence(context: str) -> bool:
    if _has_any(
        context,
        [
            "\u672a\u660e\u78ba\u770b\u5230\u9eb5\u689d",
            "\u6c92\u6709\u9eb5\u689d",
            "\u672a\u770b\u5230\u9eb5\u689d",
            "\u4e0d\u5224\u65b7\u70ba\u96de\u6392\u9eb5",
            "no noodles",
            "no visible noodles",
        ],
    ):
        return False
    return _has_any(context, ["\u9eb5\u689d", "\u9eb5\u98df", "\u53ef\u898b\u9eb5", "\u6e6f\u9eb5", "noodles", "noodle"])


def _infer_type(meal_name: str, tags: list[str]) -> str:
    if "\u9eb5" in meal_name or "\u9eb5\u98df" in tags:
        return "\u9eb5\u98df"
    if "\u4e3c" in meal_name or "\u4e3c\u98ef" in tags or "\u65e5\u5f0f" in tags:
        return "\u65e5\u5f0f\u4e3c\u98ef"
    if "\u98ef" in meal_name or "\u98ef\u985e" in tags:
        return "\u98ef\u985e"
    if "\u4fbf\u7576" in meal_name:
        return "\u4fbf\u7576"
    if "\u5065\u5eb7\u9910" in tags:
        return "\u5065\u5eb7\u9910"
    return "\u7d9c\u5408\u9910"


def _estimate_by_type(meal_type: str, tags: list[str]) -> dict[str, float]:
    if "\u725b\u6392\u9eb5" in meal_type:
        return {"estimatedCalories": 850, "estimatedProtein": 38}
    if "\u9eb5\u98df" in meal_type or "\u9eb5\u98df" in tags:
        return {"estimatedCalories": 600, "estimatedProtein": 20}
    if "\u70b8\u7269" in meal_type or "\u70b8\u7269" in tags:
        return {"estimatedCalories": 700, "estimatedProtein": 30}
    if "\u70b8\u7269" in tags and "\u4e3c" in meal_type:
        return {"estimatedCalories": 780, "estimatedProtein": 32}
    if "\u65e5\u5f0f\u4e3c\u98ef" in meal_type:
        return {"estimatedCalories": 650, "estimatedProtein": 28}
    if "\u98ef\u985e" in meal_type:
        return {"estimatedCalories": 600, "estimatedProtein": 18}
    if "\u5065\u5eb7\u9910" in meal_type:
        return {"estimatedCalories": 420, "estimatedProtein": 32}
    if "\u4fbf\u7576" in meal_type:
        return {"estimatedCalories": 750, "estimatedProtein": 30}
    return {"estimatedCalories": 500, "estimatedProtein": 20}


def _infer_allergens(ingredients: list[str]) -> list[str]:
    joined = " ".join(ingredients)
    allergens: list[str] = []
    if "\u96de\u86cb" in joined or "\u86cb" in joined:
        allergens.append("\u86cb")
    if "\u8766\u4ec1" in joined or "\u8766" in joined:
        allergens.append("\u8766")
    if "\u9eb5\u689d" in joined or "\u70b8\u8c6c\u6392" in joined or "\u9eb5\u8863" in joined or "\u9eb5\u5305\u7c89" in joined:
        allergens.append("\u9ea9\u8cea")
    if "\u82b1\u751f" in joined:
        allergens.append("\u82b1\u751f")
    return allergens


def _is_forbidden_reason(reason: str) -> bool:
    lowered = reason.lower()
    forbidden = ["fallback", "rule-based", "ai \u670d\u52d9\u7121\u6cd5\u4f7f\u7528", "\u5c1a\u672a\u8a2d\u5b9a", "\u5c55\u793a\u7d50\u679c"]
    return any(item in lowered for item in forbidden)


def _is_generic_name(meal_name: str) -> bool:
    return meal_name in {
        "\u9910\u9ede\u5065\u5eb7\u5efa\u8b70",
        "\u672a\u547d\u540d\u9910\u9ede",
        "\u7d9c\u5408\u9910",
    }


def _is_overly_generic_name(meal_name: str) -> bool:
    return meal_name in {
        "\u7d9c\u5408\u9910",
        "\u9910\u9ede",
        "\u98df\u7269",
        "\u6599\u7406",
        "\u4e3b\u9910",
        "\u7cfb\u7d71\u8fa8\u8b58\u9910\u9ede",
    }


def _is_generic_meal_type(meal_type: str) -> bool:
    return not meal_type or meal_type in {"\u7d9c\u5408\u9910", "\u9910\u9ede", "\u98df\u7269", "\u6599\u7406"}


def _is_generic_reason(reason: str) -> bool:
    return reason.strip() in {
        "\u7cfb\u7d71\u5df2\u6839\u64da\u5019\u9078\u9910\u9ede\u8207\u53ef\u898b\u98df\u6750\u7279\u5fb5\u91cd\u65b0\u6821\u6b63\u8fa8\u8b58\u7d50\u679c\u3002",
        "\u7cfb\u7d71\u5df2\u5b8c\u6210\u9910\u9ede\u5206\u6790\u3002",
        "AI \u5df2\u5b8c\u6210\u9910\u9ede\u5206\u6790\u3002",
    }


def _has_stale_image_hint_reason(reason: str) -> bool:
    return _has_any(reason, ["\u6587\u5b57\u63cf\u8ff0", "\u5716\u7247\u63d0\u793a", "\u8f14\u52a9\u63d0\u793a"])


def _has_incomplete_ingredients(ingredients: list[str]) -> bool:
    return not ingredients or any(_is_invalid_user_value(item) for item in ingredients)


def _is_complete_result(
    meal_name: str,
    calories: float | None,
    protein: float | None,
    ingredients: list[str],
    reason: str,
    source_type: str,
    is_ingredient_result: bool = False,
) -> bool:
    return (
        bool(meal_name)
        and not _is_overly_generic_name(meal_name)
        and calories is not None
        and protein is not None
        and len(ingredients) >= (1 if is_ingredient_result else 2)
        and not _has_incomplete_ingredients(ingredients)
        and bool(reason)
        and not _is_generic_reason(reason)
        and not _is_forbidden_reason(reason)
        and source_type in {"text", "image", "url"}
    )


def _is_ingredient_result(payload: dict[str, Any]) -> bool:
    meal_type = str(payload.get("mealType") or "")
    tags = _string_list(payload.get("tags"))
    return "食材" in meal_type or "食材" in tags or meal_type in {"水果", "飲品"}


def _has_any(text: str, keywords: list[str]) -> bool:
    lowered = text.lower()
    return any(keyword.lower() in lowered for keyword in keywords)


def _has_english_meal_name(value: str) -> bool:
    lowered = value.lower()
    tokens = [
        "steak",
        "eggs",
        "chicken steak",
        "noodles",
        "katsudon",
        "oyakodon",
        "butadon",
        "gyudon",
        "fried rice",
        "curry rice",
    ]
    return any(token in lowered for token in tokens)


def _is_invalid_user_value(value: str) -> bool:
    text = str(value or "").strip()
    if not text:
        return True
    lowered = text.lower()
    invalid_tokens = [
        "unknown",
        "\u4e3b\u8981\u98df\u6750\u5f85\u78ba\u8a8d",
        "\u4e3b\u8981\u98df\u6750\u9700\u4eba\u5de5\u78ba\u8a8d",
        "\u9910\u9ede\u5f71\u50cf\u7279\u5fb5\u4e0d\u8db3",
        "\u672a\u78ba\u8a8d",
        "\ufffd",
        "\u9285\u9919",
        "\u657a",
        "\uee38",
        "\uf731",
        "?",
    ]
    return any(token in lowered for token in invalid_tokens)
