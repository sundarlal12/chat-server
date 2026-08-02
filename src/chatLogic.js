const { newObjectId, isObjectId } = require('./helpers');
const store = require('./store');

/**
 * Shared in-memory chat logic used by both the REST routes and the
 * socket.io event handlers (send-message goes through insertMessage,
 * create-ticket goes through createOrGetTicket, etc.) so there's exactly
 * one place that mutates the store. No database - see store.js for why.
 *
 * Field/behavior choices below are confirmed against a REAL captured
 * socket.io session (a live client's raw Engine.IO frames), not just the
 * decompiled REST models - see the header comment in src/socket/index.js
 * for the full request/response contracts that trace confirmed.
 */

async function createOrGetTicket(user, { topicId }) {
  if (topicId && !isObjectId(topicId)) { throw httpError(400, 'Invalid topicId'); }

  const topic = topicId ? store.TOPICS.find((t) => t.oid === topicId.toLowerCase()) : null;
  if (topicId && !topic) { throw httpError(404, 'Topic not found'); }

  const existing = store.getTicketForUser(String(user.oid));
  if (existing && existing.status !== 'closed') {
    throw httpError(409, 'You already have an active ticket');
  }

  // The real server auto-generates subject/description from the topic name
  // and doesn't take them from the client at all (confirmed - create-ticket
  // requests only ever carry {topicId}).
  const topicName = topic ? topic.name : 'General';
  const now = new Date();
  const ticket = {
    oid: newObjectId(),
    user_oid: String(user.oid),
    topic_oid: topicId ? topicId.toLowerCase() : null,
    subject: `New Support Request for ${topicName}`,
    description: `Support request initiated for ${topicName}`,
    status: 'open',
    priority: 'medium',
    is_ai_handled: false,
    recipient_oid: store.DEFAULT_AGENT.oid,
    agent_name: store.DEFAULT_AGENT.userName,
    agent_full_name: store.DEFAULT_AGENT.fullName,
    agent_profile_pic: store.DEFAULT_AGENT.profilePic,
    rating: null,
    feedback: null,
    last_activity: now,
    last_customer_message: null,
    resolved_at: null,
    created_at: now,
    updated_at: now,
  };
  return store.saveTicket(ticket);
}

/** Resolves a recipientId to display info - the default agent if it matches, otherwise unknown (no user directory to look up an arbitrary id against). */
function resolveRecipient(recipientOid) {
  if (!recipientOid) { return null; }
  if (recipientOid === store.DEFAULT_AGENT.oid) {
    return {
      oid: store.DEFAULT_AGENT.oid,
      userName: store.DEFAULT_AGENT.userName,
      fullName: store.DEFAULT_AGENT.fullName,
      profilePic: store.DEFAULT_AGENT.profilePic,
    };
  }
  return { oid: recipientOid, userName: '', fullName: '', profilePic: '' };
}

async function insertMessage(user, ticket, body) {
  const content = (body.message || body.content || '').trim();
  const recipientId = (body.recipientId || ticket.recipient_oid || '').trim();
  const messageType = body.messageType !== undefined && body.messageType !== null ? Number(body.messageType) : 1;
  const attachmentUrl = (body.attachmentUrl || '').trim();

  if (!content && !attachmentUrl) { throw httpError(400, 'message is required'); }
  if (content.length > 4000) { throw httpError(400, 'Message is too long'); }
  if (String(ticket.status) === 'closed') { throw httpError(400, 'This ticket is closed'); }
  if (String(ticket.user_oid) !== String(user.oid)) { throw httpError(403, 'You do not have access to this ticket'); }

  const senderName = String(user.name || '');
  const senderFull = user.firstName ? `${user.firstName} ${user.lastName || ''}`.trim() : senderName;

  const now = new Date();
  const message = {
    oid: newObjectId(),
    ticket_oid: String(ticket.oid),
    sender_oid: String(user.oid),
    sender_name: senderName,
    sender_full_name: senderFull,
    sender_profile_pic: String(user.profilePic || ''),
    receiver_oid: recipientId || null,
    content,
    caption: (body.caption || '').trim(),
    message_type: messageType,
    read_status: 0,
    delivery_status: 'delivered',
    attachment_url: attachmentUrl || null,
    attachment_type: (body.attachmentType || '').trim(),
    attachment_name: (body.attachmentName || '').trim(),
    attachment_size: body.attachmentSize !== undefined && body.attachmentSize !== null && body.attachmentSize !== '' ? Number(body.attachmentSize) : 0,
    duration: body.duration !== undefined && body.duration !== null && body.duration !== '' ? Number(body.duration) : 0,
    mention_ids: Array.isArray(body.mentionIds) ? body.mentionIds : [],
    video_image: null,
    created_at: now,
    updated_at: now,
  };
  store.addMessage(String(ticket.oid), message);
  ticket.last_activity = now;
  ticket.last_customer_message = now;
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

async function submitRating(user, { ticketId, rating, feedback }) {
  const ticket = store.getTicketByOid(ticketId);
  if (!ticket) { throw httpError(404, 'Ticket not found'); }
  if (String(ticket.user_oid) !== String(user.oid)) { throw httpError(403, 'You do not have access to this ticket'); }
  const ratingNum = Number(rating);
  if (!Number.isInteger(ratingNum) || ratingNum < 1 || ratingNum > 5) { throw httpError(400, 'rating must be an integer 1-5'); }

  const now = new Date();
  ticket.rating = ratingNum;
  ticket.feedback = (feedback || '').trim();
  ticket.status = 'closed';
  ticket.resolved_at = ticket.resolved_at || now;
  ticket.updated_at = now;
  return ticket;
}

function httpError(status, message) {
  const e = new Error(message);
  e.httpStatus = status;
  return e;
}

module.exports = { createOrGetTicket, insertMessage, markMessagesRead, submitRating, resolveRecipient, httpError };
