# 圖片餐點分析精準度評估資料集

本專案目前未進行大型影像模型自訓。training split 用於提示詞校正、規則校正與營養補全；evaluation split 僅用於精準度評估，避免資料洩漏。

## 結構與用途

- `train_manifest.json`：50 筆 calibration 樣本，可用於 few-shot、候選餐點規則、營養補全、validation 與 confidence calibration。
- `eval_manifest.json`：50 筆保留樣本，只能用於 accuracy、precision、recall、F1 與錯誤分析。
- `train/`、`eval/`：選擇性圖片目錄。repo 只保留 `.gitkeep`，不收錄大量或授權不明圖片。
- `imagePath` 與 `imageUrl` 擇一填入；目前路徑是待補圖的穩定位置，不代表圖片已存在。
- `imageSha256` 應在取得圖片後填入，用來偵測改名後的同圖；`sourceGroup` 用來隔離同一原始拍攝或衍生圖片。

## 50 / 50 切分與防洩漏

每個大類各有 10 筆，依固定交錯規則分成 train 與 eval 各 5 筆。兩邊的 `id`、非空 `imagePath`、非空 `imageUrl`、非空 `imageSha256` 與 `sourceGroup` 都必須互斥。加入真實圖片後，應先計算 SHA-256；同一張圖片即使改名，也必須留在同一 split。

禁止將 eval 的內容用於 prompt 範例、候選規則、fallback、營養補洞或任何參數調整。若根據 eval 結果完成一輪修正，應建立新的未見過 holdout set 才能再次宣稱泛化評估。

## 建置與評估

```bash
python backend/scripts/build_image_dataset.py
python backend/scripts/evaluate_image_analysis.py
```

評估器會直接使用 FastAPI `TestClient` 呼叫 `POST /api/analyze/image`，不依賴前端。若圖片尚未放入，該筆會列為 `unavailable`，指標顯示 `null`，不會把缺資料寫成 0% 或虛構成功率。也可用 `--predictions <json>` 載入依 `id` 索引的既有模型輸出，以進行離線且可重現的評分。

產出的 JSON 與 Markdown 報告位於 `backend/reports/`。報告只反映實際成功評估的樣本，不代表醫療級營養估算或專業影像辨識能力。
