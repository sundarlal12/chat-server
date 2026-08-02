const { verifyToken } = require('../auth');
const store = require('../store');
const { createOrGetTicket, insertMessage, markMessagesRead, httpError } = require('../chatLogic');
const { ticketDoc, messageDoc } = require('../docs');

/**
 * Real-time layer. Event names confirmed via decompiling
 * SupportChatActivity.java's field initializers (this.f7045g0 = "create-ticket",
 * etc.) - the full real vocabulary also includes agent-assigned,
 * submit-rating, incoming-call/call-ended, which are out of scope for this
 * pass (text + file attachments only, per the "Text + file attachments"
 * scope decision - no admin/agent side exists yet either, so
 * agent-assigned has nothing to trigger it).
 *
 * Connection auth matches the real client's pattern (confirmed in
 * papa776.har): wss://ca-api.papaji.dev/socket.io/?EIO=4&token=...
 * - the token is read from the handshake query string, not a header,
 * since socket.io's browser/OkHttp client can't set custom headers on the
 * initial upgrade the way a plain HTTP client can.
 *
 * Room model: one socket.io room per ticket (named by ticketId). Both the
 * customer and (eventually) an assigned agent join the same room, so
 * `io.to(ticketId).emit(...)` reaches whoever's connected on either side.
 */
function attachChatSocket(io) {
  io.use(async (socket, next) => {
    const token = socket.handshake.query?.token || socket.handshake.auth?.token;
    const user = await verifyToken(token);
    if (!user) { return next(new Error('Please authenticate')); }
    socket.user = user;
    next();
  });

  io.on('connection', (socket) => {
    const user = socket.user;

    // A user only ever has one non-closed ticket at a time (see
    // createOrGetTicket) - auto-join it on connect so receive-message/
    // typing/etc. reach them without a separate "join room" event.
    const existingTicket = store.getTicketForUser(String(user.oid));
    if (existingTicket && existingTicket.status !== 'closed') { socket.join(String(existingTicket.oid)); }

    socket.on('create-ticket', async (payload, ack) => {
      try {
        const ticket = await createOrGetTicket(user, payload || {});
        socket.join(String(ticket.oid));
        const doc = ticketDoc(ticket);
        io.to(String(ticket.oid)).emit('ticket-updated', doc);
        if (typeof ack === 'function') { ack({ status: 1, data: doc }); }
      } catch (e) {
        sendSocketError(socket, ack, e);
      }
    });

    const handleSend = (defaultMessageType) => async (payload, ack) => {
      try {
        const body = payload || {};
        if (!body.ticketId) { throw httpError(400, 'ticketId is required'); }
        const ticket = store.getTicketByOid(body.ticketId);
        if (!ticket) { throw httpError(404, 'Ticket not found'); }
        if (body.messageType === undefined) { body.messageType = defaultMessageType; }

        const message = await insertMessage(user, ticket, body);
        const doc = messageDoc(message);

        io.to(String(ticket.oid)).emit('receive-message', doc);
        socket.emit('message-delivered', { _id: doc._id, ticketId: doc.ticketId, deliveryStatus: 'sent' });
        if (typeof ack === 'function') { ack({ status: 1, data: doc }); }
      } catch (e) {
        sendSocketError(socket, ack, e);
      }
    };
    socket.on('send-message', handleSend(0));
    socket.on('send-file-message', handleSend(1));

    socket.on('typing', (payload) => {
      const ticketId = payload?.ticketId;
      if (ticketId) { socket.to(String(ticketId)).emit('typing', { ticketId, userId: String(user.oid) }); }
    });
    socket.on('stop-typing', (payload) => {
      const ticketId = payload?.ticketId;
      if (ticketId) { socket.to(String(ticketId)).emit('stop-typing', { ticketId, userId: String(user.oid) }); }
    });

    const handleRead = () => async (payload, ack) => {
      try {
        const ticketId = payload?.ticketId;
        if (!ticketId) { throw httpError(400, 'ticketId is required'); }
        const updated = await markMessagesRead(user, ticketId);
        io.to(String(ticketId)).emit('message-status-update', { ticketId, readBy: String(user.oid), updated });
        if (typeof ack === 'function') { ack({ status: 1, updated }); }
      } catch (e) {
        sendSocketError(socket, ack, e);
      }
    };
    socket.on('message-read', handleRead());
    socket.on('all-message-read', handleRead());
  });
}

function sendSocketError(socket, ack, e) {
  const status = e && e.httpStatus ? e.httpStatus : 500;
  const message = e && e.httpStatus ? e.message : 'Service temporarily unavailable';
  if (!(e && e.httpStatus)) { console.error(e); }
  if (typeof ack === 'function') { ack({ status: 0, code: status, message }); }
  else { socket.emit('error', { code: status, message }); }
}

module.exports = { attachChatSocket };
