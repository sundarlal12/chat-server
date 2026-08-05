const express = require('express');
const store = require('../store');
const { ticketDoc, messageDoc } = require('../docs');
const { requireAuth } = require('../auth');
const { asyncRoute } = require('../asyncRoute');

const router = express.Router();

/**
 * GET /v1/api/get-chat-data-of-recent-ticket?page=&limit=10
 * See api/v1/api/get-chat-data-of-recent-ticket.php's header comment for
 * the full decompiled-model contract this matches. Backed by MySQL (see
 * store.js/migrate.js).
 */
router.get('/get-chat-data-of-recent-ticket', requireAuth(), asyncRoute(async (req, res) => {
  const user = req.chatUser;
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  let limit = parseInt(req.query.limit, 10) || 10;
  if (limit <= 0 || limit > 100) { limit = 10; }
  const offset = (page - 1) * limit;

  const ticketRow = await store.getTicketForUser(String(user.oid));

  let ticket = null;
  let messages = [];
  let pagination = null;

  if (ticketRow) {
    ticket = ticketDoc(ticketRow);

    // Real contract returns newest-first (the client reverses it on
    // receipt - see api/v1/api/get-chat-data-of-recent-ticket.php's
    // header comment) - store.getMessages with limit/offset already
    // queries in that order.
    const totalMessages = await store.countMessages(String(ticketRow.oid));
    const rows = await store.getMessages(String(ticketRow.oid), { limit, offset });
    messages = rows.map(messageDoc);

    pagination = {
      page,
      limit,
      totalMessages,
      totalPages: limit > 0 ? Math.max(1, Math.ceil(totalMessages / limit)) : 1,
    };
  }

  res.json({
    status: 1,
    data: { ticket, messages, pagination },
    // Confirmed via real captured responses (twice) - the live text is
    // "retrieved", not "fetched" (which is what api/v1/api/get-chat-data-
    // of-recent-ticket.php's own reference draft uses).
    message: 'Chat data retrieved successfully',
  });
}));

module.exports = router;
