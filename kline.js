export const config = { maxDuration: 30 };

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate');

  const { symbol, market, range = '3mo' } = req.query;
  if (!symbol) return res.status(400).json({ error: 'symbol required' });

  const rangeMap = {
    '1d':  { range: '1d',  interval: '5m'  },
    '1wk': { range: '5d',  interval: '30m' },
    '1mo': { range: '1mo', interval: '1d'  },
    '3mo': { range: '3mo', interval: '1d'  },
    '6mo': { range: '6mo', interval: '1d'  },
    '1y':  { range: '1y',  interval: '1d'  },
  };

  const { range: yRange, interval } = rangeMap[range] || rangeMap['3mo'];
  const isUs = market === '美股';
  const yahooSym = (!isUs) ? symbol + '.TW' : symbol;

  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSym)}?interval=${interval}&range=${yRange}`;
    const r = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
        'Accept': 'application/json',
      },
      signal: AbortSignal.timeout(10000)
    });

    if (!r.ok) throw new Error(`Yahoo HTTP ${r.status}`);
    const data = await r.json();
    const result = data?.chart?.result?.[0];
    if (!result) throw new Error('No data');

    const timestamps = result.timestamp ?? [];
    const q = result.indicators?.quote?.[0] ?? {};
    const opens   = q.open   ?? [];
    const highs   = q.high   ?? [];
    const lows    = q.low    ?? [];
    const closes  = q.close  ?? [];
    const volumes = q.volume ?? [];

    // Build candles
    const candles = [];
    for (let i = 0; i < timestamps.length; i++) {
      if (closes[i] == null) continue;
      candles.push({
        time: timestamps[i],
        open:   Math.round((opens[i]   ?? closes[i]) * 100) / 100,
        high:   Math.round((highs[i]   ?? closes[i]) * 100) / 100,
        low:    Math.round((lows[i]    ?? closes[i]) * 100) / 100,
        close:  Math.round(closes[i] * 100) / 100,
        volume: volumes[i] ?? 0,
      });
    }

    // Compute moving averages
    function ma(arr, period) {
      return arr.map((_, i) => {
        if (i < period - 1) return null;
        const slice = arr.slice(i - period + 1, i + 1);
        if (slice.some(v => v == null)) return null;
        return Math.round(slice.reduce((a, b) => a + b, 0) / period * 100) / 100;
      });
    }

    const validCloses = candles.map(c => c.close);
    const ma5arr  = ma(validCloses, 5);
    const ma20arr = ma(validCloses, 20);
    const ma60arr = ma(validCloses, 60);

    const maLines = {
      ma5:  candles.map((c, i) => ma5arr[i]  != null ? { time: c.time, value: ma5arr[i] }  : null).filter(Boolean),
      ma20: candles.map((c, i) => ma20arr[i] != null ? { time: c.time, value: ma20arr[i] } : null).filter(Boolean),
      ma60: candles.map((c, i) => ma60arr[i] != null ? { time: c.time, value: ma60arr[i] } : null).filter(Boolean),
    };

    // Compute Bollinger Bands (buy/sell zones)
    const bbPeriod = 20;
    const bbLines = { upper: [], mid: [], lower: [] };
    for (let i = bbPeriod - 1; i < validCloses.length; i++) {
      const slice = validCloses.slice(i - bbPeriod + 1, i + 1);
      const mean  = slice.reduce((a, b) => a + b, 0) / bbPeriod;
      const std   = Math.sqrt(slice.reduce((a, b) => a + (b - mean) ** 2, 0) / bbPeriod);
      const t = candles[i].time;
      bbLines.upper.push({ time: t, value: Math.round((mean + 2 * std) * 100) / 100 });
      bbLines.mid.push(  { time: t, value: Math.round(mean * 100) / 100 });
      bbLines.lower.push({ time: t, value: Math.round((mean - 2 * std) * 100) / 100 });
    }

    // Compute RSI for latest value
    function rsi(closes, period = 14) {
      if (closes.length < period + 1) return null;
      const deltas = closes.slice(1).map((c, i) => c - closes[i]);
      const gains  = deltas.map(d => d > 0 ? d : 0);
      const losses = deltas.map(d => d < 0 ? -d : 0);
      const ag = gains.slice(-period).reduce((a, b) => a + b, 0) / period;
      const al = losses.slice(-period).reduce((a, b) => a + b, 0) / period;
      if (al === 0) return 100;
      return Math.round(100 - 100 / (1 + ag / al));
    }

    // Determine buy/sell zones based on Bollinger + RSI
    const latestClose = validCloses[validCloses.length - 1];
    const latestUpper = bbLines.upper[bbLines.upper.length - 1]?.value;
    const latestLower = bbLines.lower[bbLines.lower.length - 1]?.value;
    const latestMid   = bbLines.mid[bbLines.mid.length - 1]?.value;
    const latestRsi   = rsi(validCloses);

    let buyZone  = null;
    let sellZone = null;
    let zoneNote = '';

    if (latestLower && latestMid) {
      buyZone  = { min: Math.round(latestLower * 100) / 100, max: Math.round(latestMid * 100) / 100 };
    }
    if (latestUpper && latestMid) {
      sellZone = { min: Math.round(latestMid * 100) / 100,  max: Math.round(latestUpper * 100) / 100 };
    }

    if (latestRsi != null) {
      if (latestRsi < 30)      zoneNote = `RSI ${latestRsi}，超賣區間，偏向買入機會`;
      else if (latestRsi > 70) zoneNote = `RSI ${latestRsi}，超買區間，注意回檔風險`;
      else                     zoneNote = `RSI ${latestRsi}，目前在正常範圍`;
    }

    res.status(200).json({
      symbol,
      candles,
      maLines,
      bbLines,
      buyZone,
      sellZone,
      latestRsi,
      zoneNote,
      currentPrice: latestClose,
    });

  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
