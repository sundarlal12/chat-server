const { verifyToken } = require('../auth');
const { verifyAdminToken } = require('../adminAuth');
const store = require('../store');
const {
  createOrGetTicket, insertMessage, insertAdminMessage, markMessagesRead, submitRating, httpError,
  normalizeFileMessageItem, resolveInlineAttachment, maybeAutoReplyToDepositGreeting,
} = require('../chatLogic');
const { rawTicketDoc, createdTicketDoc, socketMessageDoc, chatMessageEventName } = require('../socketDocs');
const { sendChatPushNotification, chatPushBody } = require('../push');

/** Every admin socket joins this room on connect, so an `io.to(ADMIN_ROOM).emit(...)` reaches every logged-in admin regardless of which ticket (if any) they currently have open - used for the ticket-list "something happened" live signal. */
const ADMIN_ROOM = '__admins__';

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
    try {
      // Admin panel connects with ?adminToken=... instead of ?token=... - a
      // deliberately separate query param (rather than trying the customer
      // token verifier first) so the two auth schemes can't be confused with
      // each other. See src/adminAuth.js for the admin JWT scheme.
      const adminToken = socket.handshake.query?.adminToken || socket.handshake.auth?.adminToken;
      if (adminToken) {
        const admin = await verifyAdminToken(adminToken);
        if (!admin) { return next(new Error('Please authenticate')); }
        socket.isAdmin = true;
        socket.admin = admin;
        return next();
      }

      const token = socket.handshake.query?.token || socket.handshake.auth?.token;
      const user = await verifyToken(token);
      if (!user) { return next(new Error('Please authenticate')); }
      socket.user = user;
      next();
    } catch (e) {
      // Without this, a rejected promise here (e.g. PHP timing out - see
      // phpApi.js) never calls next() at all, so the connecting client
      // just hangs forever instead of getting a clean auth error - this
      // is exactly what made a slow PHP connection look like the whole
      // chat feature was broken rather than one failed request.
      console.error('socket auth middleware error:', e);
      next(new Error('Please authenticate'));
    }
  });

  io.on('connection', (socket) => {
    if (socket.isAdmin) { return attachAdminHandlers(io, socket); }

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
        const ticketDocOut = createdTicketDoc(ticket);
        socket.emit('create-ticket', {
          success: true,
          message: 'Ticket created. AI is responding.',
          ticket: ticketDocOut,
        });
        io.to(ADMIN_ROOM).emit('admin:ticket-activity', { ticketId: String(ticket.oid), lastActivity: ticketDocOut.lastActivity });
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
        io.to(ADMIN_ROOM).emit('admin:ticket-activity', { ticketId: String(ticket.oid), lastActivity: doc.createdAt });

        // `ticket` is still the pre-message snapshot fetched above - see
        // chatLogic.js's maybeAutoReplyToDepositGreeting for why that's
        // exactly what it needs to tell a first message apart from a later
        // one. Broadcast to the whole room (not just socket.to, which
        // excludes the sender) since this is the AGENT talking, not the
        // customer - the customer sending the greeting needs to see it too.
        // Sends the image and its follow-up text as two separate
        // messages/events, in order - see maybeAutoReplyToDepositGreeting's
        // own comment for why, and chatMessageEventName for why each one
        // may go out under a different event name/shape.
        const autoReplies = await maybeAutoReplyToDepositGreeting(ticket, message);
        for (const reply of autoReplies) {
          const autoDoc = socketMessageDoc(reply);
          const eventName = chatMessageEventName(reply);
          const out = eventName === 'send-file-message'
            ? { success: true, message: 'File message sent successfully', messageDocs: [autoDoc] }
            : { success: true, message: 'Message sent successfully', messageDoc: autoDoc };
          io.to(String(ticket.oid)).emit(eventName, out);
          // Also under "send-message" for the image - see the matching
          // comment on admin-send-message above for why (an unprompted
          // attachment via send-file-message alone was reported not
          // rendering live on the customer side).
          if (eventName === 'send-file-message') {
            io.to(String(ticket.oid)).emit('send-message', { success: true, message: 'Message sent successfully', messageDoc: autoDoc });
          }
          io.to(ADMIN_ROOM).emit('admin:ticket-activity', { ticketId: String(ticket.oid), lastActivity: autoDoc.createdAt });
        }
      } catch (e) {
        socket.emit('send-message', { success: false, message: e.httpStatus ? e.message : 'Service temporarily unavailable' });
        if (!e.httpStatus) { console.error(e); }
      }
    });

    // Distinct from "send-message" - confirmed via the decompiled app
    // (SupportChatActivity has two SEPARATE Emitter.Listeners, "send-message"
    // and "send-file-message"). Payload is an ARRAY (one entry per attached
    // file, for multi-select sends), each item normalized via
    // normalizeFileMessageItem.
    //
    // Confirmed via a live captured socket.io trace (a real send-file-message
    // round trip, settling what the decompiled bytecode alone couldn't):
    // the app's actual request payload is JUST
    // [{recipientId, ticketId, messageType}] - no URL, no file bytes at all
    // - and the real backend replies with ONE event carrying a plural
    // `messageDocs` array (not one `messageDoc` emission per item, which is
    // what this used to send), message text "File message sent
    // successfully", and each doc as a "sending" placeholder (content
    // "File", attachmentUrl null) since no attachment was actually
    // referenced. See insertMessage in chatLogic.js for the placeholder
    // logic this relies on.
    socket.on('send-file-message', async (payload) => {
      const items = Array.isArray(payload) ? payload : [payload];
      let ticketOid = null;

      try {
        const docs = [];
        for (const raw of items) {
          let body = normalizeFileMessageItem(raw || {});
          // No URL-shaped field found - best-effort fallback in case the
          // app ever does embed the file as inline base64 instead of a
          // pre-uploaded URL (see resolveInlineAttachment's comment); the
          // real captured payload above has neither, which is exactly what
          // falls through to chatLogic's "sending" placeholder.
          if (!body.attachmentUrl) {
            const inline = await resolveInlineAttachment(user, raw || {});
            if (inline) { body = { ...body, ...inline }; }
          }
          if (!body.ticketId) { throw httpError(400, 'ticketId is required'); }
          const ticket = await store.getTicketByOid(body.ticketId);
          if (!ticket) { throw httpError(404, 'Ticket not found'); }
          ticketOid = String(ticket.oid);

          const message = await insertMessage(user, ticket, body);
          docs.push(socketMessageDoc(message));
        }

        socket.emit('send-file-message', { success: true, message: 'File message sent successfully', messageDocs: docs, isSent: true });
        socket.to(ticketOid).emit('send-file-message', { success: true, message: 'File message sent successfully', messageDocs: docs });
        io.to(ADMIN_ROOM).emit('admin:ticket-activity', { ticketId: ticketOid, lastActivity: docs[docs.length - 1]?.createdAt });
      } catch (e) {
        socket.emit('send-file-message', { success: false, message: e.httpStatus ? e.message : 'Service temporarily unavailable' });
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

/**
 * Admin panel side of the same socket - shares the customer flow's room
 * model (one room per ticketId) so a message sent/received on either side
 * reaches both, but an admin doesn't auto-join anything on connect (they
 * pick a ticket from the panel's list first) and instead of one fixed
 * ticket per connection can join/leave rooms as they switch between open
 * conversations.
 */
function attachAdminHandlers(io, socket) {
  socket.join(ADMIN_ROOM);

  socket.on('join-ticket', ({ ticketId } = {}) => {
    if (!ticketId) { return; }
    socket.join(String(ticketId));
  });

  socket.on('leave-ticket', ({ ticketId } = {}) => {
    if (!ticketId) { return; }
    socket.leave(String(ticketId));
  });

  socket.on('admin-send-message', async (payload) => {
    try {
      const body = payload || {};
      if (!body.ticketId) { throw httpError(400, 'ticketId is required'); }
      const ticket = await store.getTicketByOid(body.ticketId);
      if (!ticket) { throw httpError(404, 'Ticket not found'); }

      const message = await insertAdminMessage(socket.admin, ticket, body);
      const doc = socketMessageDoc(message);

      // Attachments go out under "send-file-message" - the app's dedicated
      // attachment listener - with its confirmed real shape (plural
      // `messageDocs` array, not the singular `messageDoc` "send-message"
      // uses). Reported: this arrives fine when the customer is the one
      // sending (ack to their own request), but an unprompted attachment
      // FROM the admin doesn't render live - only after the customer
      // leaves the chat and comes back (a fresh REST fetch). The only real
      // captured trace of "send-file-message" is a customer's own
      // upload-ack, never an incoming one from someone else, so it's
      // plausible the app's listener there only matches acks to its own
      // in-flight upload and silently drops anything else. ALSO
      // broadcasting under "send-message" (confirmed always rendering
      // live, including admin-initiated ones) hedges against that - a
      // customer client that already reads the un-hedged event correctly
      // would just see the same message twice, which is a lesser problem
      // than never seeing it until reload.
      const eventName = chatMessageEventName(message);
      const out = eventName === 'send-file-message'
        ? { success: true, message: 'File message sent successfully', messageDocs: [doc] }
        : { success: true, message: 'Message sent successfully', messageDoc: doc };
      io.to(String(ticket.oid)).emit(eventName, out);
      if (eventName === 'send-file-message') {
        io.to(String(ticket.oid)).emit('send-message', { success: true, message: 'Message sent successfully', messageDoc: doc });
      }
      io.to(ADMIN_ROOM).emit('admin:ticket-activity', { ticketId: String(ticket.oid), lastActivity: doc.createdAt });

      // Skip the push if the customer is already live in this ticket's
      // room - they'll see the message arrive instantly via the emits
      // above, so a push there would be redundant (reported as wrong).
      // Not awaited - see the matching comment in admin.js's REST route
      // for why (push failures are self-contained in push.js and
      // shouldn't hold up this handler).
      if (!isCustomerConnected(io, ticket.oid)) {
        sendChatPushNotification(ticket.customer_fcm_token, {
          title: String(ticket.agent_name || 'Support'),
          body: chatPushBody(message),
          ticketId: ticket.oid,
        });
      }
    } catch (e) {
      socket.emit('admin-send-message', { success: false, message: e.httpStatus ? e.message : 'Service temporarily unavailable' });
      if (!e.httpStatus) { console.error(e); }
    }
  });
}

/**
 * Whether the CUSTOMER (not an admin who's also viewing this ticket) has
 * a live socket currently in this ticket's room - used to skip the push
 * notification when they're already looking at the chat and will see the
 * message arrive live (reported: getting a push while already in the open
 * chat is wrong/redundant). Reads socket.io's own local room/socket
 * registries directly (io.sockets.adapter.rooms / io.sockets.sockets) -
 * synchronous and returns the real Socket instances (with the .isAdmin
 * flag the auth middleware above sets), unlike the async fetchSockets()
 * API which only exposes a serialized subset of each socket's data and
 * wouldn't carry that flag. Single-process only (no Redis adapter is
 * configured here) - fine for how this service is actually deployed.
 */
function isCustomerConnected(io, ticketOid) {
  const room = io.sockets.adapter.rooms.get(String(ticketOid));
  if (!room) { return false; }
  for (const socketId of room) {
    const s = io.sockets.sockets.get(socketId);
    if (s && !s.isAdmin) { return true; }
  }
  return false;
}

module.exports = { attachChatSocket, ADMIN_ROOM, isCustomerConnected };
