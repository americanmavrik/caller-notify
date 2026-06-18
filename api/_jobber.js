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

// O(1) lookup — cache is built by /api/jobber-sync (run once, then nightly via cron)
async function findClientByPhone(phone) {
  try {
    const digits = normalizeDigits(phone);
    if (digits.length < 7) return null;
    return await kv.get(`jc:${digits}`);
  } catch {
    return null;
  }
}

module.exports = { getAccessToken, findClientByPhone };
