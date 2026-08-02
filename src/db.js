const mysql = require('mysql2/promise');

const pool = mysql.createPool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 10,
  namedPlaceholders: true,
});

/** One row or null - mirrors PHP's db_one(). */
async function dbOne(sql, params = {}) {
  const [rows] = await pool.execute(sql, params);
  return rows.length ? rows[0] : null;
}

/** All rows - mirrors PHP's db_all(). */
async function dbAll(sql, params = {}) {
  const [rows] = await pool.execute(sql, params);
  return rows;
}

/** INSERT/UPDATE/DELETE - returns affectedRows, mirrors PHP's db_exec(). */
async function dbExec(sql, params = {}) {
  const [result] = await pool.execute(sql, params);
  return result.affectedRows;
}

module.exports = { pool, dbOne, dbAll, dbExec };
