const { createClient } = require('@vercel/kv');

const kv = createClient({
  url: process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN,
});

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method === 'POST' && req.query.action === 'seen') {
    const raw = await kv.get('latest_call');
    if (raw) {
      const payload = JSON.parse(raw);
      payload.seen = true;
      await kv.set('latest_call', JSON.stringify(payload), { ex: 300 });
    }
    return res.status(200).json({ ok: true });
  }

  if (req.method === 'GET') {
    const raw = await kv.get('latest_call');

    if (!raw) {
      return res.status(200).json({ hasCall: false });
    }

    const payload = JSON.parse(raw);

    if (payload.seen) {
      return res.status(200).json({ hasCall: false });
    }

    const ageMs = Date.now() - payload.timestamp;
    if (ageMs > 120000) {
      return res.status(200).json({ hasCall: false });
    }

    return res.status(200).json({ hasCall: true, call: payload });
  }

  return res.status(405).json({ error: 'Method not allowed' });
};
