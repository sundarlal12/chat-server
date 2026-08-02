const express = require('express');
const { requireAuth } = require('../auth');
const { createOrGetTicket, insertMessage, markMessagesRead } = require('../chatLogic');
const { ticketDoc, messageDoc } = require('../docs');
const store = require('../store');

const router = express.Router();

function handleError(res, e) {
  if (e && e.httpStatus) { return res.status(e.httpStatus).json({ code: e.httpStatus, message: e.message }); }
  console.error(e);
  return res.status(500).json({ code: 500, message: 'Service temporarily unavailable' });
}

/** POST /v1/api/create-ticket - see api/v1/api/create-ticket.php for the full contract comment. */
router.post('/create-ticket', requireAuth(), async (req, res) => {
  try {
    const ticket = await createOrGetTicket(req.chatUser, req.body || {});
    res.json({ status: 1, data: ticketDoc(ticket), message: 'Ticket created successfully' });
  } catch (e) { handleError(res, e); }
});

/** POST /v1/api/send-message - see api/v1/api/send-message.php for the full contract comment. */
router.post('/send-message', requireAuth(), async (req, res) => {
  try {
    const body = req.body || {};
    if (!body.ticketId) { return res.status(400).json({ code: 400, message: 'ticketId is required' }); }
    const ticket = store.getTicketByOid(body.ticketId);
    if (!ticket) { return res.status(404).json({ code: 404, message: 'Ticket not found' }); }
    const message = await insertMessage(req.chatUser, ticket, body);
    res.json({ status: 1, data: messageDoc(message), message: 'Message sent successfully' });
  } catch (e) { handleError(res, e); }
});

/** POST /v1/api/mark-messages-read - see api/v1/api/mark-messages-read.php for the full contract comment. */
router.post('/mark-messages-read', requireAuth(), async (req, res) => {
  try {
    const body = req.body || {};
    if (!body.ticketId) { return res.status(400).json({ code: 400, message: 'ticketId is required' }); }
    const updated = await markMessagesRead(req.chatUser, body.ticketId);
    res.json({ status: 1, message: 'Messages marked as read', result: { updated } });
  } catch (e) { handleError(res, e); }
});

module.exports = router;
