import yahooFinance from 'yahoo-finance2';

export const config = { maxDuration: 30 };

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate');

  const { symbol, market, range = '3mo' } = req.query;
  if (!symbol) return res.status(400).json({ error: 'symbol required' });

  const rangeMap = {
    '1d':  { period1: daysAgo(1),   interval: '5m'  },
    '1wk': { period1: daysAgo(7),   interval: '30m' },
    '1mo': { period1: daysAgo(30),  interval: '1d'  },
    '3mo': { period1: daysAgo(90),  interval: '1d'  },
    '6mo': { period1: daysAgo(180), interval: '1d'  },
    '1y':  { period1: daysAgo(365), interval: '1d'  },
  };

  function daysAgo(n) {
    const d = new Date();
    d.setDate(d.getDate() - n);
    return d;
  }

  const isUs = market === '美股';
  const yahooSym = !isUs ? symbol + '.TW' : symbol;
  const { period1, interval } = rangeMap[range] || rangeMap['3mo'];

  try {
    const chart = await yahooFinance.chart(yahooSym, {
      period1, interval,
    }, { validateResult: false });

    const quotes = chart?.quotes ?? [];
    if (!quotes.length) throw new Error('No data returned');

    const candles = quotes
      .filter(q => q.close != null)
      .map(q => ({
        time:   Math.floor(new Date(q.date).getTime() / 1000),
        open:   Math.round((q.open  ?? q.close) * 100) / 100,
        high:   Math.round((q.high  ?? q.close) * 100) / 100,
        low:    Math.round((q.low   ?? q.close) * 100) / 100,
        close:  Math.round(q.close * 100) / 100,
        volume: q.volume ?? 0,
      }));

    const closes = candles.map(c => c.close);

    // Moving averages
    function maLine(period) {
      return candles.map((c, i) => {
        if (i < period - 1) return null;
        const avg = closes.slice(i - period + 1, i + 1).reduce((a, b) => a + b, 0) / period;
        return { time: c.time, value: Math.round(avg * 100) / 100 };
      }).filter(Boolean);
    }

    // Bollinger Bands
    const bbPeriod = 20;
    const bbUpper = [], bbMid = [], bbLower = [];
    for (let i = bbPeriod - 1; i < closes.length; i++) {
      const slice = closes.slice(i - bbPeriod + 1, i + 1);
      const mean  = slice.reduce((a, b) => a + b, 0) / bbPeriod;
      const std   = Math.sqrt(slice.reduce((a, b) => a + (b - mean) ** 2, 0) / bbPeriod);
      const t = candles[i].time;
      bbUpper.push({ time: t, value: Math.round((mean + 2 * std) * 100) / 100 });
      bbMid.push(  { time: t, value: Math.round(mean * 100) / 100 });
      bbLower.push({ time: t, value: Math.round((mean - 2 * std) * 100) / 100 });
    }

    // RSI
    function rsi(period = 14) {
      if (closes.length < period + 1) return null;
      const deltas = closes.slice(1).map((c, i) => c - closes[i]);
      const gains  = deltas.map(d => d > 0 ? d : 0);
      const losses = deltas.map(d => d < 0 ? -d : 0);
      const ag = gains.slice(-period).reduce((a, b) => a + b, 0) / period;
      const al = losses.slice(-period).reduce((a, b) => a + b, 0) / period;
      if (al === 0) return 100;
      return Math.round(100 - 100 / (1 + ag / al));
    }

    const latestClose  = closes[closes.length - 1];
    const latestUpper  = bbUpper[bbUpper.length - 1]?.value;
    const latestMid    = bbMid[bbMid.length - 1]?.value;
    const latestLower  = bbLower[bbLower.length - 1]?.value;
    const latestRsi    = rsi();

    let zoneNote = '';
    if (latestRsi != null) {
      if (latestRsi < 30)      zoneNote = `RSI ${latestRsi}，超賣區間，偏向買入機會`;
      else if (latestRsi > 70) zoneNote = `RSI ${latestRsi}，超買區間，注意回檔風險`;
      else                     zoneNote = `RSI ${latestRsi}，目前在正常範圍`;
    }

    res.status(200).json({
      symbol,
      candles,
      maLines: {
        ma5:  maLine(5),
        ma20: maLine(20),
        ma60: maLine(60),
      },
      bbLines: { upper: bbUpper, mid: bbMid, lower: bbLower },
      buyZone:  latestLower && latestMid  ? { min: latestLower, max: latestMid  } : null,
      sellZone: latestMid  && latestUpper ? { min: latestMid,  max: latestUpper } : null,
      latestRsi,
      zoneNote,
      currentPrice: latestClose,
    });

  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
