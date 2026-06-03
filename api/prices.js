import yahooFinance from 'yahoo-finance2';

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
      const quote = await yahooFinance.quote(yahooSym, {}, { validateResult: false });
      results[sym] = {
        price: quote?.regularMarketPrice ?? null,
        prev:  quote?.regularMarketPreviousClose ?? null,
        currency: quote?.currency ?? (/^\d{4,}/.test(sym) ? 'TWD' : 'USD'),
      };
    } catch (e) {
      results[sym] = { price: null, prev: null, error: e.message };
    }
  }));

  res.status(200).json(results);
}
