import yahooFinance from 'yahoo-finance2';

export const config = {
  maxDuration: 60
};

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { apiKey, portfolio } = req.body;
  if (!apiKey) return res.status(400).json({ error: 'MISSING API KEY' });
  if (!portfolio?.length) return res.status(400).json({ error: 'EMPTY PORTFOLIO' });

  // ── Fetch historical data via yahoo-finance2 ──
  async function fetchHistory(sym, market) {
    const yahooSym = (market === '台股' || market === 'ETF') ? sym + '.TW' : sym;
    const period1 = new Date();
    period1.setFullYear(period1.getFullYear() - 1);
    const chart = await yahooFinance.chart(yahooSym, { period1, interval: '1d' }, { validateResult: false });
    return (chart?.quotes ?? []).map(q => q.close).filter(c => c != null);
  }

  // ── Indicators ──
  function ma(closes, period) {
    if (closes.length < period) return null;
    const slice = closes.slice(-period);
    return slice.reduce((a, b) => a + b, 0) / period;
  }

  function rollingMa(closes, period) {
    const result = [];
    for (let i = period; i <= closes.length; i++) {
      const slice = closes.slice(i - period, i);
      result.push(slice.reduce((a, b) => a + b, 0) / period);
    }
    return result;
  }

  function detectCross(short, long) {
    if (short.length < 2 || long.length < 2) return 'N/A';
    const minLen = Math.min(short.length, long.length);
    const s = short.slice(-minLen);
    const l = long.slice(-minLen);
    const prevDiff = s[s.length - 2] - l[l.length - 2];
    const currDiff = s[s.length - 1] - l[l.length - 1];
    if (prevDiff < 0 && currDiff >= 0) return 'GOLDEN';
    if (prevDiff > 0 && currDiff <= 0) return 'DEATH';
    return currDiff > 0 ? 'BULL' : 'BEAR';
  }

  function rsi(closes, period = 14) {
    if (closes.length < period + 1) return null;
    const deltas = closes.slice(1).map((c, i) => c - closes[i]);
    const gains = deltas.map(d => d > 0 ? d : 0);
    const losses = deltas.map(d => d < 0 ? -d : 0);
    const avgGain = gains.slice(-period).reduce((a, b) => a + b, 0) / period;
    const avgLoss = losses.slice(-period).reduce((a, b) => a + b, 0) / period;
    if (avgLoss === 0) return 100;
    return Math.round(100 - 100 / (1 + avgGain / avgLoss));
  }

  function bollinger(closes, period = 20) {
    if (closes.length < period) return { upper: null, mid: null, lower: null };
    const slice = closes.slice(-period);
    const mid = slice.reduce((a, b) => a + b, 0) / period;
    const std = Math.sqrt(slice.reduce((a, b) => a + (b - mid) ** 2, 0) / period);
    return {
      upper: Math.round((mid + 2 * std) * 100) / 100,
      mid: Math.round(mid * 100) / 100,
      lower: Math.round((mid - 2 * std) * 100) / 100,
    };
  }

  function week52Position(closes) {
    if (closes.length < 2) return null;
    const slice = closes.slice(-252);
    const high = Math.max(...slice);
    const low = Math.min(...slice);
    if (high === low) return 50;
    return Math.round((closes[closes.length - 1] - low) / (high - low) * 100 * 10) / 10;
  }

  // ── Compute indicators for each holding ──
  const indicators = {};
  await Promise.all(portfolio.map(async (h) => {
    try {
      const closes = await fetchHistory(h.code, h.market);
      if (!closes.length) { indicators[h.code] = { error: 'NO DATA' }; return; }

      const ma5s = rollingMa(closes, 5);
      const ma20s = rollingMa(closes, 20);
      const ma60s = rollingMa(closes, 60);
      const ma120s = rollingMa(closes, 120);

      indicators[h.code] = {
        current: Math.round(closes[closes.length - 1] * 100) / 100,
        ma5: ma(closes, 5),
        ma20: ma(closes, 20),
        ma60: ma(closes, 60),
        ma120: ma(closes, 120),
        cross_5_20: detectCross(ma5s, ma20s),
        cross_20_60: detectCross(ma20s, ma60s),
        cross_60_120: detectCross(ma60s, ma120s),
        rsi: rsi(closes),
        ...bollinger(closes),
        bb_upper: bollinger(closes).upper,
        bb_mid: bollinger(closes).mid,
        bb_lower: bollinger(closes).lower,
        week52_position: week52Position(closes),
      };
    } catch (e) {
      indicators[h.code] = { error: e.message };
    }
  }));

  // ── Build Gemini prompt ──
  const crossLabels = {
    GOLDEN: '黃金交叉（多頭）', DEATH: '死亡交叉（空頭）',
    BULL: '多頭排列', BEAR: '空頭排列',
    NEUTRAL: '中立', 'N/A': '資料不足',
  };

  const lines = portfolio.map(h => {
    const ind = indicators[h.code];
    if (!ind || ind.error) return `- ${h.name}(${h.code}): 無法取得技術數據`;
    const rsiNote = ind.rsi > 70 ? '（超買警示）' : ind.rsi < 30 ? '（超賣，可能反彈）' : '';
    const profitStr = h.profitPct != null ? `${h.profitPct >= 0 ? '+' : ''}${h.profitPct.toFixed(2)}%` : 'N/A';
    return `- ${h.name}(${h.code}):\n` +
      `  持倉報酬率: ${profitStr} | 現價: ${ind.current}\n` +
      `  MA5/20交叉: ${crossLabels[ind.cross_5_20]} | MA20/60交叉: ${crossLabels[ind.cross_20_60]} | MA60/120交叉: ${crossLabels[ind.cross_60_120]}\n` +
      `  RSI: ${ind.rsi} ${rsiNote} | 52週位置: ${ind.week52_position}%\n` +
      `  布林通道: 上${ind.bb_upper} / 中${ind.bb_mid} / 下${ind.bb_lower}`;
  });

  const prompt = `你是一位親切的專業股票分析師，正在幫一位穩健型投資人分析他的投資組合。

以下是每檔持股的技術指標數據：

${lines.join('\n\n')}

請用口語化、容易理解的方式，針對每一檔持股依序說明：
1. 目前走勢是偏多、盤整還是偏空，用一句話說清楚
2. 均線交叉的狀況代表什麼意思
3. RSI 和布林通道顯示現在是超買、超賣還是正常
4. 最後給出明確的操作建議，只能選以下四種之一：
   「建議買入」、「繼續觀察」、「部分獲利了結」、「建議賣出」
   並且用一句話解釋理由

最後總結整體投組目前偏多、中性還是偏空，以及最需要注意的一兩個風險。

注意事項：
- 請用繁體中文回覆
- 語氣要像在跟朋友說話，不要太學術
- 不要使用星號或 Markdown 格式符號
- 每檔股票之間用一條分隔線隔開
- 結尾加上：以上為 AI 技術分析參考，實際投資請自行判斷。`;

  // ── Call Gemini ──
  try {
    const geminiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { maxOutputTokens: 8192, temperature: 0.6 }
        })
      }
    );

    if (!geminiRes.ok) {
      const err = await geminiRes.json();
      throw new Error(err.error?.message || `Gemini HTTP ${geminiRes.status}`);
    }

    const geminiData = await geminiRes.json();
    const analysis = geminiData.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!analysis) throw new Error('NO RESPONSE FROM GEMINI');

    res.status(200).json({ analysis, indicators });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
