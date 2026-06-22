"""Evaluate the held-out image meal-analysis manifest without using the frontend."""

from __future__ import annotations

import argparse
import json
import sys
import urllib.parse
import urllib.request
from collections import Counter
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[2]
BACKEND = ROOT / "backend"
DEFAULT_MANIFEST = BACKEND / "data" / "image_dataset" / "eval_manifest.json"
DEFAULT_JSON_REPORT = BACKEND / "reports" / "image_analysis_eval_report.json"
DEFAULT_MD_REPORT = BACKEND / "reports" / "image_analysis_eval_report.md"


def _load_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def _normalized(value: Any) -> str:
    return "".join(str(value or "").split()).casefold()


def _string_set(values: Any) -> set[str]:
    return {_normalized(value) for value in (values or []) if _normalized(value)}


def _ratio(numerator: int, denominator: int) -> float | None:
    return round(numerator / denominator, 4) if denominator else None


def _range_hit(value: Any, expected_range: Any) -> bool:
    try:
        low, high = expected_range
        return float(low) <= float(value) <= float(high)
    except (TypeError, ValueError):
        return False


def _set_counts(predicted: Any, expected: Any) -> tuple[int, int, int]:
    predicted_set, expected_set = _string_set(predicted), _string_set(expected)
    return len(predicted_set & expected_set), len(predicted_set - expected_set), len(expected_set - predicted_set)


def _set_metrics(counts: tuple[int, int, int]) -> dict[str, float | None]:
    true_positive, false_positive, false_negative = counts
    precision = _ratio(true_positive, true_positive + false_positive)
    recall = _ratio(true_positive, true_positive + false_negative)
    f1 = None if precision is None or recall is None or precision + recall == 0 else round(2 * precision * recall / (precision + recall), 4)
    return {"precision": precision, "recall": recall, "f1": f1}


def find_leakage(train_rows: list[dict[str, Any]], eval_rows: list[dict[str, Any]]) -> dict[str, list[str]]:
    fields = ("id", "imagePath", "imageUrl", "imageSha256", "sourceGroup")
    leakage: dict[str, list[str]] = {}
    for field in fields:
        train_values = {_normalized(row.get(field)) for row in train_rows if _normalized(row.get(field))}
        eval_values = {_normalized(row.get(field)) for row in eval_rows if _normalized(row.get(field))}
        overlap = sorted(train_values & eval_values)
        if overlap:
            leakage[field] = overlap
    return leakage


def _predictions_by_id(payload: Any) -> dict[str, dict[str, Any]]:
    if isinstance(payload, dict):
        return {str(key): value for key, value in payload.items() if isinstance(value, dict)}
    if isinstance(payload, list):
        return {str(row["id"]): row for row in payload if isinstance(row, dict) and row.get("id")}
    raise ValueError("predictions JSON must be an object keyed by id or a list containing id")


def _image_bytes(row: dict[str, Any]) -> tuple[bytes, str, str]:
    image_path = str(row.get("imagePath") or "")
    image_url = str(row.get("imageUrl") or "")
    if image_path:
        path = Path(image_path)
        if not path.is_absolute():
            path = ROOT / path
        if path.is_file():
            suffix = path.suffix.lower()
            media_type = {".png": "image/png", ".webp": "image/webp", ".gif": "image/gif"}.get(suffix, "image/jpeg")
            return path.read_bytes(), path.name, media_type
    if image_url:
        with urllib.request.urlopen(image_url, timeout=20) as response:  # noqa: S310 - dataset URL is intentional input
            return response.read(), Path(urllib.parse.urlparse(image_url).path).name or "image.jpg", response.headers.get_content_type()
    raise FileNotFoundError("no available imagePath or imageUrl")


def _analyze_via_api(row: dict[str, Any]) -> dict[str, Any]:
    if str(BACKEND) not in sys.path:
        sys.path.insert(0, str(BACKEND))
    from fastapi.testclient import TestClient
    from app.main import app

    image, filename, media_type = _image_bytes(row)
    response = TestClient(app).post("/api/analyze/image", files={"file": (filename, image, media_type)})
    response.raise_for_status()
    return response.json()


def evaluate(
    manifest_path: Path = DEFAULT_MANIFEST,
    predictions_path: Path | None = None,
    json_report_path: Path = DEFAULT_JSON_REPORT,
    markdown_report_path: Path = DEFAULT_MD_REPORT,
) -> dict[str, Any]:
    rows: list[dict[str, Any]] = _load_json(manifest_path)
    if any(row.get("split") != "eval" for row in rows):
        raise ValueError("evaluation manifest may only contain split=eval records")
    train_path = manifest_path.with_name("train_manifest.json")
    train_rows = _load_json(train_path) if train_path.exists() else []
    leakage = find_leakage(train_rows, rows)
    if leakage:
        raise ValueError(f"train/eval data leakage detected: {leakage}")

    supplied = _predictions_by_id(_load_json(predictions_path)) if predictions_path else {}
    outcomes: list[dict[str, Any]] = []
    scored: list[tuple[dict[str, Any], dict[str, Any]]] = []
    for row in rows:
        try:
            prediction = supplied.get(str(row["id"])) if predictions_path else _analyze_via_api(row)
            if prediction is None:
                raise KeyError("prediction not supplied")
            scored.append((row, prediction))
            outcomes.append({"id": row["id"], "status": "evaluated", "prediction": prediction})
        except Exception as error:  # Preserve the rest of a potentially paid evaluation run.
            outcomes.append({"id": row["id"], "status": "unavailable", "error": str(error)})

    exact = acceptable = meal_type = allergens_found = allergens_total = 0
    calorie_hits = protein_hits = forbidden_count = high_confidence_errors = 0
    tag_counts = [0, 0, 0]
    ingredient_counts = [0, 0, 0]
    confusions: Counter[str] = Counter()
    error_types: Counter[str] = Counter()
    for expected, predicted in scored:
        name = _normalized(predicted.get("mealName"))
        exact_hit = name == _normalized(expected.get("expectedMealName"))
        acceptable_hit = name in _string_set(expected.get("acceptableMealNames"))
        exact += exact_hit
        acceptable += acceptable_hit
        meal_type += _normalized(predicted.get("mealType")) == _normalized(expected.get("mealType"))
        tag = _set_counts(predicted.get("tags"), expected.get("expectedTags"))
        ingredient = _set_counts(predicted.get("mainIngredients"), expected.get("expectedMainIngredients"))
        tag_counts = [a + b for a, b in zip(tag_counts, tag)]
        ingredient_counts = [a + b for a, b in zip(ingredient_counts, ingredient)]
        expected_allergens = _string_set(expected.get("expectedAllergens"))
        predicted_allergens = _string_set(predicted.get("allergens"))
        allergens_found += len(expected_allergens & predicted_allergens)
        allergens_total += len(expected_allergens)
        calorie_hits += _range_hit(predicted.get("estimatedCalories"), expected.get("estimatedCaloriesRange"))
        protein_hits += _range_hit(predicted.get("estimatedProtein"), expected.get("estimatedProteinRange"))
        forbidden_hit = name in _string_set(expected.get("forbiddenPredictions"))
        forbidden_count += forbidden_hit
        if forbidden_hit:
            error_types["外觀相似餐點誤判"] += 1
        if expected_allergens - predicted_allergens:
            error_types["過敏原漏判"] += 1
        if ingredient[1]:
            error_types["推測未標註或不可見食材"] += 1
        if not _range_hit(predicted.get("estimatedCalories"), expected.get("estimatedCaloriesRange")):
            error_types["熱量估算超出範圍"] += 1
        if not acceptable_hit:
            confusions[f"{expected['expectedMealName']} → {predicted.get('mealName', '')}"] += 1
            if float(predicted.get("confidence") or 0) >= 0.8:
                high_confidence_errors += 1

    count = len(scored)
    metrics = {
        "exactMatchAccuracy": _ratio(exact, count),
        "acceptableNameAccuracy": _ratio(acceptable, count),
        "mealTypeAccuracy": _ratio(meal_type, count),
        "tag": _set_metrics(tuple(tag_counts)),
        "ingredient": _set_metrics(tuple(ingredient_counts)),
        "allergenRecall": _ratio(allergens_found, allergens_total),
        "forbiddenPredictionCount": forbidden_count,
        "calorieRangeAccuracy": _ratio(calorie_hits, count),
        "proteinRangeAccuracy": _ratio(protein_hits, count),
        "highConfidenceErrorCount": high_confidence_errors,
    }
    report = {
        "dataset": {
            "manifest": str(manifest_path), "totalRecords": len(rows), "evaluatedRecords": count,
            "unavailableRecords": len(rows) - count, "categoryDistribution": dict(Counter(row.get("category", "未分類") for row in rows)),
            "splitMethod": "每類固定交錯切分，train/eval 各 50 筆", "leakageChecked": True, "leakage": leakage,
        },
        "metrics": metrics,
        "confusionPairs": [{"pair": pair, "count": amount} for pair, amount in confusions.most_common(10)],
        "commonErrorTypes": dict(error_types),
        "results": outcomes,
        "limitations": "未評估樣本不納入分母；本報告不是醫療級營養或專業影像辨識認證。",
    }
    json_report_path.parent.mkdir(parents=True, exist_ok=True)
    markdown_report_path.parent.mkdir(parents=True, exist_ok=True)
    json_report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    markdown_report_path.write_text(_markdown(report), encoding="utf-8")
    return report


def _display(value: Any) -> str:
    return "未評估" if value is None else str(value)


def _markdown(report: dict[str, Any]) -> str:
    dataset, metrics = report["dataset"], report["metrics"]
    categories = "\n".join(f"- {name}: {count}" for name, count in dataset["categoryDistribution"].items())
    confusions = "\n".join(f"- {row['pair']}: {row['count']}" for row in report["confusionPairs"]) or "- 無（或尚無可評估圖片）"
    errors = "\n".join(f"- {name}: {count}" for name, count in report["commonErrorTypes"].items()) or "- 無（或尚無可評估圖片）"
    return f"""# 圖片餐點分析精準度報告

## 評估資料集

- 總筆數：{dataset['totalRecords']}
- 實際評估：{dataset['evaluatedRecords']}
- 圖片或預測不可用：{dataset['unavailableRecords']}
- train / eval 切分方式：{dataset['splitMethod']}
- 資料洩漏檢查：{'通過' if not dataset['leakage'] else '未通過'}

### 類別分布

{categories}

## 整體指標

- exact match accuracy：{_display(metrics['exactMatchAccuracy'])}
- acceptable name accuracy：{_display(metrics['acceptableNameAccuracy'])}
- mealType accuracy：{_display(metrics['mealTypeAccuracy'])}
- tag precision / recall / F1：{_display(metrics['tag']['precision'])} / {_display(metrics['tag']['recall'])} / {_display(metrics['tag']['f1'])}
- ingredient precision / recall / F1：{_display(metrics['ingredient']['precision'])} / {_display(metrics['ingredient']['recall'])} / {_display(metrics['ingredient']['f1'])}
- allergen recall：{_display(metrics['allergenRecall'])}
- forbidden prediction count：{metrics['forbiddenPredictionCount']}
- calorie range accuracy：{_display(metrics['calorieRangeAccuracy'])}
- protein range accuracy：{_display(metrics['proteinRangeAccuracy'])}
- high-confidence error count：{metrics['highConfidenceErrorCount']}

## 常見錯誤類型

{errors}

### confusion pairs

{confusions}

## 改善建議

- 對缺少關鍵視覺線索的圖片補充文字提示，並降低信心分數。
- 加入候選餐點比對，但候選規則只能取自 training split。
- 禁止推測圖片中不可見的配菜、主食與過敏原。
- 針對高頻 confusion pair 擴充新的 training 樣本，並保留新的 holdout set。
- 分別檢查熱量偏高、偏低與過敏原漏判，避免只看總體 accuracy。

> 未評估樣本不納入指標分母；本報告不代表醫療級營養估算或專業影像辨識能力。
"""


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", type=Path, default=DEFAULT_MANIFEST)
    parser.add_argument("--predictions", type=Path)
    parser.add_argument("--json-report", type=Path, default=DEFAULT_JSON_REPORT)
    parser.add_argument("--markdown-report", type=Path, default=DEFAULT_MD_REPORT)
    args = parser.parse_args()
    report = evaluate(args.manifest, args.predictions, args.json_report, args.markdown_report)
    print(f"evaluated {report['dataset']['evaluatedRecords']}/{report['dataset']['totalRecords']} records")


if __name__ == "__main__":
    main()
