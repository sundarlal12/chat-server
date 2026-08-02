# papa777 chat service

Node.js + Express + socket.io real-time chat backend for `ca-api.papa777.sbs`.
Owns `support_topics`/`support_tickets`/`support_messages` directly against
the same MySQL database the main PHP API uses (`api/` on the Hostinger box)
- see `../api/migrate.php` for that schema. Auth reuses the exact same JWT
scheme/secret as the PHP API (`type: 'access'`, `sub` = `users.oid`), so any
token from `mpin-login`/`fingerprint-login` works here unchanged.

Tested end-to-end locally (REST + socket.io, real DB via SSH tunnel) before
this was written - see the routes/socket code comments for the confirmed
contracts. File uploads for chat attachments still go through the existing
PHP endpoint (`POST https://papa777.sbs/v1/api/upload-chat-attachment`) -
the client uploads there first and gets a URL back, then sends that URL
via the `send-file-message` socket event.

## Deploy to the DigitalOcean droplet (143.244.133.163)

### 1. Get Node onto the droplet

```bash
ssh root@143.244.133.163
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y nodejs
npm install -g pm2
```

### 2. Copy this folder up and install

From your local machine:
```bash
scp -r chat-service root@143.244.133.163:/opt/papa777-chat
ssh root@143.244.133.163 "cd /opt/papa777-chat && npm install --omit=dev"
```

### 3. Enable Remote MySQL access on Hostinger for this droplet's IP

The database lives on Hostinger, not the droplet, so MySQL has to explicitly
allow connections from `143.244.133.163`:

1. hPanel -> Databases -> Remote MySQL
2. Add Access Host: `143.244.133.163`
3. Save

Without this step every DB query from the droplet will hang or get refused
- the droplet's IP isn't in Hostinger's allow-list by default.

### 4. Set environment variables

```bash
ssh root@143.244.133.163
cd /opt/papa777-chat
cp .env.example .env
nano .env   # fill in JWT_SECRET (same value as api/_config.php's jwt_secret
            # on the PHP box - do NOT generate a new one, tokens issued by
            # mpin-login won't verify here otherwise) and DB_* (same
            # credentials as config.php on the PHP box)
```

### 5. Run it under pm2 (keeps it alive across crashes/reboots)

```bash
pm2 start server.js --name papa777-chat
pm2 save
pm2 startup   # follow the printed instructions to survive a droplet reboot
```

### 6. Point ca-api.papa777.sbs at the droplet

Wherever papa777.sbs's DNS is managed, change `ca-api`'s A record (or
CNAME) to point at `143.244.133.163` instead of the Hostinger shared server.

### 7. Put a reverse proxy + TLS in front (required for wss://)

The app connects over `wss://` (TLS), and this service listens on plain
HTTP on `$PORT` (3000 by default) - something needs to terminate TLS in
front of it. Nginx + certbot is the standard way:

```bash
apt-get install -y nginx certbot python3-certbot-nginx
```

Nginx site config (`/etc/nginx/sites-available/ca-api`):
```nginx
server {
    listen 80;
    server_name ca-api.papa777.sbs;
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```
Then:
```bash
ln -s /etc/nginx/sites-available/ca-api /etc/nginx/sites-enabled/
nginx -t && systemctl reload nginx
certbot --nginx -d ca-api.papa777.sbs
```
Certbot rewrites the config to add the TLS block and 80->443 redirect
automatically.

## Verifying it's live

```bash
curl https://ca-api.papa777.sbs/                                    # -> "papa777 chat service"
curl https://ca-api.papa777.sbs/v1/api/get-all-topics                # -> 401 (no token) or topics list (with one)
```

## Local development

```bash
cp .env.example .env   # fill in real values, or point DB_HOST at an SSH
                        # tunnel to the Hostinger DB for local testing
npm install
npm start
```
# chat-server
