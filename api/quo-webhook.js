const { createClient } = require('@vercel/kv');

const kv = createClient({
  url: process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN,
});

const QUO_API_KEY = process.env.QUO_API_KEY;
const QUO_API_BASE = 'https://api.openphone.com/v1';

async function getContactName(contactId) {
  try {
    const res = await fetch(`${QUO_API_BASE}/contacts/${contactId}`, {
      headers: { Authorization: QUO_API_KEY },
    });
    if (!res.ok) return null;
    const data = await res.json();
    const fields = data.data?.defaultFields;
    if (!fields) return null;
    const name = [fields.firstName, fields.lastName].filter(Boolean).join(' ');
    return name || null;
  } catch (e) {
    return null;
  }
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { type, data } = req.body;

  if (type !== 'call.ringing') {
    return res.status(200).json({ ok: true, skipped: true });
  }

  const call = data?.object;
  if (!call || call.direction !== 'incoming') {
    return res.status(200).json({ ok: true, skipped: true });
  }

  const phone = call.participants?.[0] || 'Unknown number';
  console.log('quo-webhook call:', JSON.stringify({ phone, contactIds: call.contactIds, participants: call.participants }));

  let clientName = 'Unknown Caller';
  if (QUO_API_KEY && call.contactIds?.length > 0) {
    const name = await getContactName(call.contactIds[0]);
    console.log('contact lookup result:', name);
    if (name) clientName = name;
  } else {
    console.log('no contactIds or no API key, QUO_API_KEY set:', !!QUO_API_KEY);
  }

  const payload = {
    clientName,
    phone,
    notes: '',
    jobberUrl: null,
    timestamp: Date.now(),
    seen: false,
  };

  await kv.set('latest_call', payload, { ex: 300 });

  return res.status(200).json({ ok: true });
};
