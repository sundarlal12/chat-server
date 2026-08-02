const express = require('express');
const { dbOne, dbAll } = require('../db');
const { ticketDoc, messageDoc } = require('../docs');
const { requireAuth } = require('../auth');
const { asyncRoute } = require('../asyncRoute');

const router = express.Router();

/**
 * GET /v1/api/get-chat-data-of-recent-ticket?page=&limit=10
 * See api/v1/api/get-chat-data-of-recent-ticket.php's header comment for
 * the full decompiled-model contract this matches.
 */
router.get('/get-chat-data-of-recent-ticket', requireAuth(), asyncRoute(async (req, res) => {
  const user = req.chatUser;
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  let limit = parseInt(req.query.limit, 10) || 10;
  if (limit <= 0 || limit > 100) { limit = 10; }
  const offset = (page - 1) * limit;

  const ticketRow = await dbOne(
    'SELECT * FROM support_tickets WHERE user_oid = :u ORDER BY created_at DESC, id DESC LIMIT 1',
    { u: String(user.oid) }
  );

  let ticket = null;
  let messages = [];
  let pagination = null;

  if (ticketRow) {
    ticket = ticketDoc(ticketRow);

    const totalRow = await dbOne(
      'SELECT COUNT(*) AS n FROM support_messages WHERE ticket_oid = :t',
      { t: String(ticketRow.oid) }
    );
    const totalMessages = Number(totalRow?.n || 0);

    const rows = await dbAll(
      `SELECT * FROM support_messages WHERE ticket_oid = :t ORDER BY created_at DESC, id DESC LIMIT ${limit} OFFSET ${offset}`,
      { t: String(ticketRow.oid) }
    );
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
    message: 'Chat data fetched successfully',
  });
}));

module.exports = router;
