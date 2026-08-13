const express = require('express');
const { requireAuth } = require('../auth');
const { createOrGetTicket, insertMessage, markMessagesRead, submitRating, maybeAutoReplyToDepositGreeting } = require('../chatLogic');
const { ticketDoc, messageDoc } = require('../docs');
const { socketMessageDoc, chatMessageEventName } = require('../socketDocs');
const { ADMIN_ROOM } = require('../socket');
const store = require('../store');
const whatsapp = require('../whatsapp');

function handleError(res, e) {
  if (e && e.httpStatus) { return res.status(e.httpStatus).json({ code: e.httpStatus, message: e.message }); }
  console.error(e);
  return res.status(500).json({ code: 500, message: 'Service temporarily unavailable' });
}

/** Needs `io` to broadcast the deposit-greeting auto-reply into the ticket's socket room - see chatLogic.js's maybeAutoReplyToDepositGreeting. */
function createTicketsRouter(io) {
  const router = express.Router();

  /** POST /v1/api/create-ticket - see api/v1/api/create-ticket.php for the full contract comment. */
  router.post('/create-ticket', requireAuth(), async (req, res) => {
    try {
      const ticket = await createOrGetTicket(req.chatUser, req.body || {});
      res.json({ status: 1, data: ticketDoc(ticket), message: 'Ticket created successfully' });

      // Not awaited - see push.js's equivalent comment for why (self-
      // contained error handling in whatsapp.js, shouldn't hold up the
      // response either way).
      whatsapp.notifyAdminWhatsApp(whatsapp.formatWaitingMessage({
        customerName: ticket.customer_full_name || ticket.customer_name,
        phone: req.chatUser.phoneNumber,
        subject: ticket.subject,
        ticketId: ticket.oid,
      }));
    } catch (e) { handleError(res, e); }
  });

  /** POST /v1/api/send-message - see api/v1/api/send-message.php for the full contract comment. */
  router.post('/send-message', requireAuth(), async (req, res) => {
    try {
      const body = req.body || {};
      if (!body.ticketId) { return res.status(400).json({ code: 400, message: 'ticketId is required' }); }
      const ticket = await store.getTicketByOid(body.ticketId);
      if (!ticket) { return res.status(404).json({ code: 404, message: 'Ticket not found' }); }
      const message = await insertMessage(req.chatUser, ticket, body);
      res.json({ status: 1, data: messageDoc(message), message: 'Message sent successfully' });

      // `ticket` here is still the pre-message snapshot fetched above (insertMessage's
      // own ticket update doesn't mutate this local object), which is exactly what
      // maybeAutoReplyToDepositGreeting needs to tell "first customer message" apart
      // from a later one. Broadcast-only (REST has no other push channel back to the
      // customer) - the customer's own client is expected to already be in this
      // ticket's socket room, same as an admin reply. Sends the image and its
      // follow-up text as two separate messages/events, in order - see
      // maybeAutoReplyToDepositGreeting's own comment for why.
      const autoReplies = await maybeAutoReplyToDepositGreeting(ticket, message, req.chatToken);
      for (const reply of autoReplies) {
        const doc = socketMessageDoc(reply);
        const eventName = chatMessageEventName(reply);
        const out = eventName === 'send-file-message'
          ? { success: true, message: 'File message sent successfully', messageDocs: [doc] }
          : { success: true, message: 'Message sent successfully', messageDoc: doc };
        io.to(String(ticket.oid)).emit(eventName, out);
        // Also under "send-message" for the image - see the matching
        // comment in socket/index.js's admin-send-message handler for why
        // (an unprompted attachment via send-file-message alone was
        // reported not rendering live on the customer side).
        if (eventName === 'send-file-message') {
          io.to(String(ticket.oid)).emit('send-message', { success: true, message: 'Message sent successfully', messageDoc: doc });
        }
        io.to(ADMIN_ROOM).emit('admin:ticket-activity', { ticketId: String(ticket.oid), lastActivity: doc.createdAt });
      }

      // `ticket` is still the pre-message snapshot - no admin had replied
      // as of right before this message if admin_first_replied_at was
      // empty then. Not awaited - see whatsapp.js's own resilience notes.
      if (!ticket.admin_first_replied_at) {
        whatsapp.notifyAdminWhatsApp(whatsapp.formatCustomerMessageAlert({
          customerName: ticket.customer_full_name || ticket.customer_name,
          phone: req.chatUser.phoneNumber,
          content: message.content,
          hasAttachment: !!message.attachment_url,
          ticketId: ticket.oid,
        }));
      }
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

  /** POST /v1/api/submit-rating - REST equivalent of the submit-rating socket event. */
  router.post('/submit-rating', requireAuth(), async (req, res) => {
    try {
      const body = req.body || {};
      if (!body.ticketId) { return res.status(400).json({ code: 400, message: 'ticketId is required' }); }
      await submitRating(req.chatUser, body);
      res.json({ status: 1, message: 'Rating submitted successfully' });
    } catch (e) { handleError(res, e); }
  });

  return router;
}

module.exports = { createTicketsRouter };
