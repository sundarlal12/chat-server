const { iso } = require('./helpers');
const { resolveRecipient } = require('./chatLogic');

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
  const recv = resolveRecipient(m.receiver_oid);
  const receiver = recv ? { _id: recv.oid, userName: recv.userName, profilePic: recv.profilePic, fullName: recv.fullName } : null;

  return {
    sender,
    receiver,
    ticketId: m.ticket_oid,
    content: m.content || '',
    messageType: Number(m.message_type || 0),
    attachmentSize: Number(m.attachment_size || 0),
    duration: Number(m.duration || 0),
    deliveryStatus: m.delivery_status || 'delivered',
    mentionIds: Array.isArray(m.mention_ids) ? m.mention_ids : [],
    _id: m.oid,
    createdAt: iso(m.created_at),
    updatedAt: iso(m.updated_at),
    __v: 0,
    attachmentUrl: m.attachment_url || null,
    videoImage: m.video_image || null,
  };
}

module.exports = { rawTicketDoc, createdTicketDoc, socketMessageDoc };
