require('dotenv').config();

const http = require('http');
const express = require('express');
const cors = require('cors');
const { Server } = require('socket.io');

const topicsRoute = require('./src/routes/topics');
const chatDataRoute = require('./src/routes/chatData');
const ticketsRoute = require('./src/routes/tickets');
const { attachChatSocket } = require('./src/socket');

// No database, so the only hard dependency is knowing where the PHP API
// lives (auth and display-name lookups both delegate there - see
// src/auth.js/src/phpApi.js for why there's no JWT_SECRET or DB_* here at
// all anymore).
if (!process.env.PHP_API_BASE_URL) {
  console.error('Missing required env var: PHP_API_BASE_URL - see .env.example');
  process.exit(1);
}

// Last-resort net for anything outside the Express request lifecycle (a bug
// in a spot the per-route/socket try-catches don't cover) - log and keep
// the process alive rather than take down every connected chat session
// over one bad event.
process.on('unhandledRejection', (err) => console.error('unhandledRejection:', err));
process.on('uncaughtException', (err) => console.error('uncaughtException:', err));

const app = express();
app.use(cors({ origin: '*', methods: ['GET', 'POST', 'OPTIONS'] }));
app.use(express.json());

app.get('/', (req, res) => res.status(200).send('papa777 chat service'));
app.get('/health', (req, res) => res.json({ status: 'ok' }));

// Routes are mounted directly under /v1/api, matching the app's real request
// paths exactly (GET/POST https://ca-api.papa777.sbs/v1/api/get-all-topics etc).
app.use('/v1/api', topicsRoute);
app.use('/v1/api', chatDataRoute);
app.use('/v1/api', ticketsRoute);

app.use((req, res) => res.status(404).json({ code: 404, message: 'Not found' }));

// Final safety net for anything asyncRoute() forwards via next(err) - without
// this Express falls back to its default HTML error page, and more
// importantly this is where every unexpected error ends up instead of
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
