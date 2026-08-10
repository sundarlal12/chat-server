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
// How much longer, past the normal 5-minute TTL, a session that was
// genuinely verified once is still trusted IF PHP is unreachable when it's
// time to refresh (see the catch block in getUserInfo below) - not "how
// long a session lasts", just how much slack a real, already-seen user gets
// during exactly the transient-outage window phpHealthMonitor.js exists to
// catch. Chosen to comfortably cover "user opens camera app, takes a photo,
// comes back" (the file-upload path this was written for - see
// routes/attachments.js), not to extend session lifetime in general.
const STALE_GRACE_MS = 30 * 60 * 1000;
const cache = new Map(); // token -> { user, expiresAt, cachedAt }

const FETCH_TIMEOUT_MS = 5000;
const MAX_ATTEMPTS = 3;
const RETRY_BACKOFF_MS = 500;

// Circuit breaker across ALL callers, not per-token - confirmed live: when
// Hostinger's hosting-side firewall blocked this deployment's egress IP
// and was asked why, they named "rapid WebSocket reconnect loops" and
// "bursts of requests" as exactly the trigger pattern to avoid. Once PHP is
// confirmed down, every caller fails immediately (no network call at all)
// for this cooldown window instead of running its own retries - a
// mass-reconnect (e.g. right after this service itself restarts) then
// costs a small, bounded number of requests total instead of scaling with
// how many clients happen to reconnect at once.
const CIRCUIT_COOLDOWN_MS = 20 * 1000;
let circuitOpenUntil = 0;
let circuitOpenError = null;
// True while ONE caller's retries are actively confirming a suspected
// outage - see the comment in the catch block below for why this matters
// even before circuitOpenUntil is set.
let probing = false;

/**
 * Retries only on a NETWORK-level failure (fetch() itself throwing -
 * DNS/timeout/connection reset), never on a clean HTTP response with a
 * non-2xx status (a real 401 for a bad/expired token should fail
 * immediately, not retry). Confirmed live: papa777.sbs went briefly
 * unreachable from this deployment (ETIMEDOUT) while fully healthy from
 * everywhere else, then self-resolved - DNS round-robins across multiple
 * backend IPs, consistent with one flaky backend rather than a blanket
 * block, which a retry (getting a fresh DNS lookup each attempt) has a
 * real chance of routing around. Shorter 5s-per-attempt timeout (down
 * from the original single 10s) keeps the worst case (3 attempts + two
 * backoffs) bounded at ~16.5s instead of stacking three full 10s waits.
 */
async function fetchUserData(token) {
  if (Date.now() < circuitOpenUntil) {
    throw circuitOpenError || new Error('PHP API unreachable');
  }

  // Every caller still makes its OWN first real request with its OWN
  // token - each caller can only ever return ITS OWN response, never
  // another caller's, so a healthy PHP still serves every token correctly
  // even during a burst. Only the RETRY work below is deduped.
  try {
    const res = await fetch(`${BASE_URL}/v1/api/get-user-data`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    circuitOpenUntil = 0;
    return res;
  } catch (firstErr) {
    // circuitOpenUntil only gets set once a full retry cycle below
    // confirms a real outage - a truly simultaneous burst (many callers'
    // first attempts all failing around the same instant) would otherwise
    // ALL start their own retry loop before any of them finishes. This
    // synchronous flag closes that gap: only the first caller to land here
    // actually retries; everyone else just fails on their own single
    // attempt instead of also spending 2 more rounds each in parallel.
    if (probing) { throw firstErr; }
    probing = true;
    try {
      let lastErr = firstErr;
      for (let attempt = 2; attempt <= MAX_ATTEMPTS; attempt++) {
        await new Promise((r) => setTimeout(r, RETRY_BACKOFF_MS * (attempt - 1)));
        try {
          const res = await fetch(`${BASE_URL}/v1/api/get-user-data`, {
            headers: { Authorization: `Bearer ${token}` },
            signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
          });
          circuitOpenUntil = 0;
          return res;
        } catch (e) { lastErr = e; }
      }
      circuitOpenUntil = Date.now() + CIRCUIT_COOLDOWN_MS;
      circuitOpenError = lastErr;
      throw lastErr;
    } finally {
      probing = false;
    }
  }
}

async function getUserInfo(token) {
  const cached = cache.get(token);
  if (cached && cached.expiresAt > Date.now()) { return cached.user; }

  let res;
  try {
    res = await fetchUserData(token);
  } catch (e) {
    // The retries in fetchUserData already absorb a single blip - this is
    // for the case a customer hits mid-upload: the socket connected (and
    // cached this exact token) MORE than 5 minutes ago - e.g. they left the
    // app to take a camera photo - so this refresh is a routine cache
    // expiry, not a first-time login, right as PHP happens to be in one of
    // the transient-unreachable windows phpHealthMonitor.js alerts on (see
    // its comment, and the 25c41c8 commit that added the retry above). A
    // user who was already verified shouldn't get a hard-failed upload over
    // that - trust the stale record a bit longer instead of throwing.
    // Only a real, clean 401 below (not a network failure) ever evicts the
    // cache entry, so this can't resurrect a genuinely revoked/banned user.
    if (cached && (Date.now() - cached.cachedAt) < CACHE_TTL_MS + STALE_GRACE_MS) {
      console.warn(`PHP unreachable (${e.message}); serving stale cached auth (~${Math.round((Date.now() - cached.cachedAt) / 1000)}s old) instead of failing this request.`);
      return cached.user;
    }
    throw e;
  }

  if (!res.ok) {
    // A clean, non-network response saying "no" (bad/expired/banned token)
    // is authoritative - drop any stale record so the fallback above can
    // never serve a session PHP has actually rejected.
    cache.delete(token);
    return null;
  }
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
    // For push notifications (see src/push.js) - the PHP UserInfo model
    // carries this straight off the users table (build_user_info() in the
    // PHP repo). Cached onto the ticket row (see chatLogic.js) the moment
    // we see it, since an admin-initiated notification has no other way
    // to reach the customer's own current fcmToken - only the customer's
    // own authenticated requests ever see it.
    fcmToken: String(result.fcmToken || ''),
    // For the WhatsApp "customer is waiting" admin alert (see
    // src/whatsapp.js) - build_user_info() in the PHP repo maps this
    // straight off the users.mobile column.
    phoneNumber: String(result.phoneNumber || ''),
    countryCode: String(result.countryCode || ''),
  };
  cache.set(token, { user, expiresAt: Date.now() + CACHE_TTL_MS, cachedAt: Date.now() });
  return user;
}

module.exports = { getUserInfo };
