// api/bot-status.js
// 讀取交易機器人的 Google Sheets 數據

export const config = { maxDuration: 30 };

const SHEET_ID = '1SpyA2-RyfVerzL8eqljq66LuiBnxiiFZ-fr6Ms0Yc7M';

async function getGoogleToken() {
  const credentials = JSON.parse(process.env.GOOGLE_CREDENTIALS || '{}');
  if (!credentials.client_email) throw new Error('GOOGLE_CREDENTIALS 未設定');

  const header = { alg: 'RS256', typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);
  const claim = {
    iss: credentials.client_email,
    scope: 'https://www.googleapis.com/auth/spreadsheets.readonly',
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600,
    iat: now,
  };

  // Build JWT
  const enc = (obj) => btoa(JSON.stringify(obj)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  const signingInput = `${enc(header)}.${enc(claim)}`;

  // Import private key
  const pemKey = credentials.private_key.replace(/\\n/g, '\n');
  const keyData = pemKey.replace(/-----BEGIN PRIVATE KEY-----/, '').replace(/-----END PRIVATE KEY-----/, '').replace(/\n/g, '');
  const binaryKey = Uint8Array.from(atob(keyData), c => c.charCodeAt(0));

  const cryptoKey = await crypto.subtle.importKey(
    'pkcs8', binaryKey.buffer,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false, ['sign']
  );

  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5', cryptoKey,
    new TextEncoder().encode(signingInput)
  );

  const sigB64 = btoa(String.fromCharCode(...new Uint8Array(signature)))
    .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');

  const jwt = `${signingInput}.${sigB64}`;

  // Exchange JWT for access token
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`,
  });

  const tokenData = await tokenRes.json();
  return tokenData.access_token;
}

async function readSheet(token, sheetName) {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent(sheetName)}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return [];
  const data = await res.json();
  const rows = data.values || [];
  if (rows.length < 2) return [];

  const headers = rows[0];
  return rows.slice(1).map(row =>
    Object.fromEntries(headers.map((h, i) => [h, row[i] ?? '']))
  );
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate');

  try {
    const token = await getGoogleToken();

    const [positions, trades, summary, analysis] = await Promise.all([
      readSheet(token, '持倉狀況'),
      readSheet(token, '下單記錄'),
      readSheet(token, '績效摘要'),
      readSheet(token, 'AI分析'),
    ]);

    res.status(200).json({
      positions,
      trades:   trades.slice(-20).reverse(),    // 最近 20 筆
      summary:  summary.slice(-30),             // 最近 30 筆績效
      analysis: analysis.slice(-5).reverse(),   // 最近 5 筆 AI 分析
      updatedAt: new Date().toISOString(),
    });

  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
