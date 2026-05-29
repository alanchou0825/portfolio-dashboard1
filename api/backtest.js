export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { code, market, strategy, range = '1y', capital = 100000 } = req.body;
  if (!code || !strategy) return res.status(400).json({ error: 'MISSING PARAMS' });

  // ── 1. Fetch historical data ──
  const isTW = market === '台股' || market === 'ETF';
  // 上市用 .TW，上櫃用 .TWO；美股直接用代號
  const symCandidates = isTW ? [code + '.TW', code + '.TWO'] : [code];
  // 若指定 range 資料不足，自動 fallback 到更長週期
  const rangeFallbacks = range === '2y' || range === '5y' ? [range] : [range, '2y'];

  async function fetchYahoo(sym, r) {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=1d&range=${r}`;
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    const d = await res.json();
    return d?.chart?.result?.[0] ?? null;
  }

  function toCandles(result) {
    const ts = result.timestamp ?? [];
    const closes = result.indicators?.quote?.[0]?.close ?? [];
    return ts
      .map((t, i) => ({ date: new Date(t * 1000).toISOString().slice(0, 10), close: closes[i] }))
      .filter(d => d.close != null);
  }

  let candles = [];
  let fetched = false;
  outer: for (const sym of symCandidates) {
    for (const r of rangeFallbacks) {
      try {
        const result = await fetchYahoo(sym, r);
        if (!result) continue;
        const c = toCandles(result);
        if (c.length >= 60) { candles = c; fetched = true; break outer; }
      } catch(e) { /* try next */ }
    }
  }

  if (!fetched) return res.status(400).json({ error: `NO DATA FOR ${code}（已嘗試 .TW / .TWO，資料不足 60 天）` });

  const priceArr = candles.map(d => d.close);

  // ── 2. Indicators ──
  function sma(arr, period) {
    return arr.map((_, i) => {
      if (i < period - 1) return null;
      return arr.slice(i - period + 1, i + 1).reduce((a, b) => a + b, 0) / period;
    });
  }

  function calcRsi(arr, period = 14) {
    return arr.map((_, i) => {
      if (i < period) return null;
      const slice = arr.slice(i - period, i + 1);
      let gains = 0, losses = 0;
      for (let j = 1; j < slice.length; j++) {
        const d = slice[j] - slice[j - 1];
        if (d > 0) gains += d; else losses += -d;
      }
      const ag = gains / period;
      const al = losses / period;
      return al === 0 ? 100 : Math.round(100 - 100 / (1 + ag / al));
    });
  }

  function calcBollinger(arr, period = 20) {
    return arr.map((_, i) => {
      if (i < period - 1) return { upper: null, lower: null };
      const slice = arr.slice(i - period + 1, i + 1);
      const mid = slice.reduce((a, b) => a + b) / period;
      const std = Math.sqrt(slice.reduce((a, b) => a + (b - mid) ** 2, 0) / period);
      return { upper: mid + 2 * std, lower: mid - 2 * std };
    });
  }

  const ma5  = sma(priceArr, 5);
  const ma20 = sma(priceArr, 20);
  const ma60 = sma(priceArr, 60);
  const rsiArr = calcRsi(priceArr);
  const bollArr = calcBollinger(priceArr);

  // ── 3. Signal generation ──
  // 1 = buy, -1 = sell, 0 = hold
  const signals = candles.map((_, i) => {
    if (i === 0) return 0;
    if (strategy === 'ma_cross_5_20') {
      if (!ma5[i] || !ma20[i] || !ma5[i - 1] || !ma20[i - 1]) return 0;
      if (ma5[i - 1] < ma20[i - 1] && ma5[i] >= ma20[i]) return 1;   // golden cross MA5/20
      if (ma5[i - 1] > ma20[i - 1] && ma5[i] <= ma20[i]) return -1;  // death cross MA5/20
    }
    if (strategy === 'ma_cross') {
      if (!ma20[i] || !ma60[i] || !ma20[i - 1] || !ma60[i - 1]) return 0;
      if (ma20[i - 1] < ma60[i - 1] && ma20[i] >= ma60[i]) return 1;  // golden cross MA20/60
      if (ma20[i - 1] > ma60[i - 1] && ma20[i] <= ma60[i]) return -1; // death cross MA20/60
    }
    if (strategy === 'rsi_range') {
      if (!rsiArr[i] || !rsiArr[i - 1]) return 0;
      if (rsiArr[i - 1] >= 30 && rsiArr[i] < 30) return 1;  // drops below 30 → buy
      if (rsiArr[i - 1] <= 70 && rsiArr[i] > 70) return -1; // breaks above 70 → sell
    }
    if (strategy === 'bollinger') {
      if (!bollArr[i].lower || !bollArr[i].upper) return 0;
      if (priceArr[i] <= bollArr[i].lower) return 1;   // touches lower band → buy
      if (priceArr[i] >= bollArr[i].upper) return -1;  // touches upper band → sell
    }
    return 0;
  });

  // ── 4. Simulate trades ──
  let cash = capital;
  let shares = 0;
  let inPosition = false;
  let lastBuyPrice = 0;
  const equity = [];
  const trades = [];

  candles.forEach((d, i) => {
    if (signals[i] === 1 && !inPosition) {
      shares = Math.floor(cash / d.close);
      if (shares > 0) {
        cash -= shares * d.close;
        lastBuyPrice = d.close;
        inPosition = true;
        trades.push({ date: d.date, action: 'BUY', price: d.close, shares, pnl: null });
      }
    } else if (signals[i] === -1 && inPosition) {
      const proceeds = shares * d.close;
      const pnl = proceeds - shares * lastBuyPrice;
      cash += proceeds;
      trades.push({ date: d.date, action: 'SELL', price: d.close, shares, pnl });
      shares = 0;
      inPosition = false;
    }
    equity.push({ date: d.date, value: Math.round(cash + shares * d.close) });
  });

  // ── 5. Performance metrics ──
  const finalValue = equity[equity.length - 1]?.value ?? capital;
  const totalReturn = ((finalValue - capital) / capital * 100).toFixed(2);
  const buyHoldReturn = ((priceArr[priceArr.length - 1] - priceArr[0]) / priceArr[0] * 100).toFixed(2);

  let peak = -Infinity, maxDrawdown = 0;
  equity.forEach(({ value }) => {
    if (value > peak) peak = value;
    const dd = peak > 0 ? (peak - value) / peak : 0;
    if (dd > maxDrawdown) maxDrawdown = dd;
  });

  const sellTrades = trades.filter(t => t.action === 'SELL');
  const winTrades = sellTrades.filter(t => t.pnl > 0).length;
  const winRate = sellTrades.length ? ((winTrades / sellTrades.length) * 100).toFixed(0) : 'N/A';

  res.status(200).json({
    equity,
    trades: trades.slice(-20),
    metrics: {
      totalReturn: `${totalReturn}%`,
      buyHoldReturn: `${buyHoldReturn}%`,
      maxDrawdown: `${(maxDrawdown * 100).toFixed(2)}%`,
      winRate: winRate === 'N/A' ? 'N/A' : `${winRate}%`,
      totalTrades: sellTrades.length,
      finalValue: Math.round(finalValue).toLocaleString('zh-TW')
    }
  });
}
