require('dotenv').config();

const path = require('path');
const http = require('http');
const express = require('express');
const cors = require('cors');
const { Server } = require('socket.io');

const topicsRoute = require('./src/routes/topics');
const chatDataRoute = require('./src/routes/chatData');
const { createTicketsRouter } = require('./src/routes/tickets');
const { createAttachmentsRouter, createTicketFileUploadRouter } = require('./src/routes/attachments');
const { createAdminRouter } = require('./src/routes/admin');
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

// Diagnostic-only, temporary: reports whether THIS deployment can actually
// reach PHP_API_BASE_URL (auth/display-name delegation - see phpApi.js)
// and what value it resolved to, since "PHP returns valid data when I curl
// it directly" and "PHP is reachable from Railway's own egress" can differ
// (already saw exactly this class of issue with Hostinger MySQL blocking
// Railway's IP earlier - see README). A 401 from PHP here means reachable
// (PHP correctly rejected a garbage token); anything else (timeout, DNS
// failure, non-JSON) means the network path itself is broken.
app.get('/health/php-check', async (req, res) => {
  const base = process.env.PHP_API_BASE_URL || '(unset)';
  const out = { phpApiBaseUrl: base };

  // DNS first, separately, so a DNS failure isn't lumped in with a
  // connection/TLS/timeout failure - each points at a different fix.
  try {
    const { hostname } = new URL(base);
    const dns = require('dns').promises;
    const dnsStarted = Date.now();
    out.dns = { hostname, addresses: await dns.resolve4(hostname), tookMs: Date.now() - dnsStarted };
  } catch (e) {
    out.dns = { error: String((e && e.message) || e) };
  }

  try {
    const started = Date.now();
    const r = await fetch(`${base}/v1/api/get-user-data`, {
      headers: { Authorization: 'Bearer diagnostic-invalid-token' },
      signal: AbortSignal.timeout(8000),
    });
    const text = await r.text();
    out.reachable = true;
    out.httpStatus = r.status;
    out.tookMs = Date.now() - started;
    out.bodyPreview = text.slice(0, 300);
  } catch (e) {
    out.reachable = false;
    out.error = String((e && e.message) || e);
    // undici sets .cause with the actual low-level error (ECONNREFUSED,
    // ETIMEDOUT, cert errors, etc.) - "fetch failed" alone doesn't say
    // which, and that's the difference between a firewall block, a DNS
    // problem, and the remote host just being slow.
    if (e && e.cause) {
      out.cause = { message: e.cause.message, code: e.cause.code, name: e.cause.name };
    }
  }

  res.json(out);
});

const httpServer = http.createServer(app);
const io = new Server(httpServer, {
  cors: { origin: '*' },
  // matches the client's own EIO=4 (socket.io v4 protocol) connection URL
  // confirmed in papa776.har: wss://ca-api.papaji.dev/socket.io/?EIO=4&...
  path: '/socket.io/',
});
attachChatSocket(io);

// Routes are mounted directly under /v1/api, matching the app's real request
// paths exactly (GET/POST https://ca-api.papa777.sbs/v1/api/get-all-topics etc).
app.use('/v1/api', topicsRoute);
app.use('/v1/api', chatDataRoute);
app.use('/v1/api', createTicketsRouter(io));
app.use('/v1/api', createAttachmentsRouter(io));
app.use('/v1/admin', createTicketFileUploadRouter(io));

// Admin panel - simple static page + its own REST API, both served from
// this same service (operator's explicit choice over a separate service).
// createAdminRouter(io) needs `io` to broadcast a sent reply into the
// ticket's socket.io room so it reaches an already-connected customer live.
app.use('/admin/api', createAdminRouter(io));
app.use('/admin', express.static(path.join(__dirname, 'public/admin')));

app.use((req, res) => res.status(404).json({ code: 404, message: 'Not found' }));

// Final safety net for anything asyncRoute() forwards via next(err) - without
// this Express falls back to its default HTML error page, and more
// importantly this is where every unexpected error ends up instead of
// crashing the process (see asyncRoute.js for why that matters here).
app.use((err, req, res, next) => {
  console.error(err);
  // multer's own fileSize-limit error (LIMIT_FILE_SIZE) has no .httpStatus
  // of its own - without this it fell through to a generic 500, which read
  // no differently from an actual server error on the client side.
  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ code: 413, message: 'File is too large' });
  }
  res.status(err.httpStatus || 500).json({
    code: err.httpStatus || 500,
    message: err.httpStatus ? err.message : 'Service temporarily unavailable',
  });
});

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
