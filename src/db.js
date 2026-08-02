const mysql = require('mysql2/promise');

/**
 * Accepts either a full connection URL (Railway injects one as MYSQL_URL/
 * MYSQL_PUBLIC_URL/DATABASE_URL when you add its MySQL plugin) or discrete
 * DB_HOST/DB_PORT/DB_USER/DB_PASSWORD/DB_NAME vars, so whichever form
 * Railway (or any other host) provides works without code changes.
 */
// Every DATETIME this service writes (mysqlNow(), migrate.js's seed data)
// is deliberately UTC, stored as a timezone-naive string. Without
// `timezone: 'Z'`, mysql2 converts those naive values back to JS Date
// objects using the driver's assumed local timezone instead of UTC -
// confirmed this the hard way locally (a stored 07:02:17 came back as
// 01:32:17, a 5.5h/IST-sized shift) - so every timestamp in every
// response would silently drift depending on what timezone the process
// happens to run in.
function poolConfig() {
  const url = process.env.MYSQL_URL || process.env.MYSQL_PUBLIC_URL || process.env.DATABASE_URL;
  if (url) {
    return { uri: url, waitForConnections: true, connectionLimit: 10, namedPlaceholders: true, timezone: 'Z' };
  }
  return {
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    waitForConnections: true,
    connectionLimit: 10,
    namedPlaceholders: true,
    timezone: 'Z',
  };
}

// mysql2 accepts a config object with a `uri` key (merged with the other
// options, e.g. namedPlaceholders) - passing just the bare URI string here
// would silently drop namedPlaceholders, breaking every :named query.
const pool = mysql.createPool(poolConfig());

async function dbOne(sql, params = {}) {
  const [rows] = await pool.execute(sql, params);
  return rows.length ? rows[0] : null;
}

async function dbAll(sql, params = {}) {
  const [rows] = await pool.execute(sql, params);
  return rows;
}

async function dbExec(sql, params = {}) {
  const [result] = await pool.execute(sql, params);
  return result.affectedRows;
}

module.exports = { pool, dbOne, dbAll, dbExec };
