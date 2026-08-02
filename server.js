require('dotenv').config();

const http = require('http');
const express = require('express');
const cors = require('cors');
const { Server } = require('socket.io');

const topicsRoute = require('./src/routes/topics');
const chatDataRoute = require('./src/routes/chatData');
const ticketsRoute = require('./src/routes/tickets');
const attachmentsRoute = require('./src/routes/attachments');
const { attachChatSocket } = require('./src/socket');
const { migrate } = require('./migrate');

// PHP_API_BASE_URL: auth and display-name lookups delegate to the PHP API
// (see src/auth.js/src/phpApi.js) - no JWT_SECRET needed here.
// DB connection: either MYSQL_URL/MYSQL_PUBLIC_URL/DATABASE_URL, or the
// discrete DB_HOST/DB_USER/DB_PASSWORD/DB_NAME - see src/db.js.
if (!process.env.PHP_API_BASE_URL) {
  console.error('Missing required env var: PHP_API_BASE_URL - see .env.example');
  process.exit(1);
}
const hasDbUrl = !!(process.env.MYSQL_URL || process.env.MYSQL_PUBLIC_URL || process.env.DATABASE_URL);
const hasDbParts = !!(process.env.DB_HOST && process.env.DB_USER && process.env.DB_NAME);
if (!hasDbUrl && !hasDbParts) {
  console.error('Missing DB config - set MYSQL_URL (Railway MySQL plugin) or DB_HOST/DB_USER/DB_PASSWORD/DB_NAME - see .env.example');
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
app.use('/v1/api', attachmentsRoute);

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

// Idempotent - safe to run on every startup/deploy (see migrate.js).
migrate()
  .then(() => {
    httpServer.listen(port, () => {
      console.log(`papa777 chat service listening on :${port}`);
    });
  })
  .catch((e) => {
    console.error('Migration failed, not starting:', e);
    process.exit(1);
  });
