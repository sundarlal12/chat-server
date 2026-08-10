/**
 * Push notifications (Firebase Cloud Messaging) for messages the customer
 * isn't around to see live - specifically an admin reply while the
 * customer's socket isn't connected (app closed/backgrounded), which
 * otherwise just sits in the DB until they happen to reopen the chat.
 *
 * Targets the customer's own fcmToken directly (per-device, not a topic -
 * confirmed via the PHP UserInfo model's `fcmToken` field, which is what
 * the CURRENT app version actually carries; an older sendMsg.php/
 * notification_helper.php in the PHP repo used a topic-per-mobile-number
 * scheme instead, from what looks like a prior/different chat
 * implementation - not used here since it doesn't match the current
 * UserInfo contract this service already relies on). The token itself is
 * cached onto the ticket row the moment we see it (see chatLogic.js) since
 * an admin-initiated send has no other way to know the customer's current
 * token - only the customer's own authenticated requests ever carry it.
 *
 * Credentials: FIREBASE_SERVICE_ACCOUNT_JSON env var (the full service
 * account JSON, not split into separate fields - splitting the private
 * key across env vars is a common source of newline-escaping bugs).
 * Missing/invalid credentials or a missing/empty token both no-op rather
 * than throwing, so a push failure never blocks the actual message send -
 * chat delivery (DB + socket) has already succeeded by the time this runs.
 */
const admin = require('firebase-admin');

let app;
let initTried = false;

function getApp() {
  if (initTried) { return app; }
  initTried = true;

  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!raw) {
    console.warn('FIREBASE_SERVICE_ACCOUNT_JSON not set - push notifications are disabled.');
    return null;
  }
  try {
    const credentials = JSON.parse(raw);
    app = admin.initializeApp({ credential: admin.credential.cert(credentials) });
  } catch (e) {
    console.error('Failed to initialize Firebase Admin SDK - push notifications are disabled:', e.message);
    app = null;
  }
  return app;
}

/**
 * Fire-and-forget: logs and swallows any failure (invalid/expired token,
 * FCM outage, bad credentials) rather than letting a push failure affect
 * the caller, which has already finished the actual message send.
 *
 * Sends `title`/`body` in BOTH the standard FCM `notification` block AND
 * `data` - confirmed via the app's own decompiled MyFirebaseMessagingService:
 * when the app is backgrounded, Android's FCM SDK auto-displays the system
 * tray notification straight from the `notification` block without the
 * app's code ever running, which is why "normal" pushes looked fine. But
 * whenever the app is foregrounded, onMessageReceived() always runs and
 * builds its OWN notification entirely from `data` - completely ignoring
 * `notification.title`/`.body` - reading specific keys ("title", "body",
 * "notificationCode", "messageDoc", "imageUrl", "videoUrl",
 * "actionButtonName") via a small enum-keyed map. This service's `data`
 * previously only ever contained `ticketId`, so every push looked BLANK
 * whenever the app happened to be in the foreground - not unique to the
 * close-with-rating push that surfaced it (reported: admin closing a chat
 * with a rating produced an empty notification), every push this service
 * sends was silently affected the same way.
 * notificationCode "1" is NOTIFICATION_CHAT_SUPPORT (confirmed via the same
 * decompiled enum) - besides being the semantically correct type, it also
 * gets this app's own "don't show a notification if this ticket's chat
 * screen is already open" suppression for free, matching its other chat
 * pushes, instead of falling back to the generic default type.
 */
async function sendChatPushNotification(fcmToken, { title, body, ticketId, messageDoc }) {
  const token = String(fcmToken || '').trim();
  if (!token) { return; }

  const firebaseApp = getApp();
  if (!firebaseApp) { return; }

  const titleStr = String(title || 'Support');
  const bodyStr = String(body || 'New message');

  try {
    await admin.messaging(firebaseApp).send({
      token,
      notification: { title: titleStr, body: bodyStr },
      data: {
        title: titleStr,
        body: bodyStr,
        notificationCode: '1',
        messageDoc: messageDoc ? JSON.stringify(messageDoc) : '',
        ticketId: String(ticketId || ''),
      },
      android: { priority: 'high' },
    });
  } catch (e) {
    console.error('Push notification failed:', e.message);
  }
}

/** Human-readable notification body for a message row - "Sent a photo" etc. for attachments (content is usually just the "File" placeholder or empty), otherwise the message text itself, truncated. */
function chatPushBody(message) {
  if (message.attachment_url) {
    const label = { image: 'a photo', video: 'a video', audio: 'an audio message', voice: 'a voice message' }[message.attachment_type] || 'an attachment';
    return `Sent ${label}`;
  }
  const text = String(message.content || '').trim();
  return text.length > 120 ? `${text.slice(0, 117)}...` : (text || 'New message');
}

module.exports = { sendChatPushNotification, chatPushBody };
