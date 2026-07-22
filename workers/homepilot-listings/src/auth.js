// homepilot-listings — auth module
// Handles CREA/DDF OAuth token acquisition. Extracted from the single-file
// index.js during the 2026-07-21 module split (Phase 2 for this Worker,
// mirroring the main app's src/ structure).

export const TOKEN_URL = "https://identity.crea.ca/connect/token";

export async function getAccessToken(env) {
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: env.DDF_CLIENT_ID,
    client_secret: env.DDF_CLIENT_SECRET,
    scope: "DDFApi_Read",
  });
  const resp = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  const data = await resp.json();
  if (!resp.ok) throw new Error(`Token failed (${resp.status}): ${JSON.stringify(data)}`);
  return data.access_token;
}
