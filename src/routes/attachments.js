const express = require('express');
const multer = require('multer');
const { requireAuth } = require('../auth');
const { asyncRoute } = require('../asyncRoute');
const store = require('../store');
const { newObjectId } = require('../helpers');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024 } });

/**
 * POST /v1/api/upload-chat-attachment
 *
 * Files can't travel over a socket.io event, so the client uploads here
 * first (multipart, field "file") and gets back a URL, then emits
 * send-file-message with that URL - same two-phase pattern as the earlier
 * PHP endpoint of the same name, except the file itself is now stored as a
 * BLOB in this service's own MySQL (chat_attachments) rather than on the
 * PHP server's filesystem, per the operator's explicit "store chat and
 * attachments on mysql db" request.
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
  const kind = (req.file.mimetype || '').startsWith('image/') ? 'image' : 'document';

  res.json({
    status: 1,
    message: 'File uploaded successfully',
    result: {
      url: `${base}/v1/api/chat-attachment/${oid}`,
      attachmentType: kind,
      attachmentName: req.file.originalname || '',
      attachmentSize: req.file.size || 0,
    },
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

module.exports = router;
