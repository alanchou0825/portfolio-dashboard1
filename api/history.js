export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { holdings } = req.body;
  if (!holdings?.length) return res.status(400).json({ error: 'EMPTY HOLDINGS' });

  async function fetchCloses(code, market) {
    const sym = (market === '台股' || market === 'ETF') ? code + '.TW' : code;
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=1d&range=6mo`;
    const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (!r.ok) return null;
    const d = await r.json();
    const result = d?.chart?.result?.[0];
    if (!result) return null;
    return {
      timestamps: result.timestamp ?? [],
      closes: result.indicators?.quote?.[0]?.close ?? []
    };
  }

  const seriesMap = {};
  await Promise.all(holdings.map(async h => {
    try {
      const s = await fetchCloses(h.code, h.market);
      if (s) seriesMap[h.code] = { ...s, shares: h.shares, cost: h.cost, market: h.market };
    } catch { /* ERR-001: Yahoo Finance rate limit — skip this holding */ }
  }));

  const validSeries = Object.values(seriesMap).filter(Boolean);
  if (!validSeries.length) return res.status(200).json({ labels: [], values: [], costLine: [] });

  // Find common timestamps across all holdings
  const tsArrays = validSeries.map(s => s.timestamps);
  const commonTs = tsArrays.reduce((acc, arr) => {
    const set = new Set(arr);
    return acc.filter(t => set.has(t));
  });

  if (!commonTs.length) return res.status(200).json({ labels: [], values: [], costLine: [] });

  const labels = commonTs.map(ts =>
    new Date(ts * 1000).toLocaleDateString('zh-TW', { month: '2-digit', day: '2-digit' })
  );

  // USD/TWD rate (rough) for US stocks
  const usdtwd = 32;

  const totalCost = holdings.reduce((sum, h) => {
    const isTwd = h.market !== '美股';
    return sum + h.shares * h.cost * (isTwd ? 1 : usdtwd);
  }, 0);

  const values = commonTs.map(ts =>
    Object.entries(seriesMap).reduce((sum, [code, s]) => {
      const idx = s.timestamps.indexOf(ts);
      if (idx < 0 || s.closes[idx] == null) return sum;
      const isTwd = s.market !== '美股';
      return sum + s.closes[idx] * s.shares * (isTwd ? 1 : usdtwd);
    }, 0)
  );

  res.status(200).json({ labels, values, costLine: commonTs.map(() => totalCost) });
}
