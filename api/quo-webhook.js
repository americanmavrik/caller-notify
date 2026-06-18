const { createClient } = require('@vercel/kv');

const kv = createClient({
  url: process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN,
});

const QUO_API_KEY = process.env.QUO_API_KEY;
const QUO_API_BASE = 'https://api.openphone.com/v1';

async function getContactNameByPhone(phone) {
  try {
    const url = `${QUO_API_BASE}/contacts?phoneNumbers[]=${encodeURIComponent(phone)}&maxResults=1`;
    const res = await fetch(url, { headers: { Authorization: QUO_API_KEY } });
    if (!res.ok) return null;
    const data = await res.json();
    const contact = data.data?.[0];
    if (!contact) return null;
    const fields = contact.defaultFields;
    const name = [fields.firstName, fields.lastName].filter(Boolean).join(' ');
    return name || null;
  } catch (e) {
    return null;
  }
}

async function getContactNameById(contactId) {
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

  let clientName = 'Unknown Caller';
  if (QUO_API_KEY) {
    if (call.contactIds?.length > 0) {
      clientName = (await getContactNameById(call.contactIds[0])) || clientName;
    }
    if (clientName === 'Unknown Caller' && phone !== 'Unknown number') {
      clientName = (await getContactNameByPhone(phone)) || clientName;
    }
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
