const whatsapp = require('./whatsapp');

const BASE_URL = process.env.PHP_API_BASE_URL || 'https://papa777.sbs';
const CHECK_INTERVAL_MS = 2 * 60 * 1000;
const FAILURE_THRESHOLD = 2;

let consecutiveFailures = 0;
let alertSent = false;

/**
 * A retry inside phpApi.js (see getUserInfo/fetchUserData) absorbs a
 * single transient blip - this is the backstop for the case retries
 * can't fix: a real, sustained outage on PHP's side, which needs a human
 * to act (the "hosting-side block" class of issue this codebase has hit
 * before - see /health/php-check). Runs independently of real user
 * traffic (a plain reachability probe, not a login attempt) so it's
 * caught and alerted on before a customer ever files a complaint, not
 * discovered after. Edge-triggered - exactly one alert when it goes
 * down, one when it recovers - so a prolonged outage doesn't spam the
 * admin's WhatsApp every 2 minutes for however long it lasts.
 */
async function checkOnce() {
  try {
    const res = await fetch(`${BASE_URL}/v1/api/get-user-data`, {
      headers: { Authorization: 'Bearer health-monitor-probe' },
      signal: AbortSignal.timeout(8000),
    });
    // Any HTTP response at all (even a 401 for this deliberately-invalid
    // token) proves the network path itself is fine - only a thrown
    // exception (DNS/timeout/connection failure) means PHP is actually
    // unreachable.
    void res;
    if (alertSent) {
      await whatsapp.notifyAdminWhatsApp(
        `PHP API (${BASE_URL}) is reachable again from this server. Chat login/auth is back to normal.`
      );
    }
    consecutiveFailures = 0;
    alertSent = false;
  } catch (e) {
    consecutiveFailures += 1;
    console.error(`PHP health check failed (${consecutiveFailures}/${FAILURE_THRESHOLD}):`, e.message);
    if (consecutiveFailures >= FAILURE_THRESHOLD && !alertSent) {
      alertSent = true;
      await whatsapp.notifyAdminWhatsApp(
        `WARNING: PHP API (${BASE_URL}) is unreachable from this server (${e.message}). Customers may see "Please authenticate" errors even when logged in. This usually needs the hosting side checked - see /health/php-check for details.`
      );
    }
  }
}

/** Started once from server.js alongside whatsapp.start() - not awaited, runs forever in the background. */
function start() {
  setInterval(checkOnce, CHECK_INTERVAL_MS);
}

module.exports = { start };
