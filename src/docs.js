const { iso, parseMentionIds } = require('./helpers');

/** Matches CreateTicketModel exactly - see api/v1/api/get-chat-data-of-recent-ticket.php's header comment. */
function ticketDoc(row) {
  return {
    customerId: String(row.user_oid),
    assignedTo: String(row.recipient_oid || ''),
    status: String(row.status),
    priority: String(row.priority),
    subject: String(row.subject),
    description: String(row.description),
    lastActivity: iso(row.last_activity || row.created_at),
    _id: String(row.oid),
    createdAt: iso(row.created_at),
    id: String(row.oid),
    agentInfo: row.agent_name ? {
      name: String(row.agent_name),
      status: String(row.agent_status || ''),
      profilePic: String(row.agent_profile_pic || ''),
    } : null,
  };
}

/** Matches MessageSupportModelNew exactly. */
function messageDoc(row) {
  const sender = row.sender_oid ? {
    _id: String(row.sender_oid),
    userName: String(row.sender_name || ''),
    fullName: String(row.sender_full_name || ''),
    profilePic: String(row.sender_profile_pic || ''),
  } : null;
  const receiver = row.receiver_oid ? {
    _id: String(row.receiver_oid),
    userName: String(row.receiver_name || ''),
    fullName: String(row.receiver_full_name || ''),
    profilePic: String(row.receiver_profile_pic || ''),
  } : null;
  return {
    _id: String(row.oid),
    sender,
    receiver,
    ticketId: String(row.ticket_oid),
    content: String(row.content || ''),
    caption: String(row.caption || ''),
    messageType: Number(row.message_type || 0),
    readStatus: !!row.read_status,
    deliveryStatus: String(row.delivery_status || 'sent'),
    mentionIds: parseMentionIds(row.mention_ids),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
    __v: 0,
    attachmentUrl: row.attachment_url || null,
    attachmentType: String(row.attachment_type || ''),
    attachmentName: String(row.attachment_name || ''),
    attachmentSize: row.attachment_size !== null && row.attachment_size !== undefined ? Number(row.attachment_size) : null,
    duration: row.duration !== null && row.duration !== undefined ? Number(row.duration) : null,
    videoImage: row.video_image || null,
  };
}

/** Matches TopicDoc exactly - see api/v1/api/get-all-topics.php. */
function topicDoc(row) {
  return {
    _id: String(row.oid),
    name: String(row.name),
    key: String(row.topic_key),
    description: String(row.description || ''),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
    id: String(row.oid),
  };
}

module.exports = { ticketDoc, messageDoc, topicDoc };
