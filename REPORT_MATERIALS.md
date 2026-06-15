# 智慧飲食建議系統報告素材整理

本文件依目前專案狀態，整理可放入下列文件的必要內容：

- `需求分析報告.docx`
- `系統分析報告.docx`
- `系統設計報告.docx`
- `AITool.pptx`

目前未在專案目錄找到上述 Word / PowerPoint 檔案，因此本文件先提供可直接貼入各報告或簡報的內容素材。

## 一、需求分析報告可用內容

### 專題名稱

智慧飲食建議系統

### 系統定位

本系統定位為「日常飲食建議與輔助決策系統」，協助一般使用者依據飲食偏好、健康目標、禁忌食材與餐點資訊，取得餐點分析與推薦結果。系統提供合理估算與輔助判斷，不宣稱醫療級營養計算，也不作為精準疾病治療或過敏診斷工具。

### 問題背景

一般使用者在選擇餐點時，常會遇到下列問題：

- 不清楚餐點大約熱量、蛋白質與主要食材。
- 有減脂、增肌、健康維持等目標，但缺少快速篩選工具。
- 有過敏原或禁忌食材，例如花生、海鮮、牛肉、豬肉、麩質、香菜、辣椒等，需要避免不適合的餐點。
- 看到菜單、餐點圖片或餐點連結時，希望能快速取得初步分析。
- 想將新餐點加入資料集，讓後續推薦可以使用。

### 使用者角色

- 一般飲食使用者：想依照日常需求快速挑選餐點。
- 健身或健康管理者：關注蛋白質、熱量與飲食標籤。
- 有忌口或過敏需求者：需要排除特定食材。
- 專題展示評閱者：需要看到 AI 分析、資料集、推薦與部署成果。

### 功能需求

- 餐點分析：
  - 支援文字描述分析。
  - 支援圖片上傳分析。
  - 支援餐點或菜單 URL 分析。
  - 後端呼叫 OpenAI / Gemini，API key 不放前端。
  - 分析結果包含餐點名稱、類型、估算熱量、估算蛋白質、標籤、主要食材、過敏原、推薦原因、信心分數。

- 餐點推薦：
  - 可選健康目標：減脂、增肌、均衡飲食、健康維持。
  - 可選飲食標籤：低卡、高蛋白、低脂、健康餐、素食。
  - 可自訂飲食標籤，資料存於 localStorage。
  - 可選或自訂禁忌食材 / 過敏原。
  - 禁忌食材為硬性排除條件，不只是扣分。
  - 查無結果時顯示明確提示。

- 餐點資料集：
  - 後端提供內建餐點資料集。
  - 支援使用者將 AI 分析結果加入資料集。
  - 同名餐點使用 upsert / merge，避免重複資料。
  - 內建資料與使用者新增資料分離。

- 附近類似店家：
  - 後端已建立 Google Places API endpoint 設計。
  - 前端目前先提供 mock UI，於每張餐點卡片底部顯示「查看附近店家」。
  - mock 階段不要求定位、不呼叫 Google Places。

### 非功能需求

- 安全性：OpenAI / Gemini / Google Maps API key 只放後端環境變數。
- 可維護性：前端使用 React + TypeScript + Vite；後端使用 FastAPI。
- 可測試性：Vitest、React Testing Library、pytest、browser walkthrough。
- 可部署性：前端部署 GitHub Pages；後端部署 Render。
- 響應式設計：桌面與手機版需正常顯示。
- 資料品質：避免顯示空食材、0 kcal、通用模板或高信心亂猜結果。

### 系統限制

- 營養數值為 AI 與規則合理估算，非精準營養標示。
- 圖片與 URL 僅作為輔助輸入，資訊不足時應降低信心分數。
- Render Free 若未設定 persistent disk，使用者新增資料可能因重啟或重新部署遺失。
- 自動視覺 diff 尚未設定。

## 二、系統分析報告可用內容

### 系統範圍

系統包含前端網頁、後端 API、AI 分析服務、餐點資料集、推薦引擎與部署流程。

### 主要使用案例

1. 使用者輸入餐點文字描述，系統分析餐點。
2. 使用者上傳餐點圖片，系統依圖片與可選文字提示分析餐點。
3. 使用者貼上餐點 URL，系統擷取頁面或 slug 資訊並分析。
4. 使用者依健康目標、飲食標籤與禁忌食材搜尋推薦餐點。
5. 使用者自訂飲食標籤或禁忌食材。
6. 使用者將分析結果加入餐點資料集。
7. 使用者在餐點卡片查看附近類似店家 mock 結果。

### 資料流程

1. 前端收集使用者輸入。
2. 前端呼叫 FastAPI 後端。
3. 後端依輸入類型呼叫 AI provider 或系統分析流程。
4. 後端進行名稱正規化、營養補全、信心分數校正與資料品質驗證。
5. 分析結果回傳前端顯示。
6. 若使用者加入資料集，後端以 upsert / merge 寫入 `user_meals.json`。
7. 推薦時後端合併內建資料與使用者資料，先套用禁忌食材硬性排除，再依條件推薦。

### API Endpoints

- `GET /api/health`：回傳後端狀態與 AI provider 設定狀態。
- `POST /api/analyze/text`：文字餐點分析。
- `POST /api/analyze/image`：圖片餐點分析，可附文字提示。
- `POST /api/analyze/url`：URL 餐點分析。
- `GET /api/meals`：取得餐點資料集。
- `POST /api/meals`：新增或合併餐點資料。
- `POST /api/recommend`：依條件推薦餐點。
- `POST /api/nearby-places`：Google Places 附近店家查詢 API，前端目前先使用 mock UI。

### 主要資料模型

MealAnalysisResult：

- id
- mealName
- mealType
- estimatedCalories
- estimatedProtein
- tags
- mainIngredients
- allergens
- recommendationReason
- confidence
- sourceType：text / image / url
- createdAt
- isAiGenerated
- recommendedGoals
- warningMessage
- nutritionNote

RecommendRequest：

- healthGoal
- tags
- excludedIngredients
- keyword

NearbyPlacesRequest：

- lat
- lng
- mealName
- mealType
- tags
- radiusMeters

### 推薦邏輯分析

- 先取得候選餐點。
- 套用禁忌食材 / 過敏原硬性排除。
- 使用通用 constraint normalization 將「不吃豬肉、不要牛肉、花生過敏、無麩質、不吃辣」等文字轉成核心詞。
- 對餐點名稱、類型、標籤、主要食材、過敏原與推薦原因做全文比對。
- 大分類保留同義詞 mapping，例如肉類、豬肉、牛肉、雞肉、海鮮、甲殼類、堅果、花生、乳製品、麩質、蛋、酒精、辛辣。
- 未知自訂詞不報錯；若餐點資料中明確出現該詞則排除。
- 再依健康目標與飲食標籤排序 / 篩選。

### AI 分析策略

- 真正 AI 呼叫需透過 FastAPI 後端。
- 前端不存放 API key。
- 支援 Gemini / OpenAI provider。
- 若 AI 失敗，系統可用保守 fallback，但不可顯示工程字樣。
- 所有結果須經過 normalize / enrich / validation / confidence calibration。
- 若資訊不足，降低信心分數並提示補充資訊。

## 三、系統設計報告可用內容

### 系統架構

- Frontend：React + TypeScript + Vite
- Backend：FastAPI
- AI Provider：OpenAI / Gemini
- Storage：
  - `backend/data/meals.json`：內建餐點資料。
  - `backend/data/user_meals.json`：使用者新增餐點資料。
  - localStorage：前端自訂標籤、自訂禁忌食材、離線使用者餐點暫存。
- Deployment：
  - GitHub Pages：前端靜態網站。
  - Render：FastAPI 後端服務。

### 前端設計

主要檔案：

- `src/App.tsx`：主要 UI 與互動流程。
- `src/api.ts`：API client。
- `src/mealData.ts`：前端離線展示資料。
- `src/styles.css`：深色介面與響應式樣式。
- `src/App.test.tsx`：前端 component tests。

主要 UI 區塊：

- 系統介紹
- AI 餐點分析
- 餐點推薦
- 推薦結果
- 餐點資料集
- 查詢紀錄

### 後端設計

主要檔案：

- `backend/app/main.py`：FastAPI app、CORS、API endpoints。
- `backend/app/models.py`：Pydantic schema。
- `backend/app/services/openai_meal_analyzer.py`：AI 餐點分析流程。
- `backend/app/services/ai_provider.py`：provider 與 fallback 分析。
- `backend/app/services/nutrition_enricher.py`：餐點名稱正規化、營養補全、信心校正。
- `backend/app/services/url_fetcher.py`：URL 頁面擷取。
- `backend/app/services/web_food_verifier.py`：圖片候選校正 / web verification。
- `backend/app/services/nearby_places.py`：Google Places 查詢邏輯。
- `backend/app/storage/meals_store.py`：餐點資料讀取、合併、推薦、禁忌排除。

### 資料儲存設計

- 內建資料與使用者資料分離，避免使用者新增資料污染 base dataset。
- `/api/meals` 讀取時合併 base meals 與 user meals。
- `POST /api/meals` 使用 upsert：
  - 同名餐點合併 tags、mainIngredients、allergens、recommendedGoals。
  - 不完整餐點拒絕加入。
  - 避免重複餐點卡片。

### 部署設計

前端：

- GitHub Pages
- 使用 `VITE_API_BASE_URL` 指向 Render 後端。
- 使用 `VITE_BASE_PATH` 支援 repository page。

後端：

- Render Web Service
- start command：

```bash
uvicorn app.main:app --host 0.0.0.0 --port $PORT
```

環境變數：

- `AI_PROVIDER`
- `OPENAI_API_KEY`
- `GEMINI_API_KEY`
- `FRONTEND_ORIGIN`
- `GOOGLE_MAPS_API_KEY`
- `GOOGLE_PLACES_RADIUS_METERS`

### 測試與品質流程

前端：

- `npm run check:content`
- `npm run format:check`
- `npm run lint`
- `npm run typecheck`
- `npm run test`
- `npm run build`
- `npm run test:browser`
- 統一由 `npm run validate` 執行。

後端：

- `python -m pytest`

CI / CD：

- GitHub Actions CI
- GitHub Pages deploy workflow
- Render deployment

## 四、AITool.pptx 可用簡報內容

### Slide 1：專題名稱

智慧飲食建議系統  
日常飲食建議與輔助決策工具

### Slide 2：研究動機

- 使用者常不知道餐點熱量、蛋白質與主要食材。
- 飲食目標與禁忌食材需要快速篩選。
- 圖片、文字、URL 等資訊來源分散。
- 希望透過 AI 提供初步分析與推薦。

### Slide 3：系統目標

- 透過 AI 分析餐點文字、圖片與連結。
- 根據健康目標與飲食偏好推薦餐點。
- 過敏原與禁忌食材作為硬性排除條件。
- 支援使用者擴充餐點資料集。
- 前後端分離並可公開部署。

### Slide 4：核心功能

- AI 餐點分析
- 餐點推薦
- 自訂飲食標籤
- 自訂禁忌食材
- 餐點資料集 upsert
- 附近類似店家 mock UI

### Slide 5：AI 工具使用方式

- 後端整合 OpenAI / Gemini。
- 使用 Responses API / Gemini API 分析餐點。
- 圖片與 URL 僅作為輔助資訊。
- 信心分數低時提示使用者補充資訊。
- API key 僅放後端環境變數。

### Slide 6：系統架構圖建議

可畫成：

使用者 → React / Vite 前端 → FastAPI 後端 → AI Provider / Google Places / JSON Dataset

資料流：

1. 使用者輸入文字 / 圖片 / URL。
2. 前端呼叫後端 API。
3. 後端呼叫 AI 並進行後處理。
4. 前端顯示餐點分析與推薦結果。
5. 使用者可加入資料集。

### Slide 7：推薦流程

1. 取得候選餐點。
2. 套用禁忌食材硬性排除。
3. 比對健康目標與飲食標籤。
4. 回傳推薦結果。
5. 無符合結果時顯示提示。

### Slide 8：技術架構

- Frontend：React、TypeScript、Vite
- Backend：FastAPI、Pydantic
- AI：OpenAI / Gemini
- Storage：JSON file + localStorage
- Deploy：GitHub Pages + Render
- Test：Vitest、React Testing Library、pytest、browser walkthrough

### Slide 9：目前成果

- 前端 UI 已完成。
- 後端 API 已完成。
- AI 餐點分析流程已建立。
- 餐點資料集與推薦流程已建立。
- 自訂標籤與禁忌食材已支援。
- GitHub Pages / Render 部署架構已建立。
- `npm run validate` 可通過。

### Slide 10：限制與未來改善

- 營養數值為合理估算，非醫療級精準數據。
- 圖片辨識與 URL 解析若資訊不足需降低信心分數。
- Render Free 未設定 persistent disk 時，使用者資料可能不永久保存。
- 未來可加入正式 Google Places 前端定位流程。
- 未來可加入自動視覺 diff。
- 未來可改用 PostgreSQL / Supabase / Firebase 保存使用者資料。

## 五、可放入報告的驗證狀態

目前前端完整驗證流程：

```bash
npm run validate
```

包含：

- content check
- format check
- lint
- typecheck
- unit/component tests
- production build
- browser walkthrough

後端驗證：

```bash
cd backend
python -m pytest
```

## 六、建議放入各文件的重點

### 需求分析報告

放入：系統定位、問題背景、使用者角色、功能需求、非功能需求、限制。

### 系統分析報告

放入：使用案例、資料流程、API endpoints、資料模型、推薦邏輯、AI 分析策略。

### 系統設計報告

放入：系統架構、前端設計、後端設計、資料儲存設計、部署設計、測試流程。

### AITool.pptx

放入：研究動機、系統目標、AI 使用方式、架構圖、核心功能、成果展示、限制與未來改善。
