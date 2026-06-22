# 圖片餐點分析精準度報告

## 評估資料集

- 總筆數：50
- 實際評估：0
- 圖片或預測不可用：50
- train / eval 切分方式：每類固定交錯切分，train/eval 各 50 筆
- 資料洩漏檢查：通過

### 類別分布

- 炸物 / 小吃: 5
- 便當: 5
- 飯類 / 丼飯: 5
- 麵類: 5
- 早餐: 5
- 日式 / 速食: 5
- 健康餐: 5
- 素食 / 蔬食: 5
- 甜點 / 飲品 / 水果: 5
- 容易誤判案例: 5

## 整體指標

- exact match accuracy：未評估
- acceptable name accuracy：未評估
- mealType accuracy：未評估
- tag precision / recall / F1：未評估 / 未評估 / 未評估
- ingredient precision / recall / F1：未評估 / 未評估 / 未評估
- allergen recall：未評估
- forbidden prediction count：0
- calorie range accuracy：未評估
- protein range accuracy：未評估
- high-confidence error count：0

## 常見錯誤類型

- 無（或尚無可評估圖片）

### confusion pairs

- 無（或尚無可評估圖片）

## 改善建議

- 對缺少關鍵視覺線索的圖片補充文字提示，並降低信心分數。
- 加入候選餐點比對，但候選規則只能取自 training split。
- 禁止推測圖片中不可見的配菜、主食與過敏原。
- 針對高頻 confusion pair 擴充新的 training 樣本，並保留新的 holdout set。
- 分別檢查熱量偏高、偏低與過敏原漏判，避免只看總體 accuracy。

> 未評估樣本不納入指標分母；本報告不代表醫療級營養估算或專業影像辨識能力。
