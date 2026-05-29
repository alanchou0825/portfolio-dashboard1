export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { url, action, holdings, sheetName = 'holdings' } = req.body;
  if (!url || !action) return res.status(400).json({ error: 'MISSING PARAMS' });

  // Validate URL to prevent SSRF: only allow HTTPS requests to script.google.com
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return res.status(400).json({ error: 'INVALID URL' });
  }
  if (parsed.protocol !== 'https:' || !parsed.hostname.toLowerCase().endsWith('.google.com')) {
    return res.status(400).json({ error: 'URL NOT ALLOWED' });
  }

  try {
    if (action === 'backup') {
      if (!Array.isArray(holdings) || !holdings.length) return res.status(400).json({ error: 'EMPTY HOLDINGS' });
      const r = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ holdings, sheet: sheetName }),
        redirect: 'manual'
      });
      if (r.status >= 300 && r.status < 400) return res.status(502).json({ error: 'REDIRECT NOT ALLOWED' });
      const d = await r.json();
      return res.status(200).json(d);
    }
    if (action === 'restore') {
      const r = await fetch(`${url}?sheet=${encodeURIComponent(sheetName)}`, { redirect: 'manual' });
      if (r.status >= 300 && r.status < 400) return res.status(502).json({ error: 'REDIRECT NOT ALLOWED' });
      const d = await r.json();
      return res.status(200).json(d);
    }
    return res.status(400).json({ error: 'UNKNOWN ACTION' });
  } catch {
    return res.status(500).json({ error: 'FETCH FAILED' });
  }
}
