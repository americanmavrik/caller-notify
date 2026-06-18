const { createClient } = require('@vercel/kv');
const { getAccessToken } = require('./_jobber');

const kv = createClient({
  url: process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN,
});

const JOBBER_GRAPHQL_URL = 'https://api.getjobber.com/api/graphql';
const JOBBER_API_VERSION = '2025-04-16';

function normalizeDigits(phone) {
  const digits = phone.replace(/\D/g, '');
  return digits.length === 11 && digits[0] === '1' ? digits.slice(1) : digits;
}

module.exports = async function handler(req, res) {
  const manualAuth = req.headers['x-notify-secret'] === process.env.NOTIFY_SECRET
    || req.query.secret === process.env.NOTIFY_SECRET;
  const cronAuth = req.headers['authorization'] === `Bearer ${process.env.CRON_SECRET}`;
  if (!manualAuth && !cronAuth) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const accessToken = await getAccessToken();
  if (!accessToken) {
    return res.status(500).json({ error: 'No Jobber access token — re-authorize at /api/jobber-auth' });
  }

  const query = `
    query ListClients($after: String) {
      clients(first: 50, after: $after) {
        nodes {
          name
          companyName
          jobberWebUri
          phones { number }
          notes { nodes { message } }
        }
        pageInfo { hasNextPage endCursor }
      }
    }
  `;

  let after = null;
  let pages = 0;
  let cached = 0;
  const pipeline = [];

  do {
    const gqlRes = await fetch(JOBBER_GRAPHQL_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken}`,
        'X-JOBBER-GRAPHQL-VERSION': JOBBER_API_VERSION,
      },
      body: JSON.stringify({ query, variables: { after } }),
    });

    if (!gqlRes.ok) break;
    const { data, errors } = await gqlRes.json();
    if (errors?.length || !data) break;

    const { nodes, pageInfo } = data.clients;

    for (const client of nodes) {
      const phones = client.phones || [];
      const notes = (client.notes?.nodes || []).map(n => n.message).filter(Boolean);
      const entry = {
        name: client.name || client.companyName || 'Unknown',
        notes: notes[0] || '',
        jobberUrl: client.jobberWebUri || null,
      };

      for (const p of phones) {
        const digits = normalizeDigits(p.number);
        if (digits.length >= 7) {
          // Store with 7-day expiry; jobber-sync should run at least weekly
          pipeline.push(kv.set(`jc:${digits}`, entry, { ex: 7 * 24 * 3600 }));
          cached++;
        }
      }
    }

    after = pageInfo.hasNextPage ? pageInfo.endCursor : null;
    pages++;
  } while (after && pages < 25);

  await Promise.all(pipeline);

  return res.status(200).json({ ok: true, pages, cached });
};
