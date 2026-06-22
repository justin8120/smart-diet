import json
from pathlib import Path

from scripts.evaluate_image_analysis import evaluate, find_leakage


BACKEND = Path(__file__).resolve().parents[1]
DATASET = BACKEND / "data" / "image_dataset"
REQUIRED_FIELDS = {
    "expectedMealName",
    "acceptableMealNames",
    "expectedMainIngredients",
    "expectedTags",
    "forbiddenPredictions",
}


def load(split: str):
    return json.loads((DATASET / f"{split}_manifest.json").read_text(encoding="utf-8"))


def test_manifests_exist_and_are_evenly_split():
    train, evaluation = load("train"), load("eval")
    assert len(train) == 50
    assert len(evaluation) == 50
    assert abs(len(train) - len(evaluation)) <= 1
    assert all(row["split"] == "train" for row in train)
    assert all(row["split"] == "eval" for row in evaluation)


def test_manifest_records_are_complete_and_cover_every_category():
    for split in ("train", "eval"):
        rows = load(split)
        assert all(REQUIRED_FIELDS <= row.keys() for row in rows)
        assert all(row["expectedMealName"] for row in rows)
        assert all(row["acceptableMealNames"] for row in rows)
        assert all(row["expectedMainIngredients"] for row in rows)
        assert all(row["expectedTags"] for row in rows)
        categories = {row["category"] for row in rows}
        assert len(categories) == 10
        assert all(sum(row["category"] == category for row in rows) >= 5 for category in categories)


def test_train_and_eval_have_no_identity_or_image_leakage():
    assert find_leakage(load("train"), load("eval")) == {}


def test_evaluator_writes_accuracy_f1_and_confidence_metrics(tmp_path):
    evaluation = load("eval")
    predictions = {
        row["id"]: {
            "mealName": row["expectedMealName"],
            "mealType": row["mealType"],
            "tags": row["expectedTags"],
            "mainIngredients": row["expectedMainIngredients"],
            "allergens": row["expectedAllergens"],
            "estimatedCalories": sum(row["estimatedCaloriesRange"]) / 2,
            "estimatedProtein": sum(row["estimatedProteinRange"]) / 2,
            "confidence": 0.9,
        }
        for row in evaluation
    }
    predictions_path = tmp_path / "predictions.json"
    json_report = tmp_path / "report.json"
    markdown_report = tmp_path / "report.md"
    predictions_path.write_text(json.dumps(predictions, ensure_ascii=False), encoding="utf-8")

    report = evaluate(DATASET / "eval_manifest.json", predictions_path, json_report, markdown_report)

    assert json_report.exists() and markdown_report.exists()
    assert report["metrics"]["exactMatchAccuracy"] == 1.0
    assert report["metrics"]["tag"]["f1"] == 1.0
    assert report["metrics"]["ingredient"]["f1"] == 1.0
    assert report["metrics"]["highConfidenceErrorCount"] == 0
    markdown = markdown_report.read_text(encoding="utf-8")
    assert "accuracy" in markdown
    assert "F1" in markdown
    assert "high-confidence error" in markdown
