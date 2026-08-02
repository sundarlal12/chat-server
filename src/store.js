/**
 * Pure in-memory chat store - by explicit operator decision this service
 * does NOT persist chat data anywhere (Hostinger's MySQL wasn't reliably
 * reachable from outside, and a separate DB wasn't wanted either). Chat
 * history/tickets live only in this process's memory: they survive
 * reconnects and app close/reopen as long as the server process keeps
 * running, but are gone on any restart/redeploy/crash. No file, no DB.
 */

// Fixed - matches the real 3 topics confirmed via papa776.har, including
// their real createdAt/updatedAt (previously served from a DB table;
// hardcoded now since there's nothing to persist).
const TOPICS = [
  { oid: '6791e9794040440cc2242d75', name: 'Deposit', topic_key: 'deposit', description: '',
    created_at: new Date('2025-01-23T07:02:17.937Z'), updated_at: new Date('2026-06-11T06:05:29.761Z') },
  { oid: '6790e068484db7edd6e49775', name: 'Withdraw', topic_key: 'withdraw', description: '',
    created_at: new Date('2025-01-22T12:11:20.602Z'), updated_at: new Date('2026-06-11T06:03:59.493Z') },
  { oid: '6791e98a4040440cc2242d7f', name: 'Others', topic_key: 'others', description: '',
    created_at: new Date('2025-01-21T07:02:34.384Z'), updated_at: new Date('2026-06-11T06:03:53.014Z') },
];

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

/** userOid -> ticket object. One open ticket per user, matching the app's single "recent ticket" concept. */
const ticketsByUser = new Map();
/** ticketOid -> ticket object (same object as ticketsByUser's value) - O(1) lookup by id. */
const ticketsByOid = new Map();
/** ticketOid -> array of message objects, oldest first. */
const messagesByTicket = new Map();

function getTicketForUser(userOid) {
  return ticketsByUser.get(userOid) || null;
}

function getTicketByOid(ticketOid) {
  return ticketsByOid.get(ticketOid) || null;
}

function saveTicket(ticket) {
  ticketsByUser.set(ticket.user_oid, ticket);
  ticketsByOid.set(ticket.oid, ticket);
  return ticket;
}

function getMessages(ticketOid) {
  return messagesByTicket.get(ticketOid) || [];
}

function addMessage(ticketOid, message) {
  const list = messagesByTicket.get(ticketOid) || [];
  list.push(message);
  messagesByTicket.set(ticketOid, list);
  return message;
}

module.exports = {
  TOPICS,
  DEFAULT_AGENT,
  getTicketForUser,
  getTicketByOid,
  saveTicket,
  getMessages,
  addMessage,
};
