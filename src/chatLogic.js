const { newObjectId, isObjectId, iso } = require('./helpers');
const store = require('./store');

/**
 * Shared in-memory chat logic used by both the REST routes and the
 * socket.io event handlers (send-message/send-file-message both go
 * through insertMessage, create-ticket goes through createOrGetTicket,
 * etc.) so there's exactly one place that mutates the store. No database -
 * see store.js for why.
 */

async function createOrGetTicket(user, { topicId, subject, description }) {
  subject = (subject || '').trim();
  description = (description || '').trim();
  if (topicId && !isObjectId(topicId)) { throw httpError(400, 'Invalid topicId'); }
  if (!subject) { throw httpError(400, 'Subject is required'); }
  if (subject.length > 255) { throw httpError(400, 'Subject is too long'); }
  if (description.length > 1000) { throw httpError(400, 'Description is too long'); }

  if (topicId && !store.TOPICS.some((t) => t.oid === topicId.toLowerCase())) {
    throw httpError(404, 'Topic not found');
  }

  const existing = store.getTicketForUser(String(user.oid));
  if (existing && existing.status !== 'closed') { return existing; }

  const now = new Date();
  const ticket = {
    oid: newObjectId(),
    user_oid: String(user.oid),
    topic_oid: topicId ? topicId.toLowerCase() : null,
    subject,
    description,
    status: 'open',
    priority: 'medium',
    recipient_oid: null,
    agent_name: '',
    agent_status: '',
    agent_profile_pic: '',
    last_activity: now,
    created_at: now,
    updated_at: now,
  };
  return store.saveTicket(ticket);
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
  const senderFull = user.firstName ? `${user.firstName} ${user.lastName || ''}`.trim() : senderName;
  const senderPic = String(user.profilePic || '');
  const receiverOid = ticket.recipient_oid ? String(ticket.recipient_oid) : null;

  const now = new Date();
  const message = {
    oid: newObjectId(),
    ticket_oid: String(ticket.oid),
    sender_oid: senderOid,
    sender_name: senderName,
    sender_full_name: senderFull,
    sender_profile_pic: senderPic,
    receiver_oid: receiverOid,
    content,
    caption,
    message_type: messageType,
    read_status: 0,
    delivery_status: 'sent',
    attachment_url: attachmentUrl || null,
    attachment_type: attachmentType,
    attachment_name: attachmentName,
    attachment_size: attachmentSize !== undefined && attachmentSize !== null && attachmentSize !== '' ? Number(attachmentSize) : null,
    duration: duration !== undefined && duration !== null && duration !== '' ? Number(duration) : null,
    created_at: now,
    updated_at: now,
  };
  store.addMessage(String(ticket.oid), message);
  ticket.last_activity = now;
  ticket.updated_at = now;

  return message;
}

async function markMessagesRead(user, ticketId) {
  const ticket = store.getTicketByOid(ticketId);
  if (!ticket) { throw httpError(404, 'Ticket not found'); }
  if (String(ticket.user_oid) !== String(user.oid)) { throw httpError(403, 'You do not have access to this ticket'); }

  const now = new Date();
  let updated = 0;
  for (const m of store.getMessages(ticketId)) {
    if (m.receiver_oid === String(user.oid) && !m.read_status) {
      m.read_status = 1;
      m.updated_at = now;
      updated++;
    }
  }
  return updated;
}

function httpError(status, message) {
  const e = new Error(message);
  e.httpStatus = status;
  return e;
}

module.exports = { createOrGetTicket, insertMessage, markMessagesRead, httpError };
