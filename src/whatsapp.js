/**
 * WhatsApp Web (unofficial, QR-linked-device) connection for one-way
 * "a customer is waiting" alerts to a fixed set of admin/support numbers
 * (WHATSAPP_ADMIN_NUMBERS) - not a two-way chat relay. Operator's explicit,
 * informed choice over the official WhatsApp Business Platform (Cloud
 * API): this is against WhatsApp's Terms of Service and carries a real
 * ban risk, accepted here specifically because it's low-volume and
 * internal-only (a handful of admin numbers, not customer-facing bulk
 * messaging).
 *
 * Session persistence: Baileys' own useMultiFileAuthState() (see its
 * source, node_modules/@whiskeysockets/baileys/lib/Utils/
 * use-multi-file-auth-state.js) stores the linked-device session as one
 * file per key in a local folder - useless here since this service
 * redeploys often (a fresh container each time) and would force a new QR
 * scan on every deploy otherwise. useMySQLAuthState() below reproduces
 * that exact same one-row-per-key shape against the whatsapp_auth_files
 * table instead (see migrate.js), so the session survives deploys.
 *
 * QR handoff: this is a headless server with no browser of its own to
 * scan with, so the QR is rendered as a data-URL PNG (see getStatus())
 * for an admin-authenticated page to display - see routes/admin.js's
 * /whatsapp/status endpoint and public/admin/whatsapp.html.
 */
const { proto, initAuthCreds, BufferJSON, DisconnectReason, fetchLatestBaileysVersion, makeWASocket } = require('@whiskeysockets/baileys');
const pino = require('pino');
const QRCode = require('qrcode');
const store = require('./store');

async function useMySQLAuthState() {
  const writeData = async (data, key) => {
    await store.setWhatsAppAuthFile(key, JSON.stringify(data, BufferJSON.replacer));
  };
  const readData = async (key) => {
    const raw = await store.getWhatsAppAuthFile(key);
    if (!raw) { return null; }
    try { return JSON.parse(raw, BufferJSON.reviver); } catch { return null; }
  };
  const removeData = (key) => store.deleteWhatsAppAuthFile(key);

  const creds = (await readData('creds')) || initAuthCreds();

  return {
    state: {
      creds,
      keys: {
        get: async (type, ids) => {
          const data = {};
          await Promise.all(ids.map(async (id) => {
            let value = await readData(`${type}-${id}`);
            if (type === 'app-state-sync-key' && value) {
              value = proto.Message.AppStateSyncKeyData.fromObject(value);
            }
            data[id] = value;
          }));
          return data;
        },
        set: async (data) => {
          const tasks = [];
          for (const category in data) {
            for (const id in data[category]) {
              const value = data[category][id];
              const key = `${category}-${id}`;
              tasks.push(value ? writeData(value, key) : removeData(key));
            }
          }
          await Promise.all(tasks);
        },
      },
    },
    saveCreds: () => writeData(creds, 'creds'),
  };
}

let sock = null;
let connectionStatus = 'disconnected'; // 'disconnected' | 'connecting' | 'qr' | 'connected'
let latestQrDataUrl = null;
let connecting = false;

async function connect() {
  if (connecting) { return; }
  connecting = true;
  connectionStatus = 'connecting';
  try {
    const { state, saveCreds } = await useMySQLAuthState();
    const { version } = await fetchLatestBaileysVersion();

    sock = makeWASocket({ version, auth: state, logger: pino({ level: 'warn' }) });
    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        connectionStatus = 'qr';
        try { latestQrDataUrl = await QRCode.toDataURL(qr); }
        catch (e) { console.error('Failed to render WhatsApp QR:', e.message); }
      }

      if (connection === 'open') {
        connectionStatus = 'connected';
        latestQrDataUrl = null;
        console.log('WhatsApp: connected.');
      }

      if (connection === 'close') {
        connectionStatus = 'disconnected';
        const statusCode = lastDisconnect && lastDisconnect.error && lastDisconnect.error.output && lastDisconnect.error.output.statusCode;
        const loggedOut = statusCode === DisconnectReason.loggedOut;
        console.warn('WhatsApp: connection closed.', { statusCode, loggedOut: !!loggedOut });
        sock = null;
        if (loggedOut) {
          // The linked device was removed (e.g. unlinked from the phone's
          // WhatsApp app) - the stored session is now dead. Clear it so
          // the next reconnect starts clean with a fresh QR instead of
          // endlessly failing to reuse invalidated credentials.
          await store.clearWhatsAppAuthFiles();
        } else {
          setTimeout(() => { connect().catch((e) => console.error('WhatsApp: reconnect failed:', e.message)); }, 4000);
        }
      }
    });
  } finally {
    connecting = false;
  }
}

/** Call once at server startup (see server.js) - safe to call again later to force a fresh connect (e.g. after an intentional logout), since connect() itself no-ops while already connecting. */
async function start() {
  try {
    await connect();
  } catch (e) {
    console.error('WhatsApp: failed to start connection:', e.message);
  }
}

function getStatus() {
  return {
    status: connectionStatus,
    qrDataUrl: connectionStatus === 'qr' ? latestQrDataUrl : null,
  };
}

// A WhatsApp JID is plain digits (country code + number, no "+", spaces, or
// dashes) - stripping those here rather than documenting "must be exactly
// this format" means a number like "+91 98765 43210" still works instead
// of silently producing an invalid JID (confirmed: this was exactly why
// an already-configured number never received anything - the "+" alone
// made "+919876543210@s.whatsapp.net" not a real WhatsApp ID).
const ADMIN_NUMBERS = String(process.env.WHATSAPP_ADMIN_NUMBERS || '')
  .split(',')
  .map((s) => s.replace(/[^0-9]/g, ''))
  .filter(Boolean);

/**
 * Fire-and-forget: no-ops (doesn't throw) if not connected, no numbers are
 * configured, or an individual send fails - a WhatsApp alert failing
 * should never affect the actual ticket/message flow that triggers it.
 */
async function notifyAdminWhatsApp(text) {
  if (!sock || connectionStatus !== 'connected') { return; }
  if (!ADMIN_NUMBERS.length) { return; }
  for (const number of ADMIN_NUMBERS) {
    const jid = `${number}@s.whatsapp.net`;
    try {
      await sock.sendMessage(jid, { text });
    } catch (e) {
      console.error(`WhatsApp: notify to ${number} failed:`, e.message);
    }
  }
}

/** "A customer is waiting" alert text - called when a new ticket is created (see routes/tickets.js and socket/index.js's create-ticket handlers). */
function formatWaitingMessage({ customerName, phone, subject, ticketId }) {
  const lines = [
    '🔔 New customer waiting in chat',
    `Name: ${customerName || 'Unknown'}`,
  ];
  if (phone) { lines.push(`Mobile: ${phone}`); }
  if (subject) { lines.push(`Topic: ${subject}`); }
  if (ticketId) { lines.push(`Ticket: ${ticketId}`); }
  return lines.join('\n');
}

/**
 * Relays an unattended customer message - called for every customer
 * message on a ticket no admin has replied to yet (see
 * chatLogic.js's insertAdminMessage for how "replied yet" is tracked, and
 * routes/tickets.js/socket/index.js's send-message handlers for the
 * gating check). Unlike formatWaitingMessage this can fire repeatedly per
 * ticket, by design - operator wants ongoing unattended messages relayed,
 * not just the first one, until an admin actually starts handling it.
 */
function formatCustomerMessageAlert({ customerName, phone, content, hasAttachment, ticketId }) {
  const lines = [
    '💬 New message (no admin has replied yet)',
    `From: ${customerName || 'Unknown'}`,
  ];
  if (phone) { lines.push(`Mobile: ${phone}`); }
  lines.push(hasAttachment ? '"Sent an attachment"' : `"${content || '(empty message)'}"`);
  if (ticketId) { lines.push(`Ticket: ${ticketId}`); }
  return lines.join('\n');
}

module.exports = { start, getStatus, notifyAdminWhatsApp, formatWaitingMessage, formatCustomerMessageAlert };
