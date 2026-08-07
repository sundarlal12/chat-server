/**
 * The WhatsApp QR-connection page, served as a route handler rather than
 * a static file under public/admin/. That's not the normal pattern here
 * (index.html is a plain static file) - moved to this shape specifically
 * because a genuinely new file added to public/admin/ stopped being found
 * by express.static on this deployment (confirmed with two different new
 * filenames, both 404ing while the pre-existing index.html kept serving
 * fine) - a Railway build-cache/static-asset quirk that couldn't be
 * resolved from this side. New route handlers deploy reliably (every
 * other change this session has), so the page content lives here instead
 * until/unless that underlying issue gets sorted out directly with Railway.
 */
const HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>WhatsApp Connection - PAPA777 Chat Admin</title>
<link rel="icon" type="image/svg+xml" href="data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMzkwIiBoZWlnaHQ9IjM5MCIgdmlld0JveD0iMCAwIDM5MCAzOTAiIGZpbGw9Im5vbmUiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+CjxwYXRoIGQ9Ik0yOTEuNTcgMy40N0g5Mi4zN0M0MS41OTg1IDMuNDcgMC40NDAwMDIgNDQuNjI4NSAwLjQ0MDAwMiA5NS40VjI5NC42QzAuNDQwMDAyIDM0NS4zNzIgNDEuNTk4NSAzODYuNTMgOTIuMzcgMzg2LjUzSDI5MS41N0MzNDIuMzQyIDM4Ni41MyAzODMuNSAzNDUuMzcyIDM4My41IDI5NC42Vjk1LjRDMzgzLjUgNDQuNjI4NSAzNDIuMzQyIDMuNDcgMjkxLjU3IDMuNDdaIiBmaWxsPSIjRTQyRDJBIi8+CjxwYXRoIGQ9Ik05Mi4zNyAzLjQ3SDI5MS41NkMzNDIuMzMgMy40NyAzODMuNDkgNDQuNjMgMzgzLjQ5IDk1LjRWMjk0LjU5QzM0Ni45MiAxMzIuOCAyNTguMjEgMjYuODQgOTIuMzYgMy40NTk5OUw5Mi4zNyAzLjQ3WiIgZmlsbD0idXJsKCNwYWludDBfbGluZWFyXzFfNikiLz4KPHBhdGggZD0iTTM4My41IDk1LjRWMjk0LjU5QzM4My41IDY2LjYgMjkxLjU3IDMuNDU5OTkgMjkxLjU3IDMuNDU5OTlDMzQyLjM0IDMuNDU5OTkgMzgzLjUgNDQuNjIgMzgzLjUgOTUuMzlWOTUuNFoiIGZpbGw9InVybCgjcGFpbnQxX2xpbmVhcl8xXzYpIi8+CjxwYXRoIGQ9Ik0yOTEuNTYgMzg2LjUzSDkyLjM3QzQxLjYgMzg2LjUzIDAuNDQwMDAyIDM0NS4zNyAwLjQ0MDAwMiAyOTQuNlY5NS40MUMwLjQ0MDAwMiA5NS40MSAxMi4xMiAzODYuNTQgMjkxLjU3IDM4Ni41NEwyOTEuNTYgMzg2LjUzWiIgZmlsbD0idXJsKCNwYWludDJfbGluZWFyXzFfNikiLz4KPHBhdGggZD0iTTMzNS4wMTcgMzUxLjAyMkMzNTcuOTc5IDMyOS45NjYgMzEyLjU0OCAyNDMuMDUzIDIzMy41NDMgMTU2Ljg5NUMxNTQuNTM5IDcwLjczNzcgNzEuODc4OSAxNy45NjIxIDQ4LjkxNjggMzkuMDE3N0MyNS45NTQ4IDYwLjA3MzMgNzEuMzg2IDE0Ni45ODcgMTUwLjM5IDIzMy4xNDRDMjI5LjM5NCAzMTkuMzAyIDMxMi4wNTUgMzcyLjA3OCAzMzUuMDE3IDM1MS4wMjJaIiBmaWxsPSJ1cmwoI3BhaW50M19saW5lYXJfMV82KSIvPgo8cGF0aCBkPSJNMTE4LjIzIDY4LjhIMjEzLjQyQzI1MC4yIDY4LjggMjY2LjA2IDg4LjI3IDI2Ni4wNiAxMTYuMDNWMTQxLjI3QzI2Mi40NSAyMzguNjIgMjA4LjczIDI0Mi4yMyAxNjcuNjMgMjUxLjI0TDE2OC4zNSAzMjEuMTlIMTE3Ljg3TDExOC4yMyA2OC44Wk0yMTkuMTkgMTQxLjI4QzIxOS4xOSAxMzEuOSAyMjAuNjMgMTE2Ljc2IDIxMC41NCAxMTUuNjhIMTY4LjcxTDE2OC4zNSAyMDMuNjZDMjAxLjUyIDE5Ny41MyAyMTkuMTkgMTg4Ljg4IDIxOS4xOSAxNDEuMjhaIiBmaWxsPSJ3aGl0ZSIvPgo8ZGVmcz4KPGxpbmVhckdyYWRpZW50IGlkPSJwYWludDBfbGluZWFyXzFfNiIgeDE9IjE0Ni4xMyIgeTE9IjI0MC44NCIgeDI9IjMzNS44NiIgeTI9IjUxLjExIiBncmFkaWVudFVuaXRzPSJ1c2VyU3BhY2VPblVzZSI+CjxzdG9wIHN0b3AtY29sb3I9IndoaXRlIiBzdG9wLW9wYWNpdHk9IjAuNSIvPgo8c3RvcCBvZmZzZXQ9IjEiIHN0b3AtY29sb3I9IndoaXRlIiBzdG9wLW9wYWNpdHk9IjAiLz4KPC9saW5lYXJHcmFkaWVudD4KPGxpbmVhckdyYWRpZW50IGlkPSJwYWludDFfbGluZWFyXzFfNiIgeDE9IjMzNy41MyIgeTE9IjI2My40NCIgeDI9IjMzNy41MyIgeTI9IjUwLjgyIiBncmFkaWVudFVuaXRzPSJ1c2VyU3BhY2VPblVzZSI+CjxzdG9wIHN0b3AtY29sb3I9IndoaXRlIiBzdG9wLW9wYWNpdHk9IjAuNSIvPgo8c3RvcCBvZmZzZXQ9IjEiIHN0b3AtY29sb3I9IndoaXRlIiBzdG9wLW9wYWNpdHk9IjAiLz4KPC9saW5lYXJHcmFkaWVudD4KPGxpbmVhckdyYWRpZW50IGlkPSJwYWludDJfbGluZWFyXzFfNiIgeDE9IjIzNy44MSIgeTE9IjE0OS4xNiIgeDI9IjQ4LjA4IiB5Mj0iMzM4Ljg5IiBncmFkaWVudFVuaXRzPSJ1c2VyU3BhY2VPblVzZSI+CjxzdG9wIHN0b3AtY29sb3I9IndoaXRlIiBzdG9wLW9wYWNpdHk9IjAuNSIvPgo8c3RvcCBvZmZzZXQ9IjEiIHN0b3AtY29sb3I9IndoaXRlIiBzdG9wLW9wYWNpdHk9IjAiLz4KPC9saW5lYXJHcmFkaWVudD4KPGxpbmVhckdyYWRpZW50IGlkPSJwYWludDNfbGluZWFyXzFfNiIgeDE9IjE0MC43MzMiIHkxPSIyNDYuODkzIiB4Mj0iMjIzLjQ3NiIgeTI9IjE3MS4wMiIgZ3JhZGllbnRVbml0cz0idXNlclNwYWNlT25Vc2UiPgo8c3RvcCBzdG9wLWNvbG9yPSJ3aGl0ZSIgc3RvcC1vcGFjaXR5PSIwLjIiLz4KPHN0b3Agb2Zmc2V0PSIwLjE1IiBzdG9wLWNvbG9yPSJ3aGl0ZSIgc3RvcC1vcGFjaXR5PSIwLjExIi8+CjxzdG9wIG9mZnNldD0iMC4zMSIgc3RvcC1jb2xvcj0id2hpdGUiIHN0b3Atb3BhY2l0eT0iMC4wNSIvPgo8c3RvcCBvZmZzZXQ9IjAuNSIgc3RvcC1jb2xvcj0id2hpdGUiIHN0b3Atb3BhY2l0eT0iMC4wMSIvPgo8c3RvcCBvZmZzZXQ9IjAuNzQiIHN0b3AtY29sb3I9IndoaXRlIiBzdG9wLW9wYWNpdHk9IjAiLz4KPC9saW5lYXJHcmFkaWVudD4KPC9kZWZzPgo8L3N2Zz4K" />
<style>
  /* Same variable set as public/admin/index.html - kept in sync manually since this is a small, separate utility page. */
  :root {
    --bg: #f4f5f7; --surface: #ffffff; --surface-alt: #fafafb; --border: #e6e8ec;
    --text: #1f2430; --text-muted: #6b7280; --text-faint: #9aa1ae;
    --brand: #e0263b; --brand-hover: #c81f32; --brand-soft: #fdeaec;
    --success-bg: #e5f7ec; --success-text: #17924a;
    --danger-bg: #fdeaec; --danger-text: #e0263b;
    --shadow: 0 1px 2px rgba(16, 24, 40, 0.06);
    color-scheme: light;
  }
  :root[data-theme="dark"] {
    --bg: #0f1115; --surface: #171a21; --surface-alt: #1c2028; --border: #262b36;
    --text: #e6e8eb; --text-muted: #8a93a3; --text-faint: #5a6273;
    --brand: #e0263b; --brand-hover: #ff4d5e; --brand-soft: #3a1c22;
    --success-bg: #1f4d2f; --success-text: #6fd88f;
    --danger-bg: #3a2323; --danger-text: #ff9d9d;
    --shadow: none;
    color-scheme: dark;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    background: var(--bg); color: var(--text); min-height: 100vh;
  }
  header {
    display: flex; align-items: center; justify-content: space-between; padding: 10px 18px;
    border-bottom: 1px solid var(--border); background: var(--surface); box-shadow: var(--shadow);
  }
  header .brand { display: flex; align-items: center; gap: 10px; }
  header .brand .badge {
    width: 32px; height: 32px; border-radius: 9px; background: var(--brand); color: #fff;
    display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 15px;
  }
  header .brand .name { font-size: 15px; font-weight: 700; }
  header .brand .name small { display: block; font-weight: 500; font-size: 11px; color: var(--text-muted); }
  header a.back { color: var(--text-muted); font-size: 13px; text-decoration: none; font-weight: 600; }
  header a.back:hover { color: var(--brand); }

  #wrap { max-width: 460px; margin: 60px auto; padding: 0 16px; }
  .card {
    background: var(--surface); border: 1px solid var(--border); border-radius: 12px;
    box-shadow: var(--shadow); padding: 28px; text-align: center;
  }
  .card h1 { font-size: 17px; margin: 0 0 6px; }
  .card p.sub { color: var(--text-muted); font-size: 13px; margin: 0 0 22px; }
  #qr-box { display: flex; align-items: center; justify-content: center; min-height: 260px; }
  #qr-box img { width: 240px; height: 240px; border: 1px solid var(--border); border-radius: 8px; }
  .status-pill {
    display: inline-flex; align-items: center; gap: 6px; font-size: 12px; font-weight: 700;
    padding: 6px 14px; border-radius: 20px; text-transform: uppercase; letter-spacing: 0.3px;
  }
  .status-pill.connected { background: var(--success-bg); color: var(--success-text); }
  .status-pill.qr, .status-pill.connecting { background: var(--brand-soft); color: var(--brand); }
  .status-pill.disconnected { background: var(--danger-bg); color: var(--danger-text); }
  #hint { color: var(--text-muted); font-size: 12px; margin-top: 16px; line-height: 1.5; }
  #connected-number { color: var(--text); font-size: 13px; font-weight: 700; margin-top: 10px; }
  button#reconnect-btn, button#disconnect-btn {
    margin-top: 18px; margin-left: 6px; border: none; font-weight: 700;
    padding: 10px 18px; border-radius: 8px; font-size: 13px; cursor: pointer;
  }
  button#reconnect-btn { background: var(--brand); color: white; margin-left: 0; }
  button#reconnect-btn:hover { background: var(--brand-hover); }
  button#disconnect-btn.secondary { background: var(--surface-alt); color: var(--danger-text); border: 1px solid var(--border); }
  button#disconnect-btn.secondary:hover { background: var(--danger-bg); }
  .hidden { display: none !important; }
</style>
</head>
<body>

<header>
  <div class="brand">
    <span class="badge">P</span>
    <span class="name">PAPA777<small>WhatsApp Connection</small></span>
  </div>
  <a class="back" href="/admin/">&larr; Back to chat admin</a>
</header>

<div id="wrap">
  <div class="card">
    <h1>WhatsApp admin alerts</h1>
    <p class="sub">Scan with the WhatsApp account that should receive "customer waiting" alerts.</p>
    <div id="qr-box">
      <span class="status-pill" id="status-pill">Loading…</span>
    </div>
    <div id="connected-number"></div>
    <div id="hint"></div>
    <button id="reconnect-btn" class="hidden">Reconnect</button>
    <button id="disconnect-btn" class="hidden secondary">Disconnect</button>
  </div>
</div>

<script>
(function () {
  // Reuses the same admin session as the main chat panel - no separate login.
  const token = localStorage.getItem('chatAdminToken') || '';
  if (!token) { window.location.href = '/admin/'; return; }

  function applyTheme(theme) { document.documentElement.setAttribute('data-theme', theme); }
  applyTheme(localStorage.getItem('chatAdminTheme') || 'light');

  const qrBox = document.getElementById('qr-box');
  const connectedNumberEl = document.getElementById('connected-number');
  const hint = document.getElementById('hint');
  const reconnectBtn = document.getElementById('reconnect-btn');
  const disconnectBtn = document.getElementById('disconnect-btn');
  let pollTimer = null;

  async function poll() {
    let data;
    try {
      const res = await fetch('/admin/api/whatsapp/status', { headers: { Authorization: 'Bearer ' + token } });
      if (res.status === 401) { window.location.href = '/admin/'; return; }
      data = (await res.json()).data;
    } catch (e) {
      render({ status: 'disconnected' });
      return;
    }
    render(data);
  }

  function render(data) {
    const status = data.status || 'disconnected';
    const pill = '<span class="status-pill ' + status + '">' + status + '</span>';
    connectedNumberEl.textContent = '';
    disconnectBtn.classList.add('hidden');

    if (status === 'qr' && data.qrDataUrl) {
      qrBox.innerHTML = '<img src="' + data.qrDataUrl + '" alt="WhatsApp QR code" />';
      hint.textContent = 'Open WhatsApp on the admin phone → Linked Devices → Link a Device, then scan this code.';
      reconnectBtn.classList.add('hidden');
    } else if (status === 'connected') {
      qrBox.innerHTML = pill;
      if (data.connectedNumber) { connectedNumberEl.textContent = '📱 +' + data.connectedNumber; }
      hint.textContent = 'Connected - "customer waiting" alerts will be sent to the configured admin number(s).';
      reconnectBtn.classList.add('hidden');
      disconnectBtn.classList.remove('hidden');
    } else if (status === 'connecting') {
      qrBox.innerHTML = pill;
      hint.textContent = 'Connecting…';
      reconnectBtn.classList.add('hidden');
    } else {
      qrBox.innerHTML = pill;
      hint.textContent = 'Not connected.';
      reconnectBtn.classList.remove('hidden');
    }
  }

  reconnectBtn.addEventListener('click', async () => {
    reconnectBtn.disabled = true;
    try {
      await fetch('/admin/api/whatsapp/reconnect', { method: 'POST', headers: { Authorization: 'Bearer ' + token } });
    } catch (e) { /* next poll will just show disconnected again */ }
    reconnectBtn.disabled = false;
    poll();
  });

  disconnectBtn.addEventListener('click', async () => {
    if (!window.confirm('Disconnect this WhatsApp number? You will need to scan a new QR code to reconnect.')) { return; }
    disconnectBtn.disabled = true;
    try {
      await fetch('/admin/api/whatsapp/disconnect', { method: 'POST', headers: { Authorization: 'Bearer ' + token } });
    } catch (e) { /* next poll will reflect whatever state actually resulted */ }
    disconnectBtn.disabled = false;
    poll();
  });

  poll();
  pollTimer = setInterval(poll, 3000);
  window.addEventListener('beforeunload', () => clearInterval(pollTimer));
})();
</script>
</body>
</html>
`;

module.exports = (req, res) => { res.type('html').send(HTML); };
