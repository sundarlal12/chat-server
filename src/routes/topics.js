const express = require('express');
const store = require('../store');
const { topicDoc } = require('../docs');
const { asyncRoute } = require('../asyncRoute');

const router = express.Router();

/**
 * GET /v1/api/get-all-topics
 * Confirmed via a real capture in papa776.har - the 3 topics are seeded
 * into chat_topics by migrate.js with their real oids/timestamps.
 */
router.get('/get-all-topics', asyncRoute(async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  let limit = parseInt(req.query.limit, 10) || 10;
  if (limit <= 0 || limit > 100) { limit = 10; }
  const offset = (page - 1) * limit;

  const all = await store.getTopics();
  const total = all.length;
  const rows = all.slice(offset, offset + limit);

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
