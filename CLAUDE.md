# CLAUDE.md — Portfolio Dashboard

## 專案概覽
- **網站（原始）**：https://portfolio-dashboard1-ten.vercel.app/
- **最新部署**：https://portfolio-dashboard1-iota.vercel.app/
- **部署平台**：Vercel（Serverless Functions）
- **技術棧**：純 HTML/CSS/JS（無框架）+ Chart.js 4.4.1（CDN）+ Vercel Node.js Serverless Functions
- **版本**：v2.6 起，依此 CLAUDE.md 持續迭代

## 檔案結構
```
portfolio-dashboard1/
├── index.html          # 全部 UI（單一 HTML 檔，~1400 行）
├── vercel.json         # Vercel rewrite 規則
├── CLAUDE.md           # 本檔案
└── api/
    ├── analyze.js      # Gemini 2.5 Flash 技術分析（POST /api/analyze）
    ├── prices.js       # 即時報價代理（GET /api/prices）
    ├── history.js      # 歷史收盤價（POST /api/history）[Phase 1 新增]
    └── backtest.js     # 回測引擎（POST /api/backtest）[Phase 2 新增]
```

## 資料結構
```js
// holdings（localStorage key: 'portfolio_v5'）
{ market: '台股'|'ETF'|'美股', name: string, code: string, shares: number, cost: number }

// enrich() 回傳的擴充持倉物件
{ ...holdings, price, priceTwd, totalCost, totalValue, profitAmt, profitPct, dayChg }
```

## UI 慣例
- Tab 切換：`switchTab(tabName, el)` / HTML：`<div class="tab-item" onclick="switchTab('xxx',this)">`
- Panel 容器：`<div class="panel" id="panel-xxx">` — 對應 `.panel` / `.panel.active`
- 區塊容器：`.section` > `.card`（或 `.card.chart-card`）
- 圖表統一用 **Chart.js 4**；每個圖表維護全域變數（`window._xxxChart`）以便 `.destroy()` 後重建
- Cyberpunk 配色變數：`--cyan #00d4ff`、`--green #00ff88`、`--red #ff2d55`、`--orange #ff9500`、`--text #e0f4ff`、`--text2 #7ab8d4`、`--mono 'Share Tech Mono'`

## API 慣例（Vercel Serverless）
- 所有 API 回傳 JSON，含 CORS header `Access-Control-Allow-Origin: *`
- Yahoo Finance proxy：`https://query1.finance.yahoo.com/v8/finance/chart/{SYMBOL}?interval=1d&range={RANGE}`
  - 台股/ETF symbol 加 `.TW`（e.g. `0050.TW`）
  - User-Agent 需設為 `Mozilla/5.0` 否則被擋
- Gemini：`gemini-2.5-flash` via `generativelanguage.googleapis.com/v1beta`

## 部署

### Vercel（前端 + Node.js API）
```bash
cd /Users/zhoubolong/portfolio-dashboard1
vercel --prod
```

### Railway（Python 自動下單後端）
```bash
cd /Users/zhoubolong/portfolio-dashboard1/backend
railway login
railway init       # 建立 project，選擇 "Empty Project"
railway up         # 部署
```
Railway 必要環境變數（Dashboard → Variables）：
```
SHIOAJI_API_KEY=永豐金API金鑰
SHIOAJI_SECRET_KEY=永豐金API秘鑰
SHIOAJI_SIMULATION=true          # 先用模擬帳戶，確認無誤再改 false
API_TOKEN=自訂隨機字串（前端 X-API-Token）
ALLOWED_ORIGINS=https://portfolio-dashboard1-iota.vercel.app
# 正式帳戶才需要：
# SHIOAJI_CA_PATH=/app/backend/ca.pfx
# SHIOAJI_CA_PASSWD=憑證密碼
# SHIOAJI_PERSON_ID=身分證字號
```

## 已知問題與錯誤歸納

### ERR-001：Yahoo Finance 偶發 429 / 無資料
- **現象**：`fetchHistory` 回傳空陣列，圖表顯示無資料
- **原因**：Yahoo Finance 非官方 API，有請求速率限制
- **處理**：API 層已做 `try/catch`，回傳 `{ error: 'NO DATA' }`；前端顯示提示訊息，不 crash

### ERR-002：Chart.js destroy() 前未檢查 null
- **現象**：切換 tab 多次後 `Cannot read properties of null (reading 'destroy')` 
- **修正**：統一用 `if (window._chart) window._chart.destroy()` 模式

### ERR-005：Railway 免費方案冷啟動延遲
- **現象**：首次呼叫後端 `/health` 等待 10-20 秒
- **原因**：Railway 免費方案閒置 30 分鐘後休眠
- **處理**：可在前端顯示「後端喚醒中...」提示；或升級 Railway 付費方案

### ERR-003：Vercel Serverless Function timeout（預設 10s）
- **現象**：持倉較多時 `/api/analyze` 逾時
- **原因**：並行 fetch Yahoo Finance × N 支，加上 Gemini 呼叫
- **處理**：Yahoo Finance fetch 已用 `Promise.all` 並行；Gemini `maxOutputTokens: 3000`

### ERR-004：localStorage 版本不符
- **現象**：舊版資料（`portfolio_v1`~`v4`）讀不到，顯示預設範例資料
- **原因**：每次重構 localStorage key 更名
- **目前 key**：`portfolio_v5`

## 開發規範
1. 新功能不動既有 JS function 命名（`renderAll`、`enrich`、`switchTab` 等）
2. 新 Chart 統一命名：`window._<功能>Chart`，切換 tab 前先 destroy
3. API 新增 route 需同步更新本檔案的「檔案結構」與「已知問題」
4. Phase 3（自動下單）需 Python FastAPI 後端，部署在 Railway，**正式使用前必須先用 Shioaji simulation=True 測試**
