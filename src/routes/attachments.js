const express = require('express');
const multer = require('multer');
const { requireAuth } = require('../auth');
const { asyncRoute } = require('../asyncRoute');
const store = require('../store');
const { newObjectId } = require('../helpers');
const { socketMessageDoc } = require('../socketDocs');
const { ADMIN_ROOM } = require('../socket');
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

/**
 * Needs `io` for the optional finalize-in-place step below - broadcasting
 * an update into the ticket's socket.io room, same as admin.js's router.
 */
function createAttachmentsRouter(io) {
  const router = express.Router();

  /**
   * POST /v1/api/upload-chat-attachment
   *
   * Files can't travel over a socket.io event, so this is where the actual
   * bytes go (multipart, field "file"), stored as a BLOB in this service's
   * own MySQL (chat_attachments) rather than on disk, per the operator's
   * explicit "store chat and attachments on mysql db" request.
   *
   * Optional field "messageId": a live captured trace confirmed the app's
   * send-file-message socket event carries no file reference at all - it
   * just creates a "sending" placeholder message (see insertMessage in
   * chatLogic.js). That placeholder's `_id` is returned to the client in
   * the socket ack, so if it's passed back here alongside the file, this
   * finalizes THAT message in place (attachment fields + deliveryStatus
   * "sent") instead of only minting a standalone URL, and broadcasts the
   * update into the ticket's room so an already-open chat updates live
   * rather than only on next fetch. No trace of the real app's own
   * follow-up call exists to confirm this is its exact shape (this capture
   * only had socket.io frames, no HTTP) - this is our own best-effort
   * completion of the confirmed placeholder/finalize pattern.
   *
   * Response: {status, message, result: {url, attachmentType, attachmentName, attachmentSize}}
   */
  router.post('/upload-chat-attachment', requireAuth(), upload.single('file'), asyncRoute(async (req, res) => {
    if (!req.file) { return res.status(400).json({ code: 400, message: 'file is required' }); }

    const oid = newObjectId();
    await store.insertAttachment({
      oid,
      uploader_oid: String(req.chatUser.oid),
      original_name: req.file.originalname || '',
      mime_type: req.file.mimetype || 'application/octet-stream',
      size_bytes: req.file.size || 0,
      data: req.file.buffer,
    });

    const base = process.env.PUBLIC_BASE_URL || `${req.protocol}://${req.get('host')}`;
    const url = `${base}/v1/api/chat-attachment/${oid}`;
    const attachmentType = req.file.attachmentMatch.kind;
    const attachmentName = req.file.originalname || '';
    const attachmentSize = req.file.size || 0;

    const messageId = (req.body.messageId || '').trim();
    if (messageId) {
      const placeholder = await store.getMessageByOid(messageId);
      // Only finalize a message that's genuinely this user's own pending
      // placeholder - never let a passed-in messageId touch someone else's
      // message or one that's already been finalized/isn't a file message.
      if (placeholder && String(placeholder.sender_oid) === String(req.chatUser.oid) && placeholder.delivery_status === 'sending') {
        const updated = await store.updateMessage(messageId, {
          attachment_url: url,
          attachment_type: attachmentType,
          attachment_name: attachmentName,
          attachment_size: attachmentSize,
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
  }));

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
    res.set('Content-Disposition', `inline; filename="${(row.original_name || 'file').replace(/"/g, '')}"`);
    res.send(row.data);
  }));

  return router;
}

module.exports = { createAttachmentsRouter };
