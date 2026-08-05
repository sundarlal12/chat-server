const express = require('express');
const multer = require('multer');
const { requireAuth } = require('../auth');
const { asyncRoute } = require('../asyncRoute');
const store = require('../store');
const { newObjectId } = require('../helpers');
const { socketMessageDoc } = require('../socketDocs');
const { ADMIN_ROOM } = require('../socket');
const { classify, sniffKind, ALLOWED_DESCRIPTION } = require('../attachmentPolicy');

const upload = multer({
  storage: multer.memoryStorage(),
  // Modern phone camera/gallery photos routinely run 8-15MB - the old 8MB
  // cap was rejecting real gallery picks outright (fileFilter/limits both
  // run before the route handler, so that's a bare 400/413 with no file
  // stored, indistinguishable from "upload is broken" on the client side).
  limits: { fileSize: 20 * 1024 * 1024 },
  // Cheap pre-filter only, on the client-claimed Content-Type/filename -
  // NOT the security boundary. makeUploadHandler below re-verifies the
  // actual received bytes via sniffKind() and that's what's authoritative;
  // this just avoids spending bandwidth/memory on an obviously-wrong type
  // before the body is even read.
  fileFilter: (req, file, cb) => {
    const match = classify(file.mimetype, file.originalname);
    if (!match) {
      const e = new Error(`Unsupported file type - only ${ALLOWED_DESCRIPTION} are allowed`);
      e.httpStatus = 400;
      return cb(e);
    }
    cb(null, true);
  },
});

/**
 * Shared by both upload routes below (see each router's own comment for
 * which path is which). Needs `io` to broadcast a finalized message update
 * into the ticket's socket.io room, same as admin.js's router.
 *
 * Optional field "messageId": a live captured trace confirmed the app's
 * send-file-message socket event carries no file reference at all - it
 * just creates a "sending" placeholder message (see insertMessage in
 * chatLogic.js). That placeholder's `_id` is returned to the client in the
 * socket ack. A SEPARATE live captured request confirmed the real client
 * does pass that id back here (as "messageId", alongside "ticketId",
 * "recipientId", "caption", "duration") to finalize the same message in
 * place (real attachment fields + caption/duration + deliveryStatus
 * "sent") rather than only minting a standalone URL - this also broadcasts
 * the update into the ticket's room so an already-open chat updates live
 * instead of only on next fetch. ticketId/recipientId aren't otherwise
 * used here - the placeholder message row already carries that
 * information reliably (found via messageId), so trusting a client-passed
 * ticketId for room targeting isn't necessary.
 */
function makeUploadHandler(io) {
  return asyncRoute(async (req, res) => {
    if (!req.file) { return res.status(400).json({ code: 400, message: 'file is required' }); }

    // The security boundary: verify what was actually received, not what
    // the client's multipart headers claimed. Content-Type and filename
    // are both attacker-controlled - without this, a request could declare
    // "image/jpeg" while sending arbitrary bytes (a PHP/HTML/script
    // payload), which would then be stored AND later served back by
    // GET /chat-attachment/:oid with that same claimed, unverified
    // Content-Type. sniffKind() only recognizes the exact magic bytes of
    // this policy's allowed formats, so anything else - including any
    // attempt to sneak in a server-side-executable file type - is rejected
    // outright here regardless of what it claimed to be.
    const sniffed = sniffKind(req.file.buffer);
    if (!sniffed) {
      return res.status(400).json({ code: 400, message: `File content doesn't match a supported format - only ${ALLOWED_DESCRIPTION} are allowed` });
    }

    const oid = newObjectId();
    await store.insertAttachment({
      oid,
      uploader_oid: String(req.chatUser.oid),
      original_name: req.file.originalname || '',
      // Verified mimetype, not the client-claimed req.file.mimetype - this
      // is exactly what GET /chat-attachment/:oid later serves back as
      // Content-Type, so it has to be trustworthy.
      mime_type: sniffed.mimetypes[0],
      size_bytes: req.file.size || 0,
      data: req.file.buffer,
    });

    const base = process.env.PUBLIC_BASE_URL || `${req.protocol}://${req.get('host')}`;
    const url = `${base}/v1/api/chat-attachment/${oid}`;
    const attachmentType = sniffed.kind;
    const attachmentName = req.file.originalname || '';
    const attachmentSize = req.file.size || 0;

    const messageId = (req.body.messageId || '').trim();
    if (messageId) {
      const placeholder = await store.getMessageByOid(messageId);
      // Only finalize a message that's genuinely this user's own pending
      // placeholder - never let a passed-in messageId touch someone else's
      // message or one that's already been finalized/isn't a file message.
      if (placeholder && String(placeholder.sender_oid) === String(req.chatUser.oid) && placeholder.delivery_status === 'sending') {
        const caption = (req.body.caption || '').trim();
        const duration = req.body.duration !== undefined && req.body.duration !== null && req.body.duration !== '' ? Number(req.body.duration) : 0;
        const updated = await store.updateMessage(messageId, {
          attachment_url: url,
          attachment_type: attachmentType,
          attachment_name: attachmentName,
          attachment_size: attachmentSize,
          caption,
          duration,
          delivery_status: 'sent',
        });
        const doc = socketMessageDoc(updated);
        io.to(String(updated.ticket_oid)).emit('send-file-message', { success: true, message: 'File message sent successfully', messageDocs: [doc] });
        io.to(ADMIN_ROOM).emit('admin:ticket-activity', { ticketId: String(updated.ticket_oid), lastActivity: doc.updatedAt });
      }
    }

    res.json({
      status: 1,
      message: 'File uploaded successfully',
      result: { url, attachmentType, attachmentName, attachmentSize },
    });
  });
}

function createAttachmentsRouter(io) {
  const router = express.Router();

  /**
   * POST /v1/api/upload-chat-attachment - see makeUploadHandler's comment
   * for the shared upload/finalize logic. Kept alongside the confirmed
   * real path below since nothing rules out it also being called (this
   * was our own best-effort guess at the endpoint name before the real one
   * was confirmed via a live capture).
   */
  router.post('/upload-chat-attachment', requireAuth(), upload.single('file'), makeUploadHandler(io));

  /**
   * GET /v1/api/chat-attachment/:oid
   *
   * Streams the stored file back. Deliberately not auth-gated (a bearer
   * token header isn't something <img>/media-player URLs can attach) - the
   * oid itself is an unguessable random id, the same security model the
   * prior PHP-hosted static file URLs used.
   */
  router.get('/chat-attachment/:oid', asyncRoute(async (req, res) => {
    const row = await store.getAttachment(req.params.oid);
    if (!row) { return res.status(404).json({ code: 404, message: 'Not found' }); }
    res.set('Content-Type', row.mime_type || 'application/octet-stream');
    // Defense in depth on top of the upload-time content verification -
    // stops a browser from ever content-sniffing a served attachment into
    // something more dangerous than its stored (verified) Content-Type.
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('Content-Disposition', `inline; filename="${(row.original_name || 'file').replace(/"/g, '')}"`);
    res.send(row.data);
  }));

  return router;
}

/**
 * POST /v1/admin/tickets/file-upload - the REAL endpoint, confirmed via a
 * live captured multipart request (fields: duration, recipientId, caption,
 * messageId, ticketId, file). Despite the "admin" path segment, the
 * captured request's recipientId matched the ticket AGENT's oid (i.e. the
 * CUSTOMER sending an attachment to their assigned agent) - same
 * chat_auth_user()-style bearer token as every other /v1/api/* customer
 * route, not the separate admin-panel JWT auth. "admin" here is
 * apparently just this endpoint's own URL namespace on the real backend,
 * not a restricted-to-admin-users route.
 */
function createTicketFileUploadRouter(io) {
  const router = express.Router();
  router.post('/tickets/file-upload', requireAuth(), upload.single('file'), makeUploadHandler(io));
  return router;
}

module.exports = { createAttachmentsRouter, createTicketFileUploadRouter };
