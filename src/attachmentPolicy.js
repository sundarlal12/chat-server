/**
 * Allowed chat attachment types + the numeric `messageType` each one maps
 * to. The messageType values (1=text, 2=image, 3=video, 4=document,
 * 5=audio, 6=voice message) are NOT guessed - they're read directly out
 * of the real app's own decompiled ChatAdapter (cb.g enum), which picks
 * which message layout/ViewHolder to render PURELY off this int. Sending
 * the wrong number (or defaulting to 1/text, which the admin panel used
 * to do for every attachment) is why an uploaded attachment could reach
 * the DB/URL fine but never actually show up in the app.
 */
const ALLOWED = [
  { mimetypes: ['image/jpeg'], exts: ['.jpg', '.jpeg'], kind: 'image', messageType: 2 },
  { mimetypes: ['image/png'], exts: ['.png'], kind: 'image', messageType: 2 },
  { mimetypes: ['image/gif'], exts: ['.gif'], kind: 'image', messageType: 2 },
  { mimetypes: ['video/mp4'], exts: ['.mp4'], kind: 'video', messageType: 3 },
  { mimetypes: ['audio/mpeg', 'audio/mp3'], exts: ['.mp3'], kind: 'audio', messageType: 5 },
  // Voice notes recorded in-browser (admin panel mic button) - MediaRecorder
  // can't produce mp3, only webm/ogg (opus) - the real app's own voice
  // notes are a DISTINCT messageType (6, not 5/audio) from the enum, so
  // these get their own "voice" kind rather than being lumped into "audio".
  { mimetypes: ['audio/webm', 'audio/ogg'], exts: ['.webm', '.ogg'], kind: 'voice', messageType: 6 },
];

const KIND_TO_MESSAGE_TYPE = { image: 2, video: 3, document: 4, audio: 5, voice: 6 };

/** Classifies an upload by mimetype first, falling back to file extension for clients that send a generic mimetype (e.g. application/octet-stream). Returns null if the type isn't in the allow-list. */
function classify(mimetype, originalname) {
  const mime = String(mimetype || '').toLowerCase().split(';')[0].trim();
  const byMime = ALLOWED.find((a) => a.mimetypes.includes(mime));
  if (byMime) { return byMime; }

  const ext = ('.' + String(originalname || '').split('.').pop()).toLowerCase();
  return ALLOWED.find((a) => a.exts.includes(ext)) || null;
}

const ALLOWED_DESCRIPTION = 'images (jpg, png, gif), video (mp4), audio (mp3), or a recorded voice note';

/**
 * Magic-byte sniff, used when a socket-sent attachment arrives as inline
 * base64 data with no reliable mimetype/extension hint alongside it (see
 * chatLogic.js's resolveInlineAttachment - the send-file-message socket
 * event may embed the file directly rather than referencing an
 * already-uploaded URL). Only covers the formats this policy allows.
 */
function sniffKind(buffer) {
  if (!buffer || buffer.length < 4) { return null; }
  const b = buffer;
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) { return ALLOWED.find((a) => a.mimetypes.includes('image/jpeg')); }
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) { return ALLOWED.find((a) => a.mimetypes.includes('image/png')); }
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) { return ALLOWED.find((a) => a.mimetypes.includes('image/gif')); }
  if (b.length > 11 && b.slice(4, 8).toString('ascii') === 'ftyp') { return ALLOWED.find((a) => a.mimetypes.includes('video/mp4')); }
  if ((b[0] === 0x49 && b[1] === 0x44 && b[2] === 0x33) || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0)) { return ALLOWED.find((a) => a.mimetypes.includes('audio/mpeg')); }
  if (b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) { return ALLOWED.find((a) => a.mimetypes.includes('audio/webm')); }
  if (b.slice(0, 4).toString('ascii') === 'OggS') { return ALLOWED.find((a) => a.mimetypes.includes('audio/ogg')); }
  return null;
}

module.exports = { classify, sniffKind, KIND_TO_MESSAGE_TYPE, ALLOWED_DESCRIPTION };
