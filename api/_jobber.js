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

  // Return cached token if still valid (with 60s buffer)
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

// Format 10-digit number as (NXX) NXX-XXXX — the most common US format in business software
function formatPhone(digits10) {
  return `(${digits10.slice(0, 3)}) ${digits10.slice(3, 6)}-${digits10.slice(6)}`;
}

async function findClientByPhone(phone) {
  try {
    const accessToken = await getAccessToken();
    if (!accessToken) return null;

    const digits = normalizeDigits(phone);
    if (digits.length < 7) return null;

    // Search with formatted number first (matches how Jobber typically stores US numbers),
    // then fall back to raw digits in case Jobber stores them unformatted.
    const searchTerms = digits.length === 10
      ? [formatPhone(digits), digits]
      : [digits];

    const query = `
      query FindClient($q: String!) {
        clients(filter: { q: $q }) {
          nodes {
            name
            companyName
            jobberWebUri
            phones { number }
            notes { nodes { message } }
          }
        }
      }
    `;

    for (const q of searchTerms) {
      const res = await fetch(JOBBER_GRAPHQL_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${accessToken}`,
          'X-JOBBER-GRAPHQL-VERSION': JOBBER_API_VERSION,
        },
        body: JSON.stringify({ query, variables: { q } }),
      });

      if (!res.ok) continue;
      const { data, errors } = await res.json();
      if (errors?.length) continue;

      const nodes = data?.clients?.nodes || [];

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
    }

    return null;
  } catch {
    return null;
  }
}

module.exports = { getAccessToken, findClientByPhone };
