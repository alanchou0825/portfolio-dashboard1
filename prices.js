export const config = { maxDuration: 30 };

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

      // Try v8 endpoint first, fallback to v7
      const endpoints = [
        `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSym)}?interval=1d&range=1d`,
        `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSym)}?interval=1d&range=1d`,
      ];

      let price = null, prev = null;

      for (const url of endpoints) {
        try {
          const r = await fetch(url, {
            headers: {
              'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
              'Accept': 'application/json',
              'Accept-Language': 'en-US,en;q=0.9',
            },
            signal: AbortSignal.timeout(8000)
          });
          if (!r.ok) continue;
          const data = await r.json();
          const meta = data?.chart?.result?.[0]?.meta;
          if (meta?.regularMarketPrice) {
            price = Math.round(meta.regularMarketPrice * 100) / 100;
            prev = meta.previousClose ? Math.round(meta.previousClose * 100) / 100 : null;
            break;
          }
        } catch { continue; }
      }

      results[sym] = { price, prev, currency: /^\d{4,}/.test(sym) ? 'TWD' : 'USD' };
    } catch (e) {
      results[sym] = { price: null, prev: null, error: e.message };
    }
  }));

  res.status(200).json(results);
}
