const { dbOne, dbAll, dbExec } = require('./db');
const { mysqlNow } = require('./helpers');

/**
 * DB-backed chat store (Railway MySQL - see migrate.js for schema). Was
 * originally in-memory only; the operator asked for real persistence
 * (including attachments) once the "own MySQL on Railway" option removed
 * the Hostinger-reachability problem that motivated going in-memory in the
 * first place.
 */

// The real backend auto-assigns every new ticket to a support identity
// immediately (confirmed via a real captured socket.io trace - "assignedTo"
// is already populated in the create-ticket response, before any human/AI
// has actually replied). No admin panel exists yet to pick a real agent,
// so this is a fixed placeholder ROUTING identity (the oid every ticket's
// recipient_oid/receiver_oid uses) - override via env var once a real
// agent/admin system exists.
const DEFAULT_AGENT_OID = process.env.DEFAULT_AGENT_ID || '69d37240ec8077df95971617';

// The DISPLAY name shown for that identity is picked at random per ticket
// (by explicit operator request) so different conversations don't all
// show the same fixed agent name - picked once at ticket creation and
// stored on the ticket, not re-randomized per message.
const AGENT_NAME_POOL = ['Sangeeta', 'Kweeta', 'Pari', 'Parul', 'PAPA777'];
function pickAgentName() {
  return AGENT_NAME_POOL[Math.floor(Math.random() * AGENT_NAME_POOL.length)];
}

async function getTopics() {
  return dbAll('SELECT * FROM chat_topics ORDER BY sort_order ASC, id ASC');
}

async function getTopicByOid(oid) {
  return dbOne('SELECT * FROM chat_topics WHERE oid = :o LIMIT 1', { o: oid });
}

async function getTicketForUser(userOid) {
  return dbOne(
    "SELECT * FROM chat_tickets WHERE user_oid = :u ORDER BY created_at DESC, id DESC LIMIT 1",
    { u: userOid }
  );
}

async function getTicketByOid(ticketOid) {
  return dbOne('SELECT * FROM chat_tickets WHERE oid = :o LIMIT 1', { o: ticketOid });
}

async function insertTicket(t) {
  const now = mysqlNow();
  await dbExec(
    `INSERT INTO chat_tickets
       (oid,user_oid,topic_oid,subject,description,status,priority,is_ai_handled,
        recipient_oid,agent_name,agent_full_name,agent_profile_pic,
        customer_name,customer_full_name,customer_profile_pic,customer_fcm_token,customer_phone,
        last_activity,created_at,updated_at)
     VALUES (:oid,:user_oid,:topic_oid,:subject,:description,:status,:priority,:is_ai_handled,
             :recipient_oid,:agent_name,:agent_full_name,:agent_profile_pic,
             :customer_name,:customer_full_name,:customer_profile_pic,:customer_fcm_token,:customer_phone,
             :now,:now,:now)`,
    { ...t, now }
  );
  return getTicketByOid(t.oid);
}

/** Admin ticket list - most recently active first, optionally filtered by status. */
async function getAllTickets({ status, limit, offset } = {}) {
  const where = status ? 'WHERE status = :status' : '';
  const params = status ? { status } : {};
  return dbAll(
    `SELECT * FROM chat_tickets ${where} ORDER BY last_activity DESC, id DESC LIMIT ${Number(limit || 50)} OFFSET ${Number(offset || 0)}`,
    params
  );
}

async function countAllTickets({ status } = {}) {
  const where = status ? 'WHERE status = :status' : '';
  const params = status ? { status } : {};
  const row = await dbOne(`SELECT COUNT(*) AS n FROM chat_tickets ${where}`, params);
  return Number(row?.n || 0);
}

async function getAdminByUsername(username) {
  return dbOne('SELECT * FROM chat_admins WHERE username = :u LIMIT 1', { u: username });
}

async function updateTicket(oid, fields) {
  const sets = [];
  const params = { oid, now: mysqlNow() };
  for (const [k, v] of Object.entries(fields)) {
    sets.push(`${k} = :${k}`);
    params[k] = v;
  }
  sets.push('updated_at = :now');
  await dbExec(`UPDATE chat_tickets SET ${sets.join(', ')} WHERE oid = :oid`, params);
  return getTicketByOid(oid);
}

async function getMessages(ticketOid, { limit, offset } = {}) {
  if (limit !== undefined) {
    return dbAll(
      `SELECT * FROM chat_messages WHERE ticket_oid = :t ORDER BY created_at DESC, id DESC LIMIT ${Number(limit)} OFFSET ${Number(offset || 0)}`,
      { t: ticketOid }
    );
  }
  return dbAll('SELECT * FROM chat_messages WHERE ticket_oid = :t ORDER BY created_at ASC, id ASC', { t: ticketOid });
}

async function countMessages(ticketOid) {
  const row = await dbOne('SELECT COUNT(*) AS n FROM chat_messages WHERE ticket_oid = :t', { t: ticketOid });
  return Number(row?.n || 0);
}

async function insertMessageRow(m) {
  const now = mysqlNow();
  await dbExec(
    `INSERT INTO chat_messages
       (oid,ticket_oid,sender_oid,sender_name,sender_full_name,sender_profile_pic,
        receiver_oid,receiver_name,receiver_full_name,receiver_profile_pic,
        content,caption,message_type,read_status,delivery_status,
        attachment_url,attachment_type,attachment_name,attachment_size,duration,
        mention_ids,video_image,created_at,updated_at)
     VALUES (:oid,:ticket_oid,:sender_oid,:sender_name,:sender_full_name,:sender_profile_pic,
             :receiver_oid,:receiver_name,:receiver_full_name,:receiver_profile_pic,
             :content,:caption,:message_type,0,:delivery_status,
             :attachment_url,:attachment_type,:attachment_name,:attachment_size,:duration,
             :mention_ids,:video_image,:now,:now)`,
    { ...m, now }
  );
  return dbOne('SELECT * FROM chat_messages WHERE oid = :o LIMIT 1', { o: m.oid });
}

async function getMessageByOid(oid) {
  return dbOne('SELECT * FROM chat_messages WHERE oid = :o LIMIT 1', { o: oid });
}

async function updateMessage(oid, fields) {
  const sets = [];
  const params = { oid, now: mysqlNow() };
  for (const [k, v] of Object.entries(fields)) {
    sets.push(`${k} = :${k}`);
    params[k] = v;
  }
  sets.push('updated_at = :now');
  await dbExec(`UPDATE chat_messages SET ${sets.join(', ')} WHERE oid = :oid`, params);
  return getMessageByOid(oid);
}

async function markMessagesReadFor(ticketOid, receiverOid) {
  return dbExec(
    `UPDATE chat_messages SET read_status = 1, updated_at = :now
      WHERE ticket_oid = :t AND receiver_oid = :u AND read_status = 0`,
    { now: mysqlNow(), t: ticketOid, u: receiverOid }
  );
}

async function insertAttachment(a) {
  await dbExec(
    `INSERT INTO chat_attachments (oid,uploader_oid,original_name,mime_type,size_bytes,data,created_at)
     VALUES (:oid,:uploader_oid,:original_name,:mime_type,:size_bytes,:data,:now)`,
    { ...a, now: mysqlNow() }
  );
  return a.oid;
}

async function getAttachment(oid) {
  return dbOne('SELECT * FROM chat_attachments WHERE oid = :o LIMIT 1', { o: oid });
}

/** WhatsApp (Baileys) auth-state key-value store - see src/whatsapp.js. */
async function getWhatsAppAuthFile(fileKey) {
  const row = await dbOne('SELECT file_value FROM whatsapp_auth_files WHERE file_key = :k LIMIT 1', { k: fileKey });
  return row ? row.file_value : null;
}

async function setWhatsAppAuthFile(fileKey, value) {
  await dbExec(
    `INSERT INTO whatsapp_auth_files (file_key, file_value, updated_at) VALUES (:k, :v, :now)
     ON DUPLICATE KEY UPDATE file_value = :v, updated_at = :now`,
    { k: fileKey, v: value, now: mysqlNow() }
  );
}

async function deleteWhatsAppAuthFile(fileKey) {
  await dbExec('DELETE FROM whatsapp_auth_files WHERE file_key = :k', { k: fileKey });
}

/** Wipes the whole stored session (e.g. after the linked device was remotely unlinked) so the next connect starts clean with a fresh QR instead of failing on dead credentials. */
async function clearWhatsAppAuthFiles() {
  await dbExec('DELETE FROM whatsapp_auth_files');
}

const WHATSAPP_PENDING_NOTIFICATIONS_CAP = 20;

/** Queues a WhatsApp alert that couldn't be sent immediately - see src/whatsapp.js. Caps the backlog (oldest dropped first) so a long outage doesn't flood the admin with a huge batch once reconnected. */
async function queueWhatsAppNotification(text) {
  await dbExec('INSERT INTO whatsapp_pending_notifications (message_text, created_at) VALUES (:t, :now)', { t: text, now: mysqlNow() });
  await dbExec(
    `DELETE FROM whatsapp_pending_notifications WHERE id NOT IN (
       SELECT id FROM (SELECT id FROM whatsapp_pending_notifications ORDER BY id DESC LIMIT ${WHATSAPP_PENDING_NOTIFICATIONS_CAP}) keep
     )`
  );
}

async function getPendingWhatsAppNotifications() {
  return dbAll('SELECT * FROM whatsapp_pending_notifications ORDER BY id ASC');
}

async function deletePendingWhatsAppNotification(id) {
  await dbExec('DELETE FROM whatsapp_pending_notifications WHERE id = :id', { id });
}

module.exports = {
  DEFAULT_AGENT_OID,
  pickAgentName,
  getTopics,
  getTopicByOid,
  getTicketForUser,
  getTicketByOid,
  insertTicket,
  updateTicket,
  getAllTickets,
  countAllTickets,
  getAdminByUsername,
  getMessages,
  countMessages,
  insertMessageRow,
  getMessageByOid,
  updateMessage,
  markMessagesReadFor,
  insertAttachment,
  getAttachment,
  getWhatsAppAuthFile,
  setWhatsAppAuthFile,
  deleteWhatsAppAuthFile,
  clearWhatsAppAuthFiles,
  queueWhatsAppNotification,
  getPendingWhatsAppNotifications,
  deletePendingWhatsAppNotification,
};
