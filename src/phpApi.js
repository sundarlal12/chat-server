/**
 * Thin client for the one thing this service still needs from the PHP API:
 * the caller's display name/profile pic (for message sender/receiver docs).
 * Not persisted anywhere here - just a short-lived in-memory cache per
 * token so a burst of messages from the same session doesn't hit PHP
 * every time. Uses the exact same bearer token the client already
 * connected with (chatPanelTokens IS tokens, by explicit operator
 * decision - see auth_tokens_bundle() in the PHP repo), so no separate
 * credential is needed.
 */
const BASE_URL = process.env.PHP_API_BASE_URL || 'https://papa777.sbs';
const CACHE_TTL_MS = 5 * 60 * 1000;
const cache = new Map(); // token -> { user, expiresAt }

async function getUserInfo(token) {
  const cached = cache.get(token);
  if (cached && cached.expiresAt > Date.now()) { return cached.user; }

  const res = await fetch(`${BASE_URL}/v1/api/get-user-data`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) { return null; }
  const body = await res.json();
  const result = body && body.result;
  if (!result || !result._id) { return null; }

  const user = {
    oid: String(result._id),
    name: String(result.userName || ''),
    firstName: String(result.firstName || ''),
    lastName: String(result.lastName || ''),
    profilePic: String(result.profilePic || ''),
    isBanned: !!result.isBanned,
  };
  cache.set(token, { user, expiresAt: Date.now() + CACHE_TTL_MS });
  return user;
}

module.exports = { getUserInfo };
