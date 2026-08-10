const express = require('express');
const multer = require('multer');
const { asyncRoute } = require('../asyncRoute');
const { verifyPassword, issueAdminToken, requireAdminAuth } = require('../adminAuth');
const { insertAdminMessage, closeTicketAsAdmin } = require('../chatLogic');
const { ticketDoc, messageDoc } = require('../docs');
const { socketMessageDoc, chatMessageEventName } = require('../socketDocs');
const { ADMIN_ROOM, isCustomerConnected } = require('../socket');
const store = require('../store');
const { newObjectId } = require('../helpers');
const { classify, ALLOWED_DESCRIPTION } = require('../attachmentPolicy');
const { sendChatPushNotification, chatPushBody } = require('../push');
const whatsapp = require('../whatsapp');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const match = classify(file.mimetype, file.originalname);
    if (!match) {
      const e = new Error(`Unsupported file type - only ${ALLOWED_DESCRIPTION} are allowed`);
      e.httpStatus = 400;
      return cb(e);
    }
    file.attachmentMatch = match;
    cb(null, true);
  },
});

/** Adds customer_* ticket columns (not part of the customer-facing ticketDoc) for the admin ticket list/header. */
function adminTicketDoc(row) {
  return {
    ...ticketDoc(row),
    customerName: row.customer_name || '',
    customerFullName: row.customer_full_name || '',
    customerProfilePic: row.customer_profile_pic || '',
    customerPhone: row.customer_phone || '',
  };
}

/**
 * Admin REST API, mounted at /admin/api (see server.js). Needs `io` to
 * broadcast a sent reply into the ticket's socket.io room (same room/event
 * name the customer app already listens on - see src/socket/index.js) so a
 * reply sent from this REST endpoint still arrives on the customer's
 * connected socket live, not just on next poll.
 */
function createAdminRouter(io) {
  const router = express.Router();

  /** POST /admin/api/login */
  router.post('/login', asyncRoute(async (req, res) => {
    const { username, password } = req.body || {};
    if (!username || !password) {
      return res.status(400).json({ code: 400, message: 'username and password are required' });
    }
    const admin = await store.getAdminByUsername(String(username).trim());
    if (!admin || !verifyPassword(password, admin.password_hash)) {
      return res.status(401).json({ code: 401, message: 'Invalid username or password' });
    }
    res.json({
      status: 1,
      token: issueAdminToken(admin),
      admin: { username: admin.username, displayName: admin.display_name || admin.username },
    });
  }));

  router.use(requireAdminAuth());

  /** GET /admin/api/tickets?status=&search=&limit=&offset= - most recently active first. search matches customer name/full name/mobile (operator request - fast lookup). */
  router.get('/tickets', asyncRoute(async (req, res) => {
    const status = (req.query.status || '').trim() || undefined;
    const search = (req.query.search || '').trim() || undefined;
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const offset = Number(req.query.offset) || 0;
    const [rows, total] = await Promise.all([
      store.getAllTickets({ status, search, limit, offset }),
      store.countAllTickets({ status, search }),
    ]);
    res.json({ status: 1, total, data: rows.map(adminTicketDoc) });
  }));

  /**
   * GET /admin/api/customers/:userOid/tickets - every ticket (any status)
   * for one customer, newest first (operator request: "previous chats
   * with this customer", not just whichever one is currently open/being
   * viewed).
   */
  router.get('/customers/:userOid/tickets', asyncRoute(async (req, res) => {
    const rows = await store.getTicketsForUserOid(req.params.userOid);
    res.json({ status: 1, data: rows.map(adminTicketDoc) });
  }));

  /** GET /admin/api/tickets/:oid/messages - full history, oldest first. */
  router.get('/tickets/:oid/messages', asyncRoute(async (req, res) => {
    const ticket = await store.getTicketByOid(req.params.oid);
    if (!ticket) { return res.status(404).json({ code: 404, message: 'Ticket not found' }); }
    const messages = await store.getMessages(String(ticket.oid));
    res.json({ status: 1, ticket: adminTicketDoc(ticket), data: messages.map(messageDoc) });
  }));

  /** POST /admin/api/tickets/:oid/messages - admin reply, broadcast live via socket.io. */
  router.post('/tickets/:oid/messages', asyncRoute(async (req, res) => {
    const ticket = await store.getTicketByOid(req.params.oid);
    if (!ticket) { return res.status(404).json({ code: 404, message: 'Ticket not found' }); }
    const message = await insertAdminMessage(req.admin, ticket, req.body || {});

    // "send-file-message" carries a plural `messageDocs` array (confirmed
    // via a live captured trace), not the singular `messageDoc` the plain
    // "send-message" event uses - same split as chatLogic.js's socket
    // handlers for the same two events. ALSO broadcasting under
    // "send-message" for attachments too - see the matching comment in
    // socket/index.js's admin-send-message handler for why (reported: an
    // admin-sent attachment doesn't render live on the customer side,
    // only after they leave and reopen the chat).
    const eventName = chatMessageEventName(message);
    const doc = socketMessageDoc(message);
    io.to(String(ticket.oid)).emit(eventName, eventName === 'send-file-message'
      ? { success: true, message: 'File message sent successfully', messageDocs: [doc] }
      : { success: true, message: 'Message sent successfully', messageDoc: doc });
    if (eventName === 'send-file-message') {
      io.to(String(ticket.oid)).emit('send-message', { success: true, message: 'Message sent successfully', messageDoc: doc });
    }
    io.to(ADMIN_ROOM).emit('admin:ticket-activity', { ticketId: String(ticket.oid), lastActivity: messageDoc(message).createdAt });

    res.json({ status: 1, data: messageDoc(message), message: 'Message sent successfully' });

    // Skip if the customer is already live in this ticket's room - they'll
    // see the message arrive instantly via the broadcast above, so a push
    // there would be redundant (reported as wrong). Not awaited - a push
    // failure/slow FCM call shouldn't hold up the response, and
    // sendChatPushNotification already swallows its own errors (see
    // push.js).
    if (!isCustomerConnected(io, ticket.oid)) {
      sendChatPushNotification(ticket.customer_fcm_token, {
        title: String(ticket.agent_name || 'Support'),
        body: chatPushBody(message),
        ticketId: ticket.oid,
        messageDoc: doc,
      });
    }
  }));

  /**
   * POST /admin/api/tickets/:oid/close - admin manually ends the chat
   * (operator request - previously only the customer closing via
   * submit-rating ever changed a ticket's status, so a ticket a customer
   * never explicitly rated just stayed "open" indefinitely). Broadcasts
   * "ticket-updated" - the same event submit-rating already uses - so the
   * customer's own app reacts the same way regardless of who closed it.
   *
   * Optional rating/feedback (the admin close dialog always sends one -
   * see public/admin/index.html): rather than trust the customer's app to
   * render an unfamiliar rating field on an admin-side closure, this posts
   * it as a normal chat message FIRST (same broadcast/push path
   * POST .../messages already uses, so it's guaranteed visible in their
   * chat history and triggers the same push notification), then closes
   * the ticket with the rating attached to the DB row too. Message has to
   * go in before the close - insertAdminMessage refuses to post into an
   * already-closed ticket.
   */
  router.post('/tickets/:oid/close', asyncRoute(async (req, res) => {
    const ticket = await store.getTicketByOid(req.params.oid);
    if (!ticket) { return res.status(404).json({ code: 404, message: 'Ticket not found' }); }

    const { rating, feedback } = req.body || {};
    const hasRating = rating !== undefined && rating !== null && rating !== '';
    const ratingNum = hasRating ? Number(rating) : null;
    // Validated up front, matching closeTicketAsAdmin's own check - the
    // closing message below has to go in BEFORE the ticket closes (see
    // this route's comment), so validating late would let an invalid
    // rating leave a "chat closed" message sent to the customer while the
    // close itself then fails.
    if (hasRating && (!Number.isInteger(ratingNum) || ratingNum < 1 || ratingNum > 5)) {
      return res.status(400).json({ code: 400, message: 'rating must be an integer 1-5' });
    }

    let closingMessage = null;
    if (hasRating) {
      const stars = '⭐'.repeat(ratingNum);
      const feedbackText = String(feedback || '').trim();
      const text = feedbackText ? `Chat closed. Rating: ${stars} (${ratingNum}/5)\n${feedbackText}` : `Chat closed. Rating: ${stars} (${ratingNum}/5)`;
      closingMessage = await insertAdminMessage(req.admin, ticket, { message: text });
    }

    const updated = await closeTicketAsAdmin(ticket, { rating: hasRating ? ratingNum : undefined, feedback });

    if (closingMessage) {
      const doc = socketMessageDoc(closingMessage);
      io.to(String(ticket.oid)).emit('send-message', { success: true, message: 'Message sent successfully', messageDoc: doc });
      io.to(ADMIN_ROOM).emit('admin:ticket-activity', { ticketId: String(ticket.oid), lastActivity: messageDoc(closingMessage).createdAt });
      // Unlike a normal reply (skipped when isCustomerConnected - see
      // POST .../messages above), this push always fires. A ticket close
      // is a one-time terminal event, not one more message in an ongoing
      // conversation: "socket connected" only means the app has a live
      // connection, not that it's in the foreground right now - a
      // customer with the app merely backgrounded would otherwise get a
      // silent socket event with no OS notification at all and no other
      // way to learn their chat ended. A distinct title (not the generic
      // agent-name one regular replies use) keeps it recognizable in the
      // notification tray instead of blending in as just another message.
      sendChatPushNotification(ticket.customer_fcm_token, {
        title: 'Chat Ended',
        body: chatPushBody(closingMessage),
        ticketId: ticket.oid,
        messageDoc: doc,
      });
    }

    io.to(String(ticket.oid)).emit('ticket-updated', { ticketId: String(ticket.oid), status: updated.status, rating: updated.rating || null, feedback: updated.feedback || '' });
    io.to(ADMIN_ROOM).emit('admin:ticket-activity', { ticketId: String(ticket.oid), lastActivity: adminTicketDoc(updated).lastActivity });
    res.json({ status: 1, data: adminTicketDoc(updated), message: 'Ticket closed' });
  }));

  /** POST /admin/api/upload - same chat_attachments BLOB storage the customer-side upload uses. */
  router.post('/upload', upload.single('file'), asyncRoute(async (req, res) => {
    if (!req.file) { return res.status(400).json({ code: 400, message: 'file is required' }); }

    const oid = newObjectId();
    await store.insertAttachment({
      oid,
      uploader_oid: String(req.admin.oid),
      original_name: req.file.originalname || '',
      mime_type: req.file.mimetype || 'application/octet-stream',
      size_bytes: req.file.size || 0,
      data: req.file.buffer,
    });

    const base = process.env.PUBLIC_BASE_URL || `${req.protocol}://${req.get('host')}`;
    res.json({
      status: 1,
      message: 'File uploaded successfully',
      result: {
        url: `${base}/v1/api/chat-attachment/${oid}`,
        attachmentType: req.file.attachmentMatch.kind,
        attachmentName: req.file.originalname || '',
        attachmentSize: req.file.size || 0,
      },
    });
  }));

  /** GET /admin/api/whatsapp/status - poll for the WhatsApp connection state + QR (see public/admin/whatsapp.html). */
  router.get('/whatsapp/status', (req, res) => {
    res.json({ status: 1, data: whatsapp.getStatus() });
  });

  /** POST /admin/api/whatsapp/reconnect - manually (re)start the connection, e.g. after an intentional logout from the phone. */
  router.post('/whatsapp/reconnect', asyncRoute(async (req, res) => {
    whatsapp.start();
    res.json({ status: 1, message: 'Reconnect started' });
  }));

  /** POST /admin/api/whatsapp/disconnect - unlink the connected number and clear the saved session. */
  router.post('/whatsapp/disconnect', asyncRoute(async (req, res) => {
    await whatsapp.disconnect();
    res.json({ status: 1, message: 'Disconnected' });
  }));

  return router;
}

module.exports = { createAdminRouter };
