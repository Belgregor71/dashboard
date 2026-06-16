# Family Dashboard

Always-on home dashboard for a Raspberry Pi 4 + 32-inch landscape display.

## Stack

| Layer | Tech |
|---|---|
| Server | Node.js / Express (ES modules) — `server.js` entry point |
| Frontend | Vanilla JS (~50 modules), no framework |
| Build | Vite 6 — `src/` → `dist/` |
| Display | Chromium in `--kiosk` mode via systemd |

The server runs on port **3000** and serves the Vite-built `dist/` folder (falling back to `static/` if no build exists). All external API calls are proxied through the server so the browser never talks to outside services directly.

## Project layout

```
server.js              # Express entry point
server/
  routes/              # One file per feature (weather, calendar, cameras, …)
  ha/                  # Home Assistant WebSocket bridge + REST helpers
  utils/               # fetchWithTimeout
config/
  cameras.js           # Static camera config (entities, snapshot sources)
  ha.js                # HA connection settings
src/                   # Vite source (edit here)
  index.html
  js/
    core/              # app.js, config.js, viewManager.js, voiceCommands.js, …
    modules/           # One file per widget/feature
    services/          # Home Assistant SSE client, calendar, weather parsers
  css/
    components/        # Split CSS — one file per component
dist/                  # Vite build output (served by Express, git-ignored)
static/                # Non-built assets: photos, icons, weather videos, data/
  js/                  # Mirror of src/js/ — used when dist/ doesn't exist
  css/
```

## Active integrations

- **Eufy cameras** (front_door, front_yard, driveway, backyard, patio, side_gate, tilt_pan) via HA HACS + go2rtc RTSP
- **Home Assistant** — WebSocket bridge for live state, camera/image proxy
- **Plex** — now-playing status
- **Sonos** — media status via HA WebSocket
- **Weather** — BOM + Open-Meteo, rain radar
- **Calendars** — iCal URLs (direct, no Google API)
- **ABC news ticker** — RSS
- **Ollama AI briefing** — morning + evening scheduled summaries
- **Voice commands** — Web Speech API, spacebar toggle, `en-AU`

## Setup

```bash
# Install all dependencies
npm install

# Development (Vite HMR on :5173, server on :3000)
npm run dev        # Vite dev server
node server.js     # Run in a second terminal

# Production build
npm run build      # Outputs to dist/
npm start          # Serves dist/ on :3000
```

Copy `.env.example` to `.env` and fill in:

```env
HA_HOST=http://192.168.0.x:8123
HA_TOKEN=your_long_lived_token
GO2RTC_HOST=http://192.168.0.x:1984
```

## Pi deployment

Dashboard lives at `/home/dashboard/dashboard` on the Pi, run as two separate
systemd services — never start it under PM2 as well; a second process fighting
over port 3000 will crash-loop forever (`EADDRINUSE`) without ever actually
restarting the live server.

```bash
git pull
npm install
npm run build      # vite is a local devDependency — use npm run build, not vite directly
sudo systemctl restart dashboard
```

`/etc/systemd/system/dashboard.service` — the Node server (runs as the
dedicated `dashboard` user):

```ini
[Unit]
Description=Dashboard Web Server
After=network-online.target calendar.service
Wants=network-online.target

[Service]
Type=simple
User=dashboard
WorkingDirectory=/home/dashboard/dashboard
ExecStart=/usr/bin/node /home/dashboard/dashboard/server.js
Restart=on-failure
Environment=NODE_ENV=production
Environment=PORT=3000

[Install]
WantedBy=multi-user.target
```

`/etc/systemd/system/dashboard-kiosk.service` — Chromium kiosk (runs as `pi`
so it can attach to the X session on `:0`):

```ini
[Unit]
Description=Dashboard Kiosk
After=network-online.target

[Service]
User=pi
Environment=XAUTHORITY=/home/pi/.Xauthority
Environment=DISPLAY=:0
ExecStart=/usr/bin/chromium-browser \
  --noerrdialogs \
  --disable-infobars \
  --kiosk http://localhost:3000 \
  --incognito \
  --check-for-update-interval=31536000 \
  --disable-session-crashed-bubble \
  --overscroll-history-navigation=0

Restart=always
RestartSec=10

[Install]
WantedBy=graphical.target
```

Useful checks after deploying:

```bash
systemctl status dashboard --no-pager
systemctl status dashboard-kiosk --no-pager
journalctl -u dashboard -n 100 --no-pager
```

## Adding a widget

1. Add a route file in `server/routes/` and mount it in `server.js`
2. Add a module in `src/js/modules/` that calls the endpoint
3. Wire it into `src/js/core/app.js`
4. Add CSS in `src/css/components/`
5. Run `npm run build` to update `dist/`
