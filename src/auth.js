const jwt = require('jsonwebtoken');
const { dbOne } = require('./db');

/**
 * Verifies a token the exact same way PHP's auth_user()/chat_auth_user()
 * do: HS256, type claim must be 'access', subject must be a real,
 * non-blocked users.oid. By explicit operator decision chatPanelTokens
 * reuses the same token as the main app (see auth_tokens_bundle() in
 * api/v1/_helpers.php), so there's only ONE scheme to check here, not a
 * separate chat-panel-only token family.
 */
async function verifyToken(token) {
  if (!token) { return null; }
  let claims;
  try {
    claims = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ['HS256'] });
  } catch {
    return null;
  }
  if (claims.type !== 'access') { return null; }

  const user = await dbOne('SELECT * FROM users WHERE oid = :oid LIMIT 1', { oid: String(claims.sub) });
  if (!user) { return null; }
  if (user.active !== undefined && String(user.active) === '0') { return null; }
  return user;
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
