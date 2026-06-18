const { createClient } = require('@vercel/kv');

const kv = createClient({
  url: process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN,
});

const JOBBER_TOKEN_URL = 'https://api.getjobber.com/api/oauth/token';
const JOBBER_GRAPHQL_URL = 'https://api.getjobber.com/api/graphql';
const JOBBER_API_VERSION = '2025-04-16';

async function getAccessToken() {
  const [token, expiresAt, refreshToken] = await Promise.all([
    kv.get('jobber_access_token'),
    kv.get('jobber_token_expires'),
    kv.get('jobber_refresh_token'),
  ]);

  if (token && expiresAt && Date.now() < Number(expiresAt) - 60000) {
    return token;
  }

  if (!refreshToken) return null;

  const res = await fetch(JOBBER_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: process.env.JOBBER_CLIENT_ID,
      client_secret: process.env.JOBBER_CLIENT_SECRET,
      refresh_token: refreshToken,
    }),
  });

  if (!res.ok) return null;
  const data = await res.json();

  await Promise.all([
    kv.set('jobber_access_token', data.access_token),
    kv.set('jobber_refresh_token', data.refresh_token || refreshToken),
    kv.set('jobber_token_expires', Date.now() + (data.expires_in || 3600) * 1000),
  ]);

  return data.access_token;
}

function normalizeDigits(phone) {
  const digits = phone.replace(/\D/g, '');
  return digits.length === 11 && digits[0] === '1' ? digits.slice(1) : digits;
}

async function gqlRequest(accessToken, query, variables) {
  const res = await fetch(JOBBER_GRAPHQL_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${accessToken}`,
      'X-JOBBER-GRAPHQL-VERSION': JOBBER_API_VERSION,
    },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) return null;
  const json = await res.json();
  if (json.errors?.length) return null;
  return json.data;
}

// ClientFilterAttributes has no phone/text search — paginate all clients and match locally.
// For a small business this is typically 1–5 pages (50/page).
async function findClientByPhone(phone) {
  try {
    const accessToken = await getAccessToken();
    if (!accessToken) return null;

    const digits = normalizeDigits(phone);
    if (digits.length < 7) return null;

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

    do {
      const data = await gqlRequest(accessToken, query, { after });
      if (!data) break;

      const { nodes, pageInfo } = data.clients;

      for (const client of nodes) {
        const phones = client.phones || [];
        const matches = phones.some(p => normalizeDigits(p.number) === digits);
        if (!matches) continue;

        const notes = (client.notes?.nodes || []).map(n => n.message).filter(Boolean);
        return {
          name: client.name || client.companyName || null,
          notes: notes[0] || '',
          jobberUrl: client.jobberWebUri || null,
        };
      }

      after = pageInfo.hasNextPage ? pageInfo.endCursor : null;
      pages++;
    } while (after && pages < 20);

    return null;
  } catch {
    return null;
  }
}

module.exports = { getAccessToken, findClientByPhone };
