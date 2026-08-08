require('dotenv').config();
const crypto = require('crypto');
const { pool, dbOne, dbExec } = require('./src/db');
const { hashPassword } = require('./src/adminAuth');
const { newObjectId } = require('./src/helpers');

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

/** ALTER TABLE ADD COLUMN, but only if it's not already there - safe to run against a table that already has real data. */
async function ensureColumn(table, column, definition) {
  const [rows] = await pool.query(
    `SELECT COUNT(*) AS n FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [table, column]
  );
  if (rows[0].n > 0) { return; }
  await pool.query(`ALTER TABLE \`${table}\` ADD COLUMN \`${column}\` ${definition}`);
  console.log(`+ added column ${table}.${column}`);
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

  // Added after chat_tickets already had real data in production - lets
  // the admin ticket list show a customer name without a per-row PHP
  // lookup (see chatLogic.js's createOrGetTicket, which populates these
  // from the customer's own auth info at ticket-creation time).
  await ensureColumn('chat_tickets', 'customer_name', "VARCHAR(120) NOT NULL DEFAULT ''");
  await ensureColumn('chat_tickets', 'customer_full_name', "VARCHAR(120) NOT NULL DEFAULT ''");
  await ensureColumn('chat_tickets', 'customer_profile_pic', "VARCHAR(512) NOT NULL DEFAULT ''");
  // Cached from the PHP UserInfo model (see phpApi.js) whenever the
  // customer's own authenticated requests see it - the only way an
  // admin-initiated push notification (src/push.js) can reach the
  // customer's current device, since only the customer's own requests
  // ever carry their fcmToken.
  await ensureColumn('chat_tickets', 'customer_fcm_token', "VARCHAR(255) NOT NULL DEFAULT ''");
  // Same cache pattern as customer_name/etc - shown in the admin panel
  // ticket list/header (operator request) and used in WhatsApp alert text.
  await ensureColumn('chat_tickets', 'customer_phone', "VARCHAR(32) NOT NULL DEFAULT ''");
  // Set once, the first time a REAL admin (not the welcome/deposit
  // auto-replies, which also send as the agent identity but aren't a
  // human responding) sends a message on this ticket - see
  // insertAdminMessage in chatLogic.js. Gates the "forward every customer
  // message to WhatsApp" behavior (see routes/tickets.js and
  // socket/index.js's send-message handlers) - operator wants ongoing
  // unattended messages relayed, but only until an admin actually starts
  // handling the conversation.
  await ensureColumn('chat_tickets', 'admin_first_replied_at', 'DATETIME NULL');
  // Set once, the first time the deposit-image auto-reply actually sends
  // on this ticket (either trigger - see maybeAutoReplyToDepositGreeting
  // in chatLogic.js) - operator report: customers got annoyed being sent
  // the QR again on every later deposit-related message in the same
  // conversation. Capped at once per ticket now regardless of which
  // trigger or how many times it would otherwise match; a genuinely new
  // ticket gets it again.
  await ensureColumn('chat_tickets', 'deposit_qr_sent_at', 'DATETIME NULL');

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
      receiver_name VARCHAR(120) NOT NULL DEFAULT '',
      receiver_full_name VARCHAR(120) NOT NULL DEFAULT '',
      receiver_profile_pic VARCHAR(512) NOT NULL DEFAULT '',
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

  // Added after chat_messages already had real data in production - a
  // fresh install gets these from the CREATE TABLE above, an existing
  // table gets them bolted on here without touching existing rows.
  await ensureColumn('chat_messages', 'receiver_name', "VARCHAR(120) NOT NULL DEFAULT ''");
  await ensureColumn('chat_messages', 'receiver_full_name', "VARCHAR(120) NOT NULL DEFAULT ''");
  await ensureColumn('chat_messages', 'receiver_profile_pic', "VARCHAR(512) NOT NULL DEFAULT ''");

  await createTableIfMissing('chat_admins', `
    CREATE TABLE chat_admins (
      id INT AUTO_INCREMENT PRIMARY KEY,
      oid CHAR(24) NOT NULL,
      username VARCHAR(64) NOT NULL,
      password_hash VARCHAR(255) NOT NULL,
      display_name VARCHAR(120) NOT NULL DEFAULT '',
      created_at DATETIME NOT NULL,
      updated_at DATETIME NOT NULL,
      UNIQUE KEY uq_chat_admins_oid (oid),
      UNIQUE KEY uq_chat_admins_username (username)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  // If ADMIN_SEED_USERNAME/ADMIN_SEED_PASSWORD are explicitly set, reconcile
  // toward them on EVERY startup (not just first-run) - so setting/changing
  // these env vars on Railway and redeploying is how the admin username/
  // password gets set or rotated, rather than being a one-time-only seed.
  // With no admin account at all, one is created from these values; with
  // exactly one existing account (the common case - this system supports a
  // single admin login), it's renamed/repassworded to match; if an account
  // with this exact username already exists, only its password is synced.
  // With nothing set, falls back to a one-time random-password seed so the
  // service still has SOME way in on a completely fresh deploy.
  const nowStr = () => new Date().toISOString().slice(0, 19).replace('T', ' ');
  if (process.env.ADMIN_SEED_USERNAME && process.env.ADMIN_SEED_PASSWORD) {
    const username = process.env.ADMIN_SEED_USERNAME;
    const passwordHash = hashPassword(process.env.ADMIN_SEED_PASSWORD);
    const byUsername = await dbOne('SELECT id FROM chat_admins WHERE username = :u LIMIT 1', { u: username });
    if (byUsername) {
      await dbExec('UPDATE chat_admins SET password_hash = :p, updated_at = :now WHERE id = :id', { p: passwordHash, now: nowStr(), id: byUsername.id });
      console.log(`= admin "${username}" already present - password synced from ADMIN_SEED_PASSWORD`);
    } else {
      const [allAdmins] = await pool.query('SELECT id FROM chat_admins');
      if (allAdmins.length === 1) {
        await dbExec('UPDATE chat_admins SET username = :u, password_hash = :p, updated_at = :now WHERE id = :id', { u: username, p: passwordHash, now: nowStr(), id: allAdmins[0].id });
        console.log(`+ renamed existing admin account to "${username}" and synced its password`);
      } else {
        await dbExec(
          'INSERT INTO chat_admins (oid,username,password_hash,display_name,created_at,updated_at) VALUES (:oid,:u,:p,:d,:now,:now)',
          { oid: newObjectId(), u: username, p: passwordHash, d: 'Admin', now: nowStr() }
        );
        console.log(`+ seeded admin account "${username}" from ADMIN_SEED_USERNAME/ADMIN_SEED_PASSWORD`);
      }
    }
  } else {
    const anyAdmin = await dbOne('SELECT id FROM chat_admins LIMIT 1');
    if (!anyAdmin) {
      const username = 'admin';
      const password = crypto.randomBytes(9).toString('base64url');
      await dbExec(
        'INSERT INTO chat_admins (oid,username,password_hash,display_name,created_at,updated_at) VALUES (:oid,:u,:p,:d,:now,:now)',
        { oid: newObjectId(), u: username, p: hashPassword(password), d: 'Admin', now: nowStr() }
      );
      console.log('+ seeded initial admin account:');
      console.log(`    username: ${username}`);
      console.log(`    password: ${password}`);
      console.log('  (shown once - save it now, it is not recoverable from the DB)');
    } else {
      console.log('= admin account already present');
    }
  }

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

  // Generic key-value store for the WhatsApp Web (Baileys) linked-device
  // session (see src/whatsapp.js) - mirrors Baileys' own file-based
  // useMultiFileAuthState() one-row-per-key shape (one row for "creds",
  // one per signal-protocol key/session/etc.), just backed by MySQL
  // instead of local files so the session survives every deploy instead
  // of forcing a fresh QR scan each time (this service redeploys often).
  await createTableIfMissing('whatsapp_auth_files', `
    CREATE TABLE whatsapp_auth_files (
      id INT AUTO_INCREMENT PRIMARY KEY,
      file_key VARCHAR(255) NOT NULL,
      file_value LONGTEXT NULL,
      updated_at DATETIME NOT NULL,
      UNIQUE KEY uq_whatsapp_auth_files_key (file_key)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  // Queue for admin alerts that couldn't be sent immediately (WhatsApp
  // disconnected/reconnecting - happens on every deploy, and on ordinary
  // connection drops too) - reported: alerts sometimes silently never
  // arrived when the admin was idle. notifyAdminWhatsApp() (src/
  // whatsapp.js) now queues here instead of just dropping when not
  // connected or a send throws, and flushes on reconnect.
  await createTableIfMissing('whatsapp_pending_notifications', `
    CREATE TABLE whatsapp_pending_notifications (
      id INT AUTO_INCREMENT PRIMARY KEY,
      message_text TEXT NOT NULL,
      created_at DATETIME NOT NULL
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
