require('dotenv').config();

const http = require('http');
const express = require('express');
const cors = require('cors');
const { Server } = require('socket.io');

const topicsRoute = require('./src/routes/topics');
const chatDataRoute = require('./src/routes/chatData');
const ticketsRoute = require('./src/routes/tickets');
const { attachChatSocket } = require('./src/socket');
const { dbOne } = require('./src/db');

for (const key of ['JWT_SECRET', 'DB_HOST', 'DB_USER', 'DB_PASSWORD', 'DB_NAME']) {
  if (!process.env[key]) {
    console.error(`Missing required env var: ${key} - see .env.example`);
    process.exit(1);
  }
}

// Last-resort net for anything outside the Express request lifecycle (e.g. a
// mysql2 pool connection-lost event, or a bug in a spot the per-route/socket
// try-catches don't cover) - log and keep the process alive rather than take
// down every connected chat session over one bad event.
process.on('unhandledRejection', (err) => console.error('unhandledRejection:', err));
process.on('uncaughtException', (err) => console.error('uncaughtException:', err));

const app = express();
app.use(cors({ origin: '*', methods: ['GET', 'POST', 'OPTIONS'] }));
app.use(express.json());

app.get('/', (req, res) => res.status(200).send('papa777 chat service'));

/**
 * Separates "is the process alive" from "can it actually reach MySQL" -
 * added after a real deploy showed a generic 500 with no way to tell
 * which of those two had failed. Reports the raw DB driver error CODE
 * (e.g. ETIMEDOUT/ECONNREFUSED/ENOTFOUND/ER_ACCESS_DENIED_ERROR), which is
 * diagnostic but not a credential - safe to expose here.
 */
app.get('/health', async (req, res) => {
  const result = { status: 'ok', db: 'unknown' };
  try {
    await dbOne('SELECT 1 AS ok');
    result.db = 'connected';
    return res.json(result);
  } catch (e) {
    // Deliberately NOT including e.sqlMessage/e.message here - for an
    // access-denied error that text includes the DB username, which
    // shouldn't be exposed on a public, unauthenticated endpoint. The
    // error code alone (ETIMEDOUT/ECONNREFUSED/ENOTFOUND/
    // ER_ACCESS_DENIED_ERROR/...) is enough to diagnose which of
    // network-reachability/credentials/DNS is the problem.
    result.status = 'degraded';
    result.db = 'error';
    result.dbErrorCode = e.code || null;
    return res.status(503).json(result);
  }
});

// Routes are mounted directly under /v1/api, matching the app's real request
// paths exactly (GET/POST https://ca-api.papa777.sbs/v1/api/get-all-topics etc).
app.use('/v1/api', topicsRoute);
app.use('/v1/api', chatDataRoute);
app.use('/v1/api', ticketsRoute);

app.use((req, res) => res.status(404).json({ code: 404, message: 'Not found' }));

// Final safety net for anything asyncRoute() forwards via next(err) - without
// this Express falls back to its default HTML error page, and more
// importantly this is where every DB/unexpected error ends up instead of
// crashing the process (see asyncRoute.js for why that matters here).
app.use((err, req, res, next) => {
  console.error(err);
  res.status(err.httpStatus || 500).json({
    code: err.httpStatus || 500,
    message: err.httpStatus ? err.message : 'Service temporarily unavailable',
  });
});

const httpServer = http.createServer(app);
const io = new Server(httpServer, {
  cors: { origin: '*' },
  // matches the client's own EIO=4 (socket.io v4 protocol) connection URL
  // confirmed in papa776.har: wss://ca-api.papaji.dev/socket.io/?EIO=4&...
  path: '/socket.io/',
});
attachChatSocket(io);

const port = Number(process.env.PORT || 3000);
httpServer.listen(port, () => {
  console.log(`papa777 chat service listening on :${port}`);
});
