const { createClient } = require('@vercel/kv');

const kv = createClient({
  url: process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN,
});

const QUO_API_KEY = process.env.QUO_API_KEY;
const QUO_API_BASE = 'https://api.openphone.com/v1';

async function findContactByPhone(phone) {
  try {
    let pageToken = null;
    let pages = 0;
    do {
      const url = new URL(`${QUO_API_BASE}/contacts`);
      url.searchParams.set('maxResults', '50');
      if (pageToken) url.searchParams.set('pageToken', pageToken);

      const res = await fetch(url.toString(), { headers: { Authorization: QUO_API_KEY } });
      if (!res.ok) break;
      const data = await res.json();

      for (const contact of data.data || []) {
        const phones = contact.defaultFields?.phoneNumbers || [];
        if (phones.some(p => p.value === phone)) {
          const { firstName, lastName } = contact.defaultFields;
          return [firstName, lastName].filter(Boolean).join(' ') || null;
        }
      }

      pageToken = data.nextPageToken;
      pages++;
    } while (pageToken && pages < 20);

    return null;
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
  await kv.set('debug_payload', req.body, { ex: 600 });
  if (!call || call.direction !== 'incoming') {
    return res.status(200).json({ ok: true, skipped: true });
  }

  const phone = call.from || 'Unknown number';

  let clientName = 'Unknown Caller';
  if (QUO_API_KEY && phone !== 'Unknown number') {
    clientName = (await findContactByPhone(phone)) || 'Unknown Caller';
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
