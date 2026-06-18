const { createClient } = require('@vercel/kv');

const kv = createClient({
  url: process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN,
});

const JOBBER_AUTH_URL = 'https://api.getjobber.com/api/oauth/authorize';
const JOBBER_TOKEN_URL = 'https://api.getjobber.com/api/oauth/token';
const REDIRECT_URI = 'https://caller-notify.vercel.app/api/jobber-auth';

module.exports = async function handler(req, res) {
  const clientId = process.env.JOBBER_CLIENT_ID;
  const clientSecret = process.env.JOBBER_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    return res.status(500).send('JOBBER_CLIENT_ID and JOBBER_CLIENT_SECRET env vars are not set.');
  }

  const { code } = req.query;

  // Step 1: No code yet — redirect to Jobber to authorize
  if (!code) {
    const authUrl = new URL(JOBBER_AUTH_URL);
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('client_id', clientId);
    authUrl.searchParams.set('redirect_uri', REDIRECT_URI);
    return res.redirect(302, authUrl.toString());
  }

  // Step 2: Exchange code for tokens
  const tokenRes = await fetch(JOBBER_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: clientId,
      client_secret: clientSecret,
      code,
      redirect_uri: REDIRECT_URI,
    }),
  });

  if (!tokenRes.ok) {
    const err = await tokenRes.text();
    return res.status(500).send('Failed to exchange code: ' + err);
  }

  const data = await tokenRes.json();

  await Promise.all([
    kv.set('jobber_access_token', data.access_token),
    kv.set('jobber_refresh_token', data.refresh_token),
    kv.set('jobber_token_expires', Date.now() + (data.expires_in || 3600) * 1000),
  ]);

  return res.status(200).send(`
    <html><body style="font-family:sans-serif;padding:40px;background:#0f0f0f;color:#fff">
      <h2 style="color:#2ecc71">Jobber connected!</h2>
      <p>Caller Notify will now look up clients in Jobber when calls come in.</p>
      <p style="color:#888;margin-top:20px">You can close this tab.</p>
    </body></html>
  `);
};
