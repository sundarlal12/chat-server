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

module.exports = { classify, KIND_TO_MESSAGE_TYPE, ALLOWED_DESCRIPTION };
