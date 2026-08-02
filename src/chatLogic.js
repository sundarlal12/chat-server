const { dbOne, dbExec } = require('./db');
const { newObjectId, isObjectId, mysqlNow } = require('./helpers');

/**
 * Shared persistence logic used by both the REST routes and the socket.io
 * event handlers (send-message/send-file-message both go through
 * insertMessage, create-ticket goes through createOrGetTicket, etc.) so
 * there's exactly one place that writes to support_tickets/support_messages.
 */

async function createOrGetTicket(user, { topicId, subject, description }) {
  subject = (subject || '').trim();
  description = (description || '').trim();
  if (topicId && !isObjectId(topicId)) { throw httpError(400, 'Invalid topicId'); }
  if (!subject) { throw httpError(400, 'Subject is required'); }
  if (subject.length > 255) { throw httpError(400, 'Subject is too long'); }
  if (description.length > 1000) { throw httpError(400, 'Description is too long'); }

  if (topicId) {
    const topic = await dbOne('SELECT id FROM support_topics WHERE oid = :o AND is_active = 1 LIMIT 1', { o: topicId.toLowerCase() });
    if (!topic) { throw httpError(404, 'Topic not found'); }
  }

  const existing = await dbOne(
    "SELECT * FROM support_tickets WHERE user_oid = :u AND status != 'closed' ORDER BY created_at DESC LIMIT 1",
    { u: String(user.oid) }
  );
  if (existing) { return existing; }

  const oid = newObjectId();
  const now = mysqlNow();
  await dbExec(
    `INSERT INTO support_tickets (oid,user_oid,topic_oid,subject,description,status,priority,last_activity,created_at,updated_at)
     VALUES (:oid,:u,:t,:s,:d,'open','medium',:now,:now,:now)`,
    { oid, u: String(user.oid), t: topicId ? topicId.toLowerCase() : null, s: subject, d: description, now }
  );
  return dbOne('SELECT * FROM support_tickets WHERE oid = :o LIMIT 1', { o: oid });
}

async function insertMessage(user, ticket, body) {
  const content = (body.content || '').trim();
  const caption = (body.caption || '').trim();
  const attachmentUrl = (body.attachmentUrl || '').trim();
  const attachmentType = (body.attachmentType || '').trim();
  const attachmentName = (body.attachmentName || '').trim();
  const attachmentSize = body.attachmentSize;
  const duration = body.duration;
  const messageType = body.messageType !== undefined && body.messageType !== null
    ? Number(body.messageType) : (attachmentUrl ? 1 : 0);

  if (!content && !attachmentUrl) { throw httpError(400, 'content or attachmentUrl is required'); }
  if (content.length > 4000) { throw httpError(400, 'Message is too long'); }
  if (String(ticket.status) === 'closed') { throw httpError(400, 'This ticket is closed'); }
  if (String(ticket.user_oid) !== String(user.oid)) { throw httpError(403, 'You do not have access to this ticket'); }

  const senderOid = String(user.oid);
  const senderName = String(user.name || '');
  const senderFull = user.first_name ? `${user.first_name} ${user.last_name || ''}`.trim() : senderName;
  const senderPic = String(user.profile_pic || '');
  const receiverOid = ticket.recipient_oid ? String(ticket.recipient_oid) : null;

  const oid = newObjectId();
  const now = mysqlNow();
  await dbExec(
    `INSERT INTO support_messages
       (oid,ticket_oid,sender_oid,sender_name,sender_full_name,sender_profile_pic,
        receiver_oid,content,caption,message_type,read_status,delivery_status,
        attachment_url,attachment_type,attachment_name,attachment_size,duration,
        created_at,updated_at)
     VALUES (:oid,:t,:so,:sn,:sf,:sp,:ro,:c,:cap,:mt,0,'sent',:au,:at,:an,:as,:du,:now,:now)`,
    {
      oid, t: String(ticket.oid), so: senderOid, sn: senderName, sf: senderFull, sp: senderPic,
      ro: receiverOid, c: content, cap: caption, mt: messageType,
      au: attachmentUrl || null, at: attachmentType, an: attachmentName,
      as: attachmentSize !== undefined && attachmentSize !== null && attachmentSize !== '' ? Number(attachmentSize) : null,
      du: duration !== undefined && duration !== null && duration !== '' ? Number(duration) : null,
      now,
    }
  );
  await dbExec('UPDATE support_tickets SET last_activity = :now, updated_at = :now WHERE oid = :o', { now, o: String(ticket.oid) });

  return dbOne('SELECT * FROM support_messages WHERE oid = :o LIMIT 1', { o: oid });
}

async function markMessagesRead(user, ticketId) {
  const ticket = await dbOne('SELECT * FROM support_tickets WHERE oid = :o LIMIT 1', { o: ticketId });
  if (!ticket) { throw httpError(404, 'Ticket not found'); }
  if (String(ticket.user_oid) !== String(user.oid)) { throw httpError(403, 'You do not have access to this ticket'); }

  const updated = await dbExec(
    `UPDATE support_messages SET read_status = 1, updated_at = :now
      WHERE ticket_oid = :t AND receiver_oid = :u AND read_status = 0`,
    { now: mysqlNow(), t: ticketId, u: String(user.oid) }
  );
  return updated;
}

function httpError(status, message) {
  const e = new Error(message);
  e.httpStatus = status;
  return e;
}

module.exports = { createOrGetTicket, insertMessage, markMessagesRead, httpError };
