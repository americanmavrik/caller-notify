const { createClient } = require('@vercel/kv');

const kv = createClient({
  url: process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN,
});

module.exports = async function handler(req, res) {
  if (req.headers['x-notify-secret'] !== process.env.NOTIFY_SECRET
    && req.query.secret !== process.env.NOTIFY_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const key = req.query.key || 'latest_call';
  const value = await kv.get(key);
  return res.status(200).json({ key, value, now: Date.now() });
};
