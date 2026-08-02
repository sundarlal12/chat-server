const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { dbOne } = require('./db');

/**
 * Admin auth is deliberately separate from the customer-side auth (which
 * delegates entirely to PHP) - admins/agents aren't app users, they log in
 * with a username/password stored in this service's own chat_admins
 * table. Password hashing uses Node's built-in scrypt (no extra
 * dependency) rather than bcrypt.
 */
const ADMIN_JWT_SECRET = process.env.ADMIN_JWT_SECRET || crypto.randomBytes(32).toString('hex');
if (!process.env.ADMIN_JWT_SECRET) {
  console.warn('ADMIN_JWT_SECRET not set - using a random secret for this process only, admin sessions will not survive a restart. Set ADMIN_JWT_SECRET in production.');
}
const ADMIN_TOKEN_TTL_SECONDS = 12 * 60 * 60; // 12h

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  const [salt, hash] = String(stored || '').split(':');
  if (!salt || !hash) { return false; }
  const check = crypto.scryptSync(password, salt, 64).toString('hex');
  const a = Buffer.from(hash, 'hex');
  const b = Buffer.from(check, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function issueAdminToken(admin) {
  return jwt.sign(
    { sub: admin.oid, username: admin.username, type: 'admin_access' },
    ADMIN_JWT_SECRET,
    { expiresIn: ADMIN_TOKEN_TTL_SECONDS }
  );
}

async function verifyAdminToken(token) {
  if (!token) { return null; }
  let claims;
  try {
    claims = jwt.verify(token, ADMIN_JWT_SECRET, { algorithms: ['HS256'] });
  } catch {
    return null;
  }
  if (claims.type !== 'admin_access') { return null; }
  return dbOne('SELECT * FROM chat_admins WHERE oid = :o LIMIT 1', { o: String(claims.sub) });
}

function requireAdminAuth() {
  return async (req, res, next) => {
    try {
      const header = req.headers.authorization || '';
      const token = header.startsWith('Bearer ') ? header.slice(7) : null;
      const admin = await verifyAdminToken(token);
      if (!admin) { return res.status(401).json({ code: 401, message: 'Please log in' }); }
      req.admin = admin;
      next();
    } catch (e) {
      next(e);
    }
  };
}

module.exports = { hashPassword, verifyPassword, issueAdminToken, verifyAdminToken, requireAdminAuth };
