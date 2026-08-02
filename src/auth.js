const { getUserInfo } = require('./phpApi');

/**
 * With no local database, this service has no way to independently verify
 * a JWT's subject is a real, non-banned user - so rather than re-implement
 * (and risk drifting from) PHP's auth_user() logic, this delegates
 * entirely to it: calling GET /v1/api/get-user-data with the caller's
 * bearer token. PHP already does the HS256/type='access'/banned-user
 * checks there (see auth_user() in api/_bootstrap.php) and this service
 * reuses that token unchanged (chatPanelTokens IS tokens, by explicit
 * operator decision - see auth_tokens_bundle()), so a 401/403 from PHP
 * here means exactly what it would mean on the main API. Results are
 * cached briefly (see phpApi.js) so a burst of messages/socket events
 * from one session doesn't hit PHP on every single one.
 */
async function verifyToken(token) {
  if (!token) { return null; }
  return getUserInfo(token);
}

/**
 * Express middleware - sets req.chatUser or responds 401, mirrors
 * chat_auth_user(). Wrapped in try/catch itself (not just via asyncRoute
 * on the route handler) because middleware runs before the route handler -
 * an unhandled DB error here would crash the process before asyncRoute
 * ever gets a chance to catch anything.
 */
function requireAuth() {
  return async (req, res, next) => {
    try {
      const header = req.headers.authorization || '';
      const token = header.startsWith('Bearer ') ? header.slice(7) : null;
      const user = await verifyToken(token);
      if (!user) { return res.status(401).json({ code: 401, message: 'Please authenticate' }); }
      req.chatUser = user;
      next();
    } catch (e) {
      next(e);
    }
  };
}

module.exports = { verifyToken, requireAuth };
