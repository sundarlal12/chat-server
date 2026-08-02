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
// so this is a fixed placeholder identity - override via env vars once a
// real agent/admin system exists.
const DEFAULT_AGENT = {
  oid: process.env.DEFAULT_AGENT_ID || '69d37240ec8077df95971617',
  userName: process.env.DEFAULT_AGENT_USERNAME || 'sangeetha',
  fullName: process.env.DEFAULT_AGENT_FULLNAME || 'Support Executive',
  profilePic: '',
};

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
        last_activity,created_at,updated_at)
     VALUES (:oid,:user_oid,:topic_oid,:subject,:description,:status,:priority,:is_ai_handled,
             :recipient_oid,:agent_name,:agent_full_name,:agent_profile_pic,
             :now,:now,:now)`,
    { ...t, now }
  );
  return getTicketByOid(t.oid);
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
        receiver_oid,content,caption,message_type,read_status,delivery_status,
        attachment_url,attachment_type,attachment_name,attachment_size,duration,
        mention_ids,video_image,created_at,updated_at)
     VALUES (:oid,:ticket_oid,:sender_oid,:sender_name,:sender_full_name,:sender_profile_pic,
             :receiver_oid,:content,:caption,:message_type,0,:delivery_status,
             :attachment_url,:attachment_type,:attachment_name,:attachment_size,:duration,
             :mention_ids,:video_image,:now,:now)`,
    { ...m, now }
  );
  return dbOne('SELECT * FROM chat_messages WHERE oid = :o LIMIT 1', { o: m.oid });
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

module.exports = {
  DEFAULT_AGENT,
  getTopics,
  getTopicByOid,
  getTicketForUser,
  getTicketByOid,
  insertTicket,
  updateTicket,
  getMessages,
  countMessages,
  insertMessageRow,
  markMessagesReadFor,
  insertAttachment,
  getAttachment,
};
