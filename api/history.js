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
    try {
      const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
      if (!r.ok) return null;
      const d = await r.json();
      const result = d?.chart?.result?.[0];
      if (!result) return null;
      return {
        timestamps: result.timestamp ?? [],
        closes: result.indicators?.quote?.[0]?.close ?? []
      };
    } catch {
      return null;
    }
  }

  // Sequential fetches with small delay to reduce Yahoo Finance 429
  const seriesMap = {};
  for (const h of holdings) {
    const s = await fetchCloses(h.code, h.market);
    if (s) seriesMap[h.code] = { ...s, shares: h.shares, cost: h.cost, market: h.market };
    await new Promise(r => setTimeout(r, 120));
  }

  const validSeries = Object.values(seriesMap);
  if (!validSeries.length) return res.status(200).json({ labels: [], values: [], costLine: [], partial: false });

  // Union of all timestamps — use data from whichever holdings have it
  const allTs = new Set();
  validSeries.forEach(s => s.timestamps.forEach(t => allTs.add(t)));
  const sortedTs = [...allTs].sort((a, b) => a - b);

  const usdtwd = 32;
  const totalCost = holdings.reduce((sum, h) => {
    const isTwd = h.market !== '美股';
    return sum + h.shares * h.cost * (isTwd ? 1 : usdtwd);
  }, 0);

  const labels = sortedTs.map(ts =>
    new Date(ts * 1000).toLocaleDateString('zh-TW', { month: '2-digit', day: '2-digit' })
  );

  const values = sortedTs.map(ts =>
    validSeries.reduce((sum, s) => {
      const idx = s.timestamps.indexOf(ts);
      if (idx < 0 || s.closes[idx] == null) return sum;
      const isTwd = s.market !== '美股';
      return sum + s.closes[idx] * s.shares * (isTwd ? 1 : usdtwd);
    }, 0)
  );

  const partial = validSeries.length < holdings.length;
  res.status(200).json({ labels, values, costLine: sortedTs.map(() => totalCost), partial });
}
