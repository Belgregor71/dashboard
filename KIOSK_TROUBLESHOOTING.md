# Raspberry Pi kiosk troubleshooting

## Chromium shows `ERR_CONNECTION_REFUSED` for `localhost`

`ERR_CONNECTION_REFUSED` means Chromium reached the Raspberry Pi network stack, but nothing was listening on the requested port. For this dashboard, that usually means the Node server is not running or crashed before binding `localhost:3000`.

### Quick checks on the Pi

Run these from the dashboard checkout:

```sh
cd /path/to/dashboard
npm install
npm start
```

Then, in another terminal, verify the local HTTP server responds:

```sh
curl -I http://127.0.0.1:3000/
```

Expected result: `HTTP/1.1 200 OK`. If this fails, inspect the server logs rather than Chromium network settings.

### If the server is started by systemd

Make sure the service starts in the repository directory so Node can find `package.json`, static files, and the `.env` file:

```ini
[Service]
WorkingDirectory=/path/to/dashboard
ExecStart=/usr/bin/npm start
Restart=always
Environment=NODE_ENV=production
```

After editing the service:

```sh
sudo systemctl daemon-reload
sudo systemctl restart dashboard
sudo systemctl status dashboard --no-pager
journalctl -u dashboard -n 100 --no-pager
```

### Environment file notes

The server now loads `.env` from the same directory as `server.js`, even if systemd starts it from a different working directory. This prevents a missing environment file from crashing the app before the HTTP listener starts.

Home Assistant is enabled by default. If you want the dashboard to run without Home Assistant while debugging startup, add this to `.env`:

```sh
HA_ENABLED=0
```

If Home Assistant is enabled, set both values:

```sh
HA_HOST=http://homeassistant.local:8123
HA_TOKEN=your_long_lived_token
```
