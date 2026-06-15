const { createClient } = require('@vercel/kv');

const kv = createClient({
  url: process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN,
});

const SHARED_SECRET = process.env.NOTIFY_SECRET;

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers['x-notify-secret'];
  if (!SHARED_SECRET || authHeader !== SHARED_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { clientName, phone, notes, jobberUrl } = req.body;

  if (!phone) {
    return res.status(400).json({ error: 'phone is required' });
  }

  const payload = {
    clientName: clientName || 'Unknown Caller',
    phone,
    notes: notes || '',
    jobberUrl: jobberUrl || null,
    timestamp: Date.now(),
    seen: false,
  };

  await kv.set('latest_call', JSON.stringify(payload), { ex: 300 });

  return res.status(200).json({ ok: true });
};
