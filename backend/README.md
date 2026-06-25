# FastAPI Backend

此後端提供「智慧飲食建議系統」的 AI 餐點分析、餐點資料集與推薦 API。OpenAI / Gemini API key 只可放在後端環境變數，不可寫入前端或 commit 到 git。

## Local Development

Windows:

```powershell
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
copy .env.example .env
# 在 .env 填入 OPENAI_API_KEY 或 GEMINI_API_KEY
uvicorn app.main:app --reload --port 8000
```

macOS / Linux:

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
# 在 .env 填入 OPENAI_API_KEY 或 GEMINI_API_KEY
uvicorn app.main:app --reload --port 8000
```

## Render Deployment

Render start command:

```bash
uvicorn app.main:app --host 0.0.0.0 --port $PORT
```

Root Directory:

```text
backend
```

Build Command:

```bash
pip install -r requirements.txt
```

## Environment Variables

- `AI_PROVIDER`: `openai`, `gemini`, `mock`, or `auto`
- `AI_FALLBACK_ENABLED`: AI provider 失敗時是否改用系統分析規則
- `OPENAI_API_KEY`: OpenAI API key
- `OPENAI_MODEL`: 預設 `gpt-4.1-mini`
- `GEMINI_API_KEY`: Gemini API key
- `GEMINI_BASE_URL`: Gemini OpenAI-compatible endpoint
- `GEMINI_MODEL`: 預設 `gemini-2.5-flash-lite`
- `FRONTEND_ORIGIN`: CORS 允許來源，支援逗號分隔多個 origin
- `WEB_VERIFY_ENABLED`: 圖片分析後是否啟用網路比對校正
- `WEB_VERIFY_PROVIDER`: 目前支援 `gemini_grounding`

## AI Map Store Recommendation

`POST /api/nearby-places` supports AI-assisted map recommendation. The request can include `mealName`, `mealType`, `tags`, `userTextPreference`, `healthGoal`, `excludedIngredients`, `lat`, `lng`, and `radiusMeters`. The backend builds a Places query from meal context, fetches nearby candidates, then ranks stores by distance, Google rating, opening status, meal-type relevance, health-goal fit, and allergy / excluded-ingredient risk.

The response includes `aiMapScore`, `matchedReasons`, `riskNotes`, `explanation`, `openNow`, `distanceMeters`, `rating`, and Google Maps URL fields. If `GOOGLE_MAPS_API_KEY` is missing or Google Places fails, the API returns mock places with `fallbackUsed=true` instead of raising a 500 error.

Backend environment variable:

```bash
GOOGLE_MAPS_API_KEY=your_google_maps_api_key
```

Google Maps / Places API key must stay in the backend environment only. The frontend calls `/api/nearby-places` and must not store the key directly.

## API Endpoints

- `GET /api/health`
- `POST /api/analyze/text`
- `POST /api/analyze/image`
- `POST /api/analyze/url`
- `GET /api/meals`
- `POST /api/meals`
- `POST /api/recommend`
- `POST /api/nearby-places`

## User Meal Storage

- `backend/data/meals.json` is the built-in base dataset and should not be modified by user submissions at runtime.
- `POST /api/meals` writes user-added or merged meals to `backend/data/user_meals.json`.
- `GET /api/meals` and `POST /api/recommend` read the merged view of base meals plus user meals, deduplicated by normalized `mealName`.
- In local development, `user_meals.json` provides simple file-based persistence.
- On Render Free without a persistent disk, `user_meals.json` may be lost after restart or redeploy. For production-grade persistence, use Render Persistent Disk, SQLite on a persistent disk, PostgreSQL, Supabase, Firebase, or a similar external store.

## Tests

```bash
python -m pytest
```
