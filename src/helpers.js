const crypto = require('crypto');

/**
 * Mongo-ObjectId-style 24-hex-char id, matching PHP's new_object_id()
 * exactly (bin2hex(pack('N', time()) . random_bytes(8))) - a 4-byte
 * big-endian unix timestamp followed by 8 random bytes. Every id in this
 * schema (users, tickets, messages, topics) uses this format, so new ids
 * minted here have to match it too.
 */
function newObjectId() {
  const ts = Buffer.alloc(4);
  ts.writeUInt32BE(Math.floor(Date.now() / 1000), 0);
  return Buffer.concat([ts, crypto.randomBytes(8)]).toString('hex');
}

function isObjectId(v) {
  return typeof v === 'string' && /^[0-9a-f]{24}$/i.test(v);
}

/** ISO-8601 with milliseconds, matching PHP's iso() - Date#toISOString() is already this exact format. */
function iso(mysqlDatetimeOrDate) {
  if (!mysqlDatetimeOrDate) { return new Date().toISOString(); }
  if (mysqlDatetimeOrDate instanceof Date) { return mysqlDatetimeOrDate.toISOString(); }
  // mysql2 returns DATETIME columns as JS Date objects already when dateStrings is off (default),
  // but guard the string case too (e.g. a manually formatted 'YYYY-MM-DD HH:MM:SS').
  const d = new Date(String(mysqlDatetimeOrDate).replace(' ', 'T') + 'Z');
  return isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
}

/** MySQL DATETIME string for "now", matching PHP's date('Y-m-d H:i:s'). */
function mysqlNow() {
  return new Date().toISOString().slice(0, 19).replace('T', ' ');
}

/** mention_ids is stored as a JSON text column - parse it back into an array. */
function parseMentionIds(raw) {
  if (Array.isArray(raw)) { return raw; }
  if (typeof raw !== 'string' || raw === '') { return []; }
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

module.exports = { newObjectId, isObjectId, iso, mysqlNow, parseMentionIds };
