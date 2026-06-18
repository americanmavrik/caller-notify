const { createClient } = require('@vercel/kv');

const kv = createClient({
  url: process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN,
});

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { type, data } = req.body;

  // Only handle incoming ringing calls
  if (type !== 'call.ringing') {
    return res.status(200).json({ ok: true, skipped: true });
  }

  const call = data?.object;
  if (!call || call.direction !== 'incoming') {
    return res.status(200).json({ ok: true, skipped: true });
  }

  // First participant is the external caller
  const phone = call.participants?.[0] || 'Unknown number';

  const payload = {
    clientName: 'Incoming Call',
    phone,
    notes: '',
    jobberUrl: null,
    timestamp: Date.now(),
    seen: false,
  };

  await kv.set('latest_call', payload, { ex: 300 });

  return res.status(200).json({ ok: true });
};
