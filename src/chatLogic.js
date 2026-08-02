const { newObjectId, isObjectId } = require('./helpers');
const store = require('./store');
const { KIND_TO_MESSAGE_TYPE } = require('./attachmentPolicy');

/**
 * If the caller didn't explicitly say what kind of message this is, but
 * did attach a file, infer messageType from the attachment's kind (the
 * upload response's attachmentType - "image"/"video"/"audio") rather than
 * defaulting to 1 (text). The exact int values (2=image, 3=video,
 * 4=document, 5=audio) come straight out of the real app's own decompiled
 * ChatAdapter, which picks which message layout to render PURELY off this
 * number - sending 1/text for an attachment message (the admin panel's
 * original bug) means the app never shows it at all, not even as a broken
 * image, since it renders the TEXT layout instead.
 */
function resolveMessageType(body) {
  if (body.messageType !== undefined && body.messageType !== null && body.messageType !== '') {
    return Number(body.messageType);
  }
  const attachmentUrl = (body.attachmentUrl || '').trim();
  if (attachmentUrl) {
    return KIND_TO_MESSAGE_TYPE[body.attachmentType] || 4;
  }
  return 1;
}

/**
 * "send-file-message" payload items - one array entry per attached file,
 * built from the app's MediaPreviewModel (fileName/filePath/fileSize/
 * fileExtension/mediaDuration/caption fields). The exact key names the
 * client puts on the wire for the uploaded file's URL couldn't be fully
 * confirmed from the decompiled bytecode (R8/JADX lost part of that method),
 * so this accepts every plausible variant rather than a single guessed key.
 */
function normalizeFileMessageItem(body) {
  const b = body || {};
  return {
    ...b,
    message: b.message || b.content || b.caption || '',
    attachmentUrl: b.attachmentUrl || b.fileUrl || b.url || '',
    attachmentType: b.attachmentType || b.fileType || '',
    attachmentName: b.attachmentName || b.fileName || '',
    attachmentSize: b.attachmentSize !== undefined ? b.attachmentSize : b.fileSize,
    duration: b.duration !== undefined ? b.duration : b.mediaDuration,
  };
}

/**
 * Shared chat logic used by both the REST routes and the socket.io event
 * handlers (send-message goes through insertMessage, create-ticket goes
 * through createOrGetTicket, etc.) so there's exactly one place that
 * mutates the store. Backed by MySQL (Railway) - see store.js/migrate.js.
 *
 * Field/behavior choices below are confirmed against a REAL captured
 * socket.io session (a live client's raw Engine.IO frames), not just the
 * decompiled REST models - see the header comment in src/socket/index.js
 * for the full request/response contracts that trace confirmed.
 */

async function createOrGetTicket(user, { topicId }) {
  if (topicId && !isObjectId(topicId)) { throw httpError(400, 'Invalid topicId'); }

  const topic = topicId ? await store.getTopicByOid(topicId.toLowerCase()) : null;
  if (topicId && !topic) { throw httpError(404, 'Topic not found'); }

  const existing = await store.getTicketForUser(String(user.oid));
  if (existing && existing.status !== 'closed') {
    throw httpError(409, 'You already have an active ticket');
  }

  // The real server auto-generates subject/description from the topic name
  // and doesn't take them from the client at all (confirmed - create-ticket
  // requests only ever carry {topicId}). The agent's display name is
  // randomized per ticket (operator request) so different conversations
  // don't all show the same fixed name - the underlying oid (used for
  // routing/receiver_oid) stays constant, only the shown name varies.
  const topicName = topic ? topic.name : 'General';
  const agentName = store.pickAgentName();
  const customerName = String(user.name || '');
  const customerFullName = user.firstName ? `${user.firstName} ${user.lastName || ''}`.trim() : customerName;
  return store.insertTicket({
    oid: newObjectId(),
    user_oid: String(user.oid),
    topic_oid: topicId ? topicId.toLowerCase() : null,
    subject: `New Support Request for ${topicName}`,
    description: `Support request initiated for ${topicName}`,
    status: 'open',
    priority: 'medium',
    is_ai_handled: 0,
    recipient_oid: store.DEFAULT_AGENT_OID,
    agent_name: agentName,
    agent_full_name: agentName,
    agent_profile_pic: '',
    customer_name: customerName,
    customer_full_name: customerFullName,
    customer_profile_pic: String(user.profilePic || ''),
  });
}

async function insertMessage(user, ticket, body) {
  const content = (body.message || body.content || '').trim();
  const recipientId = (body.recipientId || ticket.recipient_oid || '').trim();
  const messageType = resolveMessageType(body);
  const attachmentUrl = (body.attachmentUrl || '').trim();

  if (!content && !attachmentUrl) { throw httpError(400, 'message is required'); }
  if (content.length > 4000) { throw httpError(400, 'Message is too long'); }
  if (String(ticket.status) === 'closed') { throw httpError(400, 'This ticket is closed'); }
  if (String(ticket.user_oid) !== String(user.oid)) { throw httpError(403, 'You do not have access to this ticket'); }

  const senderName = String(user.name || '');
  const senderFull = user.firstName ? `${user.firstName} ${user.lastName || ''}`.trim() : senderName;

  // Receiver display name/pic come from the TICKET's own randomized agent
  // identity (not a global constant) when the recipient is that ticket's
  // assigned agent - keeps every message in a conversation showing the
  // same agent name that ticket was created with.
  const isTicketAgent = recipientId && recipientId === String(ticket.recipient_oid || '');
  const receiverName = isTicketAgent ? String(ticket.agent_name || '') : '';
  const receiverFullName = isTicketAgent ? String(ticket.agent_full_name || '') : '';
  const receiverProfilePic = isTicketAgent ? String(ticket.agent_profile_pic || '') : '';

  const message = await store.insertMessageRow({
    oid: newObjectId(),
    ticket_oid: String(ticket.oid),
    sender_oid: String(user.oid),
    sender_name: senderName,
    sender_full_name: senderFull,
    sender_profile_pic: String(user.profilePic || ''),
    receiver_oid: recipientId || null,
    receiver_name: receiverName,
    receiver_full_name: receiverFullName,
    receiver_profile_pic: receiverProfilePic,
    content,
    caption: (body.caption || '').trim(),
    message_type: messageType,
    delivery_status: 'delivered',
    attachment_url: attachmentUrl || null,
    attachment_type: (body.attachmentType || '').trim(),
    attachment_name: (body.attachmentName || '').trim(),
    attachment_size: body.attachmentSize !== undefined && body.attachmentSize !== null && body.attachmentSize !== '' ? Number(body.attachmentSize) : 0,
    duration: body.duration !== undefined && body.duration !== null && body.duration !== '' ? Number(body.duration) : 0,
    mention_ids: JSON.stringify(Array.isArray(body.mentionIds) ? body.mentionIds : []),
    video_image: null,
  });

  await store.updateTicket(String(ticket.oid), {
    last_activity: message.created_at,
    last_customer_message: message.created_at,
  });

  return message;
}

/**
 * Admin/agent side of send-message - sender is the TICKET's own agent
 * identity (so it matches whatever name the customer already sees for
 * this conversation, not a generic "admin"), receiver is the customer.
 * Any logged-in admin can reply to any open ticket - there's no
 * per-admin ticket assignment/ownership yet.
 */
async function insertAdminMessage(admin, ticket, body) {
  const content = (body.message || body.content || '').trim();
  const messageType = resolveMessageType(body);
  const attachmentUrl = (body.attachmentUrl || '').trim();

  if (!content && !attachmentUrl) { throw httpError(400, 'message is required'); }
  if (content.length > 4000) { throw httpError(400, 'Message is too long'); }
  if (String(ticket.status) === 'closed') { throw httpError(400, 'This ticket is closed'); }

  const message = await store.insertMessageRow({
    oid: newObjectId(),
    ticket_oid: String(ticket.oid),
    sender_oid: String(ticket.recipient_oid || ''),
    sender_name: String(ticket.agent_name || ''),
    sender_full_name: String(ticket.agent_full_name || ''),
    sender_profile_pic: String(ticket.agent_profile_pic || ''),
    receiver_oid: String(ticket.user_oid),
    receiver_name: String(ticket.customer_name || ''),
    receiver_full_name: String(ticket.customer_full_name || ''),
    receiver_profile_pic: String(ticket.customer_profile_pic || ''),
    content,
    caption: (body.caption || '').trim(),
    message_type: messageType,
    delivery_status: 'delivered',
    attachment_url: attachmentUrl || null,
    attachment_type: (body.attachmentType || '').trim(),
    attachment_name: (body.attachmentName || '').trim(),
    attachment_size: body.attachmentSize !== undefined && body.attachmentSize !== null && body.attachmentSize !== '' ? Number(body.attachmentSize) : 0,
    duration: body.duration !== undefined && body.duration !== null && body.duration !== '' ? Number(body.duration) : 0,
    mention_ids: JSON.stringify([]),
    video_image: null,
  });

  await store.updateTicket(String(ticket.oid), { last_activity: message.created_at });
  return message;
}

async function markMessagesRead(user, ticketId) {
  const ticket = await store.getTicketByOid(ticketId);
  if (!ticket) { throw httpError(404, 'Ticket not found'); }
  if (String(ticket.user_oid) !== String(user.oid)) { throw httpError(403, 'You do not have access to this ticket'); }

  return store.markMessagesReadFor(ticketId, String(user.oid));
}

async function submitRating(user, { ticketId, rating, feedback }) {
  const ticket = await store.getTicketByOid(ticketId);
  if (!ticket) { throw httpError(404, 'Ticket not found'); }
  if (String(ticket.user_oid) !== String(user.oid)) { throw httpError(403, 'You do not have access to this ticket'); }
  const ratingNum = Number(rating);
  if (!Number.isInteger(ratingNum) || ratingNum < 1 || ratingNum > 5) { throw httpError(400, 'rating must be an integer 1-5'); }

  return store.updateTicket(String(ticket.oid), {
    rating: ratingNum,
    feedback: (feedback || '').trim(),
    status: 'closed',
    resolved_at: ticket.resolved_at || new Date(),
  });
}

function httpError(status, message) {
  const e = new Error(message);
  e.httpStatus = status;
  return e;
}

module.exports = {
  createOrGetTicket, insertMessage, insertAdminMessage, markMessagesRead, submitRating, httpError,
  normalizeFileMessageItem,
};
