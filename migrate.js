require('dotenv').config();
const { pool, dbOne, dbExec } = require('./src/db');

/**
 * Idempotent schema + seed - safe to run on every deploy (called
 * automatically from server.js on startup). Mirrors the field set the
 * in-memory store used (see the old src/store.js in git history) plus a
 * chat_attachments table for file blobs, since attachments are now stored
 * in this DB rather than on the PHP server's filesystem.
 */
async function createTableIfMissing(name, ddl) {
  const [rows] = await pool.query(
    `SELECT COUNT(*) AS n FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
    [name]
  );
  if (rows[0].n > 0) { console.log(`= table ${name} already exists`); return; }
  await pool.query(ddl);
  console.log(`+ created table ${name}`);
}

async function migrate() {
  await createTableIfMissing('chat_topics', `
    CREATE TABLE chat_topics (
      id INT AUTO_INCREMENT PRIMARY KEY,
      oid CHAR(24) NOT NULL,
      name VARCHAR(64) NOT NULL,
      topic_key VARCHAR(32) NOT NULL,
      description VARCHAR(255) NOT NULL DEFAULT '',
      sort_order INT NOT NULL DEFAULT 0,
      created_at DATETIME NOT NULL,
      updated_at DATETIME NOT NULL,
      UNIQUE KEY uq_chat_topics_oid (oid),
      UNIQUE KEY uq_chat_topics_key (topic_key)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  await createTableIfMissing('chat_tickets', `
    CREATE TABLE chat_tickets (
      id INT AUTO_INCREMENT PRIMARY KEY,
      oid CHAR(24) NOT NULL,
      user_oid CHAR(24) NOT NULL,
      topic_oid CHAR(24) NULL,
      subject VARCHAR(255) NOT NULL DEFAULT '',
      description VARCHAR(1000) NOT NULL DEFAULT '',
      status VARCHAR(20) NOT NULL DEFAULT 'open',
      priority VARCHAR(16) NOT NULL DEFAULT 'medium',
      is_ai_handled TINYINT(1) NOT NULL DEFAULT 0,
      recipient_oid CHAR(24) NULL,
      agent_name VARCHAR(120) NOT NULL DEFAULT '',
      agent_full_name VARCHAR(120) NOT NULL DEFAULT '',
      agent_profile_pic VARCHAR(512) NOT NULL DEFAULT '',
      rating TINYINT NULL,
      feedback VARCHAR(1000) NULL,
      last_activity DATETIME NULL,
      last_customer_message DATETIME NULL,
      resolved_at DATETIME NULL,
      created_at DATETIME NOT NULL,
      updated_at DATETIME NOT NULL,
      UNIQUE KEY uq_chat_tickets_oid (oid),
      KEY idx_chat_tickets_user (user_oid, created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  await createTableIfMissing('chat_messages', `
    CREATE TABLE chat_messages (
      id INT AUTO_INCREMENT PRIMARY KEY,
      oid CHAR(24) NOT NULL,
      ticket_oid CHAR(24) NOT NULL,
      sender_oid CHAR(24) NULL,
      sender_name VARCHAR(120) NOT NULL DEFAULT '',
      sender_full_name VARCHAR(120) NOT NULL DEFAULT '',
      sender_profile_pic VARCHAR(512) NOT NULL DEFAULT '',
      receiver_oid CHAR(24) NULL,
      content TEXT NOT NULL,
      caption VARCHAR(500) NOT NULL DEFAULT '',
      message_type INT NOT NULL DEFAULT 1,
      read_status TINYINT(1) NOT NULL DEFAULT 0,
      delivery_status VARCHAR(16) NOT NULL DEFAULT 'delivered',
      attachment_url VARCHAR(512) NULL,
      attachment_type VARCHAR(32) NOT NULL DEFAULT '',
      attachment_name VARCHAR(255) NOT NULL DEFAULT '',
      attachment_size BIGINT NOT NULL DEFAULT 0,
      duration INT NOT NULL DEFAULT 0,
      mention_ids TEXT NOT NULL,
      video_image VARCHAR(512) NULL,
      created_at DATETIME NOT NULL,
      updated_at DATETIME NOT NULL,
      UNIQUE KEY uq_chat_messages_oid (oid),
      KEY idx_chat_messages_ticket (ticket_oid, created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  await createTableIfMissing('chat_attachments', `
    CREATE TABLE chat_attachments (
      id INT AUTO_INCREMENT PRIMARY KEY,
      oid CHAR(24) NOT NULL,
      uploader_oid CHAR(24) NOT NULL,
      original_name VARCHAR(255) NOT NULL DEFAULT '',
      mime_type VARCHAR(100) NOT NULL DEFAULT '',
      size_bytes BIGINT NOT NULL DEFAULT 0,
      data LONGBLOB NOT NULL,
      created_at DATETIME NOT NULL,
      UNIQUE KEY uq_chat_attachments_oid (oid)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  // Real 3 topics confirmed via papa776.har, same oids/timestamps used by
  // the earlier in-memory version for continuity.
  const topics = [
    ['6791e9794040440cc2242d75', 'Deposit', 'deposit', 1, '2025-01-23 07:02:17', '2026-06-11 06:05:29'],
    ['6790e068484db7edd6e49775', 'Withdraw', 'withdraw', 2, '2025-01-22 12:11:20', '2026-06-11 06:03:59'],
    ['6791e98a4040440cc2242d7f', 'Others', 'others', 3, '2025-01-21 07:02:34', '2026-06-11 06:03:53'],
  ];
  let seeded = 0;
  for (const [oid, name, key, order, createdAt, updatedAt] of topics) {
    const exists = await dbOne('SELECT id FROM chat_topics WHERE topic_key = :k LIMIT 1', { k: key });
    if (exists) { continue; }
    await dbExec(
      'INSERT INTO chat_topics (oid,name,topic_key,description,sort_order,created_at,updated_at) VALUES (:oid,:name,:key,\'\',:order,:c,:u)',
      { oid, name, key, order, c: createdAt, u: updatedAt }
    );
    seeded++;
  }
  console.log(seeded ? `+ seeded ${seeded} topic(s)` : '= topics already present');
}

if (require.main === module) {
  migrate().then(() => { console.log('Migration complete.'); process.exit(0); })
    .catch((e) => { console.error('Migration failed:', e); process.exit(1); });
}

module.exports = { migrate };
