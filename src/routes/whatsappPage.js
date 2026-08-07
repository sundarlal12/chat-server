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
