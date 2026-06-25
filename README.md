# 智慧飲食建議系統

本專案是 React + TypeScript + Vite 前端與 FastAPI 後端組成的智慧飲食建議系統。使用者可以輸入餐點描述、上傳餐點照片或貼上餐點連結，系統會透過後端呼叫 OpenAI / Gemini 進行餐點分析，並提供熱量、蛋白質、飲食標籤、主要食材、過敏原與推薦原因。

公開部署架構：

- 前端：GitHub Pages
- 後端：Render Web Service
- API Key：只放在 Render 環境變數，不放前端、不提交 GitHub

## AI-assisted recommendation flow

本系統不僅使用餐點資料庫進行條件篩選，也加入 AI 輔助推薦流程。AI 會解析使用者自然語言飲食需求，結合健康目標、飲食標籤、過敏原與候選餐點資訊，產生個人化排序與可解釋推薦理由。系統仍保留規則式硬性排除，確保過敏原與禁忌食材不會被 AI 推薦結果覆蓋。

推薦流程為：先排除不完整餐點與禁忌食材，再由 AI 對安全候選餐點排序；若 AI 排序服務暫時不可用，系統會自動改用基本條件推薦並提示使用者。

## Features

- 文字、圖片、URL 餐點分析
- 圖片分析支援候選餐點初判與網路比對校正
- AI 分析結果可加入餐點資料集
- 使用者新增餐點會以 upsert 方式合併同名餐點，避免重複卡片
- 根據健康目標、飲食標籤、禁忌食材與關鍵字推薦餐點
- 後端未啟動時，前端可顯示離線展示資料

## Windows 一鍵啟動方式

雙擊專案根目錄的 `start-dev.bat`。

也可以在 PowerShell 執行：

```powershell
.\start-dev.bat
```

或在 Command Prompt 執行：

```bat
cd /d C:\Users\justi\Desktop\project
start-dev.bat
```

啟動後會分別開啟 FastAPI 後端與 React / Vite 前端，並自動開啟 `http://localhost:5173`。

## Frontend Development

```bash
npm install
npm run dev
```

本機前端環境變數範例：

```bash
VITE_API_BASE_URL=http://localhost:8000
```

請參考 `.env.example` 與 `.env.production.example`。

## Backend Development

```powershell
cd backend
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
copy .env.example .env
# 在 .env 填入 OPENAI_API_KEY 或 GEMINI_API_KEY
uvicorn app.main:app --reload --port 8000
```

正式部署時不可綁死 localhost，Render start command 應使用：

```bash
uvicorn app.main:app --host 0.0.0.0 --port $PORT
```

## GitHub Pages 部署前端

1. 到 GitHub repo `Settings -> Pages`。
2. Source 選擇 `GitHub Actions`。
3. 到 `Settings -> Secrets and variables -> Actions` 新增 secret：

```bash
VITE_API_BASE_URL=https://your-render-backend.onrender.com
```

4. Push 到 `main` 後，`.github/workflows/deploy-pages.yml` 會自動執行：
   - `npm ci`
   - `npm run build`
   - upload `dist`
   - deploy to GitHub Pages
5. GitHub Pages 網址格式：

```text
https://<username>.github.io/<repo-name>/
```

Workflow build 時會設定：

```bash
VITE_BASE_PATH=/${{ github.event.repository.name }}/
VITE_API_BASE_URL=${{ secrets.VITE_API_BASE_URL }}
```

## Render 部署後端

方式一：使用 `render.yaml`

1. 到 Render 建立 Blueprint，連接 GitHub repo。
2. Render 會讀取根目錄的 `render.yaml`。
3. 確認服務設定：
   - Root Directory: `backend`
   - Build Command: `pip install -r requirements.txt`
   - Start Command: `uvicorn app.main:app --host 0.0.0.0 --port $PORT`

方式二：手動建立 Web Service

1. 到 Render 建立 Web Service。
2. 連接 GitHub repo。
3. Root Directory 設 `backend`。
4. Build Command 設 `pip install -r requirements.txt`。
5. Start Command 設 `uvicorn app.main:app --host 0.0.0.0 --port $PORT`。
6. 設定 Environment Variables。
7. 部署完成後取得 `https://xxx.onrender.com`。
8. 回 GitHub Actions Secrets 設定 `VITE_API_BASE_URL=https://xxx.onrender.com`。

Render 建議環境變數：

```bash
AI_PROVIDER=auto
AI_FALLBACK_ENABLED=true
OPENAI_API_KEY=your_openai_api_key_here
OPENAI_MODEL=gpt-4.1-mini
GEMINI_API_KEY=your_gemini_api_key_here
GEMINI_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai/
GEMINI_MODEL=gemini-2.5-flash-lite
FRONTEND_ORIGIN=http://localhost:5173,https://your-username.github.io
WEB_VERIFY_ENABLED=false
WEB_VERIFY_PROVIDER=gemini_grounding
```

`FRONTEND_ORIGIN` 支援逗號分隔多個 origin。公開部署後建議包含你的 GitHub Pages origin，例如：

```bash
FRONTEND_ORIGIN=http://localhost:5173,https://justin8120.github.io
```

## 使用者新增餐點資料

後端將內建資料與使用者資料分開管理：

- `backend/data/meals.json`：內建基礎資料集
- `backend/data/user_meals.json`：使用者透過 `POST /api/meals` 新增或合併的餐點

`POST /api/meals` 會依正規化後的餐點名稱 upsert：

- 同名餐點已存在：合併標籤、主要食材、過敏原與較完整說明
- 同名餐點不存在：新增到 `user_meals.json`

本機開發時，`user_meals.json` 可作為簡易持久化。Render Free 若未設定 persistent disk，重新部署或服務重啟後檔案可能遺失；若要正式保存線上使用者新增資料，建議後續改用 Render Persistent Disk、SQLite + persistent disk、PostgreSQL、Supabase 或 Firebase。

## API Key Safety

不要提交下列檔案或內容：

- `backend/.env`
- `.env`
- OpenAI API key
- Gemini API key
- 任何真實 token 或 secret

本專案 `.gitignore` 會忽略 `.env`、`.env.*`、`backend/.env`、`backend/.env.*`，但保留 `.env.example`、`.env.production.example`、`backend/.env.example` 作為範本。

## Validation

Frontend:

```bash
npm run validate
npm run build
```

Backend:

```bash
cd backend
python -m pytest
```

健康檢查：

```bash
curl http://localhost:8000/api/health
```

## Risks / Follow-Ups

- automated visual diff is not configured
- project documents should stay synchronized after deployment changes
