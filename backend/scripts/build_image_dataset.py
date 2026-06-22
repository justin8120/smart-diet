"""Build the metadata-only image-analysis calibration/evaluation manifests."""

from __future__ import annotations

import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
DATASET_DIR = ROOT / "backend" / "data" / "image_dataset"


CATEGORIES: dict[str, list[str]] = {
    "炸物 / 小吃": ["炸雞排", "鹽酥雞", "地瓜球", "臭豆腐", "炸甜不辣", "炸雞排", "鹽酥雞", "臭豆腐", "炸甜不辣", "地瓜球"],
    "便當": ["雞腿飯", "雞胸肉便當", "排骨飯", "控肉飯", "魚排飯", "烤雞腿便當", "舒肥雞胸便當", "滷排骨便當", "滷肉便當", "鯖魚便當"],
    "飯類 / 丼飯": ["滷肉飯", "雞肉飯", "豚丼", "牛丼", "親子丼", "咖哩飯", "豚丼", "親子丼", "咖哩豬排飯", "牛丼"],
    "麵類": ["牛肉麵", "陽春麵", "麻醬麵", "炸醬麵", "海鮮烏龍麵", "鍋燒意麵", "牛排鐵板麵", "乾麵", "餛飩麵", "炒烏龍麵"],
    "早餐": ["蛋餅", "起司蛋餅", "火腿蛋吐司", "肉蛋吐司", "蘿蔔糕", "飯糰", "茶葉蛋", "滷蛋", "鮪魚蛋餅", "蔬菜蛋吐司"],
    "日式 / 速食": ["豬排丼", "唐揚雞丼", "炸蝦丼", "麥克雞塊", "薯條", "漢堡", "咖哩豬排飯", "照燒雞堡", "炸魚堡", "雞塊薯條"],
    "健康餐": ["雞胸肉健康餐", "舒肥雞胸餐", "鮭魚健康餐", "豆腐蔬菜餐", "地瓜雞胸餐", "烤雞腿健康餐", "鯖魚健康餐", "牛肉健康餐", "毛豆豆腐餐", "藜麥雞胸餐"],
    "素食 / 蔬食": ["蔬食便當", "素炒麵", "豆腐蔬菜飯", "菇菇燉飯", "素食滷味", "五穀蔬食飯", "番茄蔬菜麵", "豆皮蔬菜餐", "素咖哩飯", "蔬菜湯麵"],
    "甜點 / 飲品 / 水果": ["肉桂捲", "蛋糕", "布丁", "西瓜", "香蕉", "無糖綠茶", "美式咖啡", "奶茶", "紅色莓果蛋糕", "麵包"],
    "容易誤判案例": ["炸雞排", "豚丼", "湯包", "花生", "牛排鐵板麵", "咖哩豬排飯", "雞胸肉便當", "西瓜", "肉桂捲", "茶葉蛋"],
}


DETAILS: dict[str, tuple[list[str], list[str], list[str], tuple[int, int], tuple[int, int]]] = {
    "炸雞排": (["雞肉", "麵衣", "油"], ["炸物", "雞肉", "高蛋白"], ["麩質"], (500, 750), (25, 45)),
    "豚丼": (["豬肉", "白飯", "洋蔥"], ["飯類", "豬肉", "日式"], ["大豆", "麩質"], (550, 800), (20, 35)),
    "親子丼": (["雞肉", "雞蛋", "白飯"], ["飯類", "雞肉", "日式"], ["蛋", "大豆", "麩質"], (550, 800), (25, 40)),
    "湯包": (["麵皮", "豬肉", "肉汁"], ["麵食", "豬肉", "蒸物"], ["麩質"], (250, 450), (10, 22)),
    "花生": (["花生"], ["堅果", "零食", "植物性"], ["花生"], (150, 350), (7, 16)),
    "牛排鐵板麵": (["牛肉", "麵條", "雞蛋"], ["麵類", "牛肉", "高蛋白"], ["麩質", "蛋"], (650, 950), (30, 50)),
    "咖哩豬排飯": (["豬排", "白飯", "咖哩"], ["飯類", "豬肉", "炸物"], ["麩質"], (750, 1050), (25, 40)),
    "雞胸肉便當": (["雞胸肉", "白飯", "蔬菜"], ["便當", "雞肉", "高蛋白"], [], (450, 700), (30, 50)),
    "西瓜": (["西瓜"], ["水果", "低脂", "清爽"], [], (40, 180), (1, 4)),
    "肉桂捲": (["麵粉", "肉桂", "糖"], ["甜點", "烘焙", "高糖"], ["麩質", "奶"], (300, 550), (4, 10)),
    "茶葉蛋": (["雞蛋", "茶葉", "醬油"], ["蛋類", "小吃", "高蛋白"], ["蛋", "大豆", "麩質"], (65, 100), (6, 9)),
}


FORBIDDEN: dict[str, list[str]] = {
    "炸雞排": ["雞排麵", "雞胸肉便當", "湯包"],
    "豚丼": ["親子丼", "牛丼"],
    "親子丼": ["豚丼", "牛丼"],
    "湯包": ["花生", "水餃"],
    "花生": ["湯包", "小籠包"],
    "牛排鐵板麵": ["牛排", "牛肉麵"],
    "咖哩豬排飯": ["豬排丼", "咖哩飯"],
    "雞胸肉便當": ["雞腿飯", "一般雞腿飯"],
    "西瓜": ["紅色甜點", "莓果蛋糕"],
    "肉桂捲": ["麵包", "可頌"],
    "茶葉蛋": ["滷蛋", "鐵蛋"],
}


def details(name: str, category: str) -> tuple[list[str], list[str], list[str], tuple[int, int], tuple[int, int]]:
    if name in DETAILS:
        return DETAILS[name]
    ingredients = [name.replace("便當", "").replace("健康餐", "").replace("餐", "") or name]
    if any(word in name for word in ("飯", "丼", "便當")):
        ingredients += ["白飯", "蔬菜"]
    elif "麵" in name:
        ingredients += ["麵條", "蔬菜"]
    elif any(word in name for word in ("蛋餅", "吐司", "漢堡", "麵包")):
        ingredients += ["麵粉", "雞蛋"]
    tags = [category.split(" / ")[0], "台灣常見餐點"]
    allergens = ["麩質"] if any(word in name for word in ("麵", "餅", "吐司", "堡", "糕", "捲", "蛋糕")) else []
    calories = (350, 700)
    protein = (10, 35)
    if any(word in name for word in ("茶", "咖啡")):
        calories, protein = (0, 350), (0, 10)
    elif name in {"香蕉", "布丁", "蛋糕", "紅色莓果蛋糕", "麵包"}:
        calories, protein = (80, 500), (1, 12)
    return list(dict.fromkeys(ingredients)), tags, allergens, calories, protein


def acceptable_names(name: str) -> list[str]:
    aliases = {
        "炸雞排": ["雞排", "香雞排"], "雞胸肉便當": ["雞胸便當", "雞胸餐盒"],
        "豚丼": ["豬肉丼", "豬丼"], "湯包": ["小籠湯包"], "肉桂捲": ["肉桂卷"],
        "無糖綠茶": ["綠茶"], "美式咖啡": ["黑咖啡"], "茶葉蛋": ["茶香滷蛋"],
    }
    return [name, *aliases.get(name, [])]


def build() -> None:
    records: dict[str, list[dict[str, object]]] = {"train": [], "eval": []}
    counters = {"train": 0, "eval": 0}
    for category_index, (category, meals) in enumerate(CATEGORIES.items()):
        for meal_index, name in enumerate(meals):
            # Five records from every category go to each split; parity is offset per category.
            split = "train" if (meal_index + category_index) % 2 == 0 else "eval"
            counters[split] += 1
            number = counters[split]
            ingredients, tags, allergens, calories, protein = details(name, category)
            record_id = f"{split}_{number:04d}"
            records[split].append({
                "id": record_id,
                "split": split,
                "category": category,
                "imagePath": f"backend/data/image_dataset/{split}/{record_id}.jpg",
                "imageUrl": "",
                "imageSha256": "",
                "sourceGroup": record_id,
                "expectedMealName": name,
                "acceptableMealNames": acceptable_names(name),
                "mealType": category,
                "expectedTags": tags,
                "expectedMainIngredients": ingredients,
                "expectedAllergens": allergens,
                "forbiddenPredictions": FORBIDDEN.get(name, []),
                "visualEvidence": [f"可見{name}主體", f"構圖符合{category}常見盛裝方式"],
                "estimatedCaloriesRange": list(calories),
                "estimatedProteinRange": list(protein),
                "notes": "僅依圖片可見線索判斷；不可補入未出現的配菜或主食。",
            })
    for split, rows in records.items():
        path = DATASET_DIR / f"{split}_manifest.json"
        path.write_text(json.dumps(rows, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    build()
