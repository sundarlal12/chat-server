const { verifyToken } = require('../auth');
const store = require('../store');
const { createOrGetTicket, insertMessage, markMessagesRead, submitRating, httpError } = require('../chatLogic');
const { rawTicketDoc, createdTicketDoc, socketMessageDoc } = require('../socketDocs');

/**
 * Real-time layer - rebuilt to match a REAL captured socket.io session
 * (raw Engine.IO frames from the live app) rather than guessed shapes.
 * Two things that trace corrected:
 *
 * 1. RESPONSE PATTERN: the server does NOT use socket.io ack callbacks.
 *    It responds to create-ticket/send-message/get-open-ticket/
 *    submit-rating/stop-typing by emitting the SAME event name back with
 *    the result (e.g. client emits "send-message", server later emits
 *    "send-message" again with {success, messageDoc}). Every handler
 *    below follows that pattern instead of using an ack callback.
 *
 * 2. FIELD NAMES: send-message's request field is `message` (not
 *    `content`), messageType 1 = text (confirmed from a real "H" text
 *    message), and the response wraps {success, message, messageDoc,
 *    isSent} rather than {status, data}.
 *
 * Also present in the real trace and added here: `get-open-ticket`,
 * `submit-rating`, and `user_status_change` (a platform-wide presence
 * broadcast to every connected socket on connect/disconnect - not scoped
 * to a ticket room). NOT reproduced: the AI auto-responder ("Ticket
 * created. AI is responding.") - the STRING is kept for exact response
 * format, but no AI actually replies, since that's a real backend feature
 * of its own, not just a message-format detail.
 *
 * Room model unchanged: one socket.io room per ticket (named by
 * ticketId). Both the customer and (eventually) an assigned agent join
 * the same room, so `io.to(ticketId).emit(...)` reaches whoever's
 * connected on either side.
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
    const userOid = String(user.oid);

    // Platform-wide presence - confirmed real, broadcast to every OTHER
    // connected socket (socket.broadcast already excludes the sender).
    socket.broadcast.emit('user_status_change', { userId: userOid, status: 'online' });
    socket.on('disconnect', () => {
      socket.broadcast.emit('user_status_change', { userId: userOid, status: 'offline' });
    });

    // A user only ever has one non-closed ticket at a time (see
    // createOrGetTicket) - auto-join it on connect so send-message/
    // typing/etc. reach them without a separate "join room" event.
    store.getTicketForUser(userOid)
      .then((t) => { if (t && t.status !== 'closed') { socket.join(String(t.oid)); } })
      .catch((e) => console.error('auto-join failed', e));

    socket.on('get-open-ticket', async () => {
      try {
        const ticket = await store.getTicketForUser(userOid);
        const open = ticket && ticket.status !== 'closed' ? ticket : null;
        socket.emit('get-open-ticket', { success: true, ticket: open ? rawTicketDoc(open) : null });
      } catch (e) {
        console.error(e);
        socket.emit('get-open-ticket', { success: false, message: 'Service temporarily unavailable' });
      }
    });

    socket.on('create-ticket', async (payload) => {
      try {
        const ticket = await createOrGetTicket(user, payload || {});
        socket.join(String(ticket.oid));
        socket.emit('create-ticket', {
          success: true,
          message: 'Ticket created. AI is responding.',
          ticket: createdTicketDoc(ticket),
        });
      } catch (e) {
        socket.emit('create-ticket', { success: false, message: e.httpStatus ? e.message : 'Service temporarily unavailable' });
        if (!e.httpStatus) { console.error(e); }
      }
    });

    socket.on('send-message', async (payload) => {
      try {
        const body = payload || {};
        if (!body.ticketId) { throw httpError(400, 'ticketId is required'); }
        const ticket = await store.getTicketByOid(body.ticketId);
        if (!ticket) { throw httpError(404, 'Ticket not found'); }

        const message = await insertMessage(user, ticket, body);
        const doc = socketMessageDoc(message);

        socket.emit('send-message', { success: true, message: 'Message sent successfully', messageDoc: doc, isSent: true });
        socket.to(String(ticket.oid)).emit('send-message', { success: true, message: 'Message sent successfully', messageDoc: doc });
      } catch (e) {
        socket.emit('send-message', { success: false, message: e.httpStatus ? e.message : 'Service temporarily unavailable' });
        if (!e.httpStatus) { console.error(e); }
      }
    });

    socket.on('typing', (payload) => {
      const ticketId = payload?.ticketId;
      if (!ticketId) { return; }
      socket.to(String(ticketId)).emit('typing', {
        ticketId, recipientId: payload.recipientId, userName: payload.userName,
      });
    });

    socket.on('stop-typing', (payload) => {
      const ticketId = payload?.ticketId;
      if (!ticketId) { return; }
      const out = { ticketId, userId: userOid, recipientId: payload.recipientId, success: true };
      socket.emit('stop-typing', out);
      socket.to(String(ticketId)).emit('stop-typing', out);
    });

    socket.on('all-message-read', async (payload) => {
      try {
        const ticketId = payload?.ticketId;
        if (!ticketId) { throw httpError(400, 'ticketId is required'); }
        await markMessagesRead(user, ticketId);
        socket.emit('all-message-read', { success: true, ticketId });
      } catch (e) {
        socket.emit('all-message-read', { success: false, message: e.httpStatus ? e.message : 'Service temporarily unavailable' });
        if (!e.httpStatus) { console.error(e); }
      }
    });

    socket.on('submit-rating', async (payload) => {
      try {
        const ticket = await submitRating(user, payload || {});
        io.to(String(ticket.oid)).emit('ticket-updated', { ticketId: String(ticket.oid), status: ticket.status });
        socket.emit('submit-rating', { success: true, message: 'Rating submitted successfully' });
      } catch (e) {
        socket.emit('submit-rating', { success: false, message: e.httpStatus ? e.message : 'Service temporarily unavailable' });
        if (!e.httpStatus) { console.error(e); }
      }
    });
  });
}

module.exports = { attachChatSocket };
