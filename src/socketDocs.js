const { iso } = require('./helpers');

/**
 * Doc shapes for the RAW socket.io protocol - confirmed against a real
 * captured session, and genuinely different from docs.js's REST-side
 * shapes (which match the decompiled CreateTicketModel/
 * MessageSupportModelNew Kotlin classes). The socket protocol appears to
 * send closer-to-raw backend documents with less transformation - e.g.
 * get-open-ticket includes a Mongoose `__v` key and has no `id` virtual,
 * while create-ticket's response ticket has `id` but no `__v`/
 * `lastCustomerMessage`/`resolvedAt`. Both variants are reproduced exactly
 * as captured rather than unified into one shape.
 */

/** get-open-ticket's ticket - the fuller, more "raw document" shape. */
function rawTicketDoc(t) {
  return {
    _id: t.oid,
    customerId: t.user_oid,
    assignedTo: t.recipient_oid || '',
    topicId: t.topic_oid || '',
    status: t.status,
    isAiHandled: !!t.is_ai_handled,
    priority: t.priority,
    subject: t.subject,
    description: t.description,
    lastActivity: iso(t.last_activity || t.created_at),
    createdAt: iso(t.created_at),
    updatedAt: iso(t.updated_at),
    __v: 0,
    lastCustomerMessage: t.last_customer_message ? iso(t.last_customer_message) : null,
    resolvedAt: t.resolved_at ? iso(t.resolved_at) : null,
  };
}

/** create-ticket's response ticket - a curated shape (has `id`, skips __v/lastCustomerMessage/resolvedAt). */
function createdTicketDoc(t) {
  return {
    customerId: t.user_oid,
    assignedTo: t.recipient_oid || '',
    topicId: t.topic_oid || '',
    status: t.status,
    isAiHandled: !!t.is_ai_handled,
    priority: t.priority,
    subject: t.subject,
    description: t.description,
    lastActivity: iso(t.last_activity || t.created_at),
    _id: t.oid,
    createdAt: iso(t.created_at),
    updatedAt: iso(t.updated_at),
    id: t.oid,
  };
}

/** send-message's messageDoc. */
function socketMessageDoc(m) {
  const sender = m.sender_oid ? {
    _id: m.sender_oid, userName: m.sender_name || '', profilePic: m.sender_profile_pic || '', fullName: m.sender_full_name || '',
  } : null;
  // Receiver display info is denormalized onto the message row at insert
  // time from the ticket's own (randomized-per-ticket) agent identity -
  // see chatLogic.js's insertMessage - rather than resolved here.
  const receiver = m.receiver_oid ? {
    _id: m.receiver_oid, userName: m.receiver_name || '', profilePic: m.receiver_profile_pic || '', fullName: m.receiver_full_name || '',
  } : null;

  return {
    sender,
    receiver,
    ticketId: m.ticket_oid,
    content: m.content || '',
    messageType: Number(m.message_type || 0),
    attachmentSize: Number(m.attachment_size || 0),
    duration: Number(m.duration || 0),
    deliveryStatus: m.delivery_status || 'delivered',
    mentionIds: parseMentionIds(m.mention_ids),
    _id: m.oid,
    createdAt: iso(m.created_at),
    updatedAt: iso(m.updated_at),
    __v: 0,
    attachmentUrl: m.attachment_url || null,
    videoImage: m.video_image || null,
  };
}

/** mention_ids is stored as a JSON text column - parse it back into an array. */
function parseMentionIds(raw) {
  if (Array.isArray(raw)) { return raw; }
  if (typeof raw !== 'string' || raw === '') { return []; }
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/**
 * The app has two SEPARATE listeners for an incoming chat message -
 * "send-message" (plain text) and "send-file-message" (anything with an
 * attachment) - confirmed via the decompiled SupportChatActivity (distinct
 * event-name fields, each with its own Emitter.Listener). A message with
 * an attachment broadcast under "send-message" would never reach the
 * file-message listener at all, so which event a message goes out under
 * has to match whether it actually has an attachment, regardless of which
 * side (customer or admin) sent it.
 */
function chatMessageEventName(message) {
  return message.attachment_url ? 'send-file-message' : 'send-message';
}

module.exports = { rawTicketDoc, createdTicketDoc, socketMessageDoc, chatMessageEventName };
