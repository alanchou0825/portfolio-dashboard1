export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate');

  const { symbols } = req.query;
  if (!symbols) return res.status(400).json({ error: 'symbols required' });

  const symbolList = symbols.split(',').map(s => s.trim()).filter(Boolean);
  const results = {};

  await Promise.all(symbolList.map(async (sym) => {
    try {
      const yahooSym = /^\d{4,}/.test(sym) ? sym + '.TW' : sym;
      const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSym)}?interval=1d&range=1d`;
      const r = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0' }
      });
      const data = await r.json();
      const meta = data?.chart?.result?.[0]?.meta;
      results[sym] = {
        price: meta?.regularMarketPrice ?? null,
        prev: meta?.previousClose ?? null,
        currency: meta?.currency ?? 'TWD',
      };
    } catch (e) {
      results[sym] = { price: null, prev: null, error: e.message };
    }
  }));

  res.status(200).json(results);
}
