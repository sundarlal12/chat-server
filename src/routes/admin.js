const express = require('express');
const multer = require('multer');
const { asyncRoute } = require('../asyncRoute');
const { verifyPassword, issueAdminToken, requireAdminAuth } = require('../adminAuth');
const { insertAdminMessage } = require('../chatLogic');
const { ticketDoc, messageDoc } = require('../docs');
const { socketMessageDoc, chatMessageEventName } = require('../socketDocs');
const { ADMIN_ROOM } = require('../socket');
const store = require('../store');
const { newObjectId } = require('../helpers');
const { classify, ALLOWED_DESCRIPTION } = require('../attachmentPolicy');

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

  /** GET /admin/api/tickets?status=&limit=&offset= - most recently active first. */
  router.get('/tickets', asyncRoute(async (req, res) => {
    const status = (req.query.status || '').trim() || undefined;
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const offset = Number(req.query.offset) || 0;
    const [rows, total] = await Promise.all([
      store.getAllTickets({ status, limit, offset }),
      store.countAllTickets({ status }),
    ]);
    res.json({ status: 1, total, data: rows.map(adminTicketDoc) });
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

    io.to(String(ticket.oid)).emit(chatMessageEventName(message), {
      success: true,
      message: 'Message sent successfully',
      messageDoc: socketMessageDoc(message),
    });
    io.to(ADMIN_ROOM).emit('admin:ticket-activity', { ticketId: String(ticket.oid), lastActivity: messageDoc(message).createdAt });

    res.json({ status: 1, data: messageDoc(message), message: 'Message sent successfully' });
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

  return router;
}

module.exports = { createAdminRouter };
