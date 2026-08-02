const express = require('express');
const { dbOne, dbAll } = require('../db');
const { topicDoc } = require('../docs');
const { asyncRoute } = require('../asyncRoute');

const router = express.Router();

/**
 * GET /v1/api/get-all-topics
 * Confirmed via a real capture in papa776.har - see api/v1/api/get-all-topics.php.
 */
router.get('/get-all-topics', asyncRoute(async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  let limit = parseInt(req.query.limit, 10) || 10;
  if (limit <= 0 || limit > 100) { limit = 10; }
  const offset = (page - 1) * limit;

  const totalRow = await dbOne("SELECT COUNT(*) AS n FROM support_topics WHERE is_active = 1");
  const total = Number(totalRow?.n || 0);
  const rows = await dbAll(
    `SELECT * FROM support_topics WHERE is_active = 1 ORDER BY sort_order ASC, id ASC LIMIT ${limit} OFFSET ${offset}`
  );

  const totalPages = limit > 0 ? Math.max(1, Math.ceil(total / limit)) : 1;
  res.json({
    result: {
      docs: rows.map(topicDoc),
      totalDocs: total,
      offset,
      limit,
      totalPages,
      page,
      pagingCounter: offset + 1,
      hasPrevPage: page > 1,
      hasNextPage: page < totalPages,
      prevPage: page > 1 ? page - 1 : null,
      nextPage: page < totalPages ? page + 1 : null,
    },
    status: 1,
    message: 'Topics fetched successfully',
  });
}));

module.exports = router;
