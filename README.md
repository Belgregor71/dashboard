# Family Dashboard

An always-on home display on a 32-inch landscape screen. It runs as a kiosk and
spends most of its time quiet. It puts one thing on the wall when something
deserves attention, and it talks when spoken to.

It ran on a Raspberry Pi 4 until 2026-08-01. It now runs on a **GMKtec G11 mini PC**
(AMD Ryzen Embedded R2514, Vega 8, 16 GB, Debian 13 + X11). The Pi is kept, code-current,
as a warm rollback host. The repo name and the package description still say "pi"
for historical reasons.

## Stack

| Layer | Tech |
|---|---|
| Server | Node.js / Express (ES modules): `server.js` mounts 32 route modules from `server/routes/` under `/api` |
| Frontend | Vanilla JS, no framework. Two surfaces (see below) |
| Rendering | DOM + CSS, with a WebGL/Canvas2D substrate (`src/v3/substrate/`) for the living weather field |
| Build | Vite 6: `src/` → `dist/`, plus `static/js/config.js` copied on every build |
| Display | Chromium in `--kiosk` mode under systemd, CDP on `127.0.0.1:9222` |
| Voice | On-device wake word + faster-whisper STT + Kokoro TTS, all on the kiosk host |
| Tests | Playwright: 136 spec files, API contracts through browser specs |

The server listens on port **3000** and serves the built `dist/` folder. Every external
call goes through the server, so the browser never talks to an outside service directly.

## Two frontends

- **`src/v3/`** is the current surface and is what `/` serves
  (`DEFAULT_ROOT_SURFACE` in `server/config.js`). It is a single composed wall rather
  than a set of pages: `core/` (attention, composer, presence, archive, voice, timers…),
  `subjects/` (what can be said: calendar, forecast, briefing, media, memories…),
  `substrate/` (the GPU field) and `css/`.
- **`src/js/`** is the incumbent dashboard. It is still reachable at `/index.html`, and it
  is **not dead code**: V3 imports a closure of modules from it. The authoritative list is
  the manifest in `tests/v3-closure.spec.js`.

The same feature often exists in both trees. Check which surface a change targets before
editing it.

**Surface rollback without a deploy:** set `V3_DEFAULT=0` in the host's `.env` and restart
`dashboard.service` to put the incumbent back on `/`. `V3_DEFAULT=1` forces V3, and
leaving it unset falls through to the committed default.

## Presence and the House Mind

The dashboard has a **presence-first behavioural layer** that decides *what deserves the
screen right now* and gets out of the way when nothing does.

- **Presence modes.** Ambient (nobody near: the photo archive, weather-tinted light, a dim
  clock), then Glance (motion: one hero), Lean-in (dwell: the next few things) and
  Conversation (voice).
- **One attention engine, one ranked queue.** Every source emits scored candidates with
  decay and cooldowns, and the presence mode sets the floor. Most of the time the screen
  stays calm.
- **The House Mind** is an event registry, a shared observation store (one poll feeds the
  field, the glance and the voice) and an arbiter over what speaks. Reflexes such as the
  doorbell, timers and barge-in stay local and fast. Design and slice status:
  [`docs/design/HOUSE-MIND.md`](docs/design/HOUSE-MIND.md).
- **On-device learning** folds household rhythms into bounded aggregates. A routine may
  decide *when* a card appears (the weekday departure card, for example). Its words cite
  only live facts.
- **One temperament** (`personality.js`, [`docs/design/CHARACTER.md`](docs/design/CHARACTER.md),
  [`docs/design/VOICE.md`](docs/design/VOICE.md)) governs every line, silence and
  celebration.

The broader direction is in [`docs/vision/`](docs/vision/) and the design track in
[`docs/design/`](docs/design/). An interactive architecture diagram is at
[`docs/architecture/`](docs/architecture/).

## Active integrations

- **Home Assistant**: WebSocket bridge for live state, camera/image proxy, calendars,
  bins, Sonos, the BOM weather fallback, and assist for voice
- **Eufy cameras** via HA (HACS) + go2rtc RTSP, with doorbell/motion wake
- **Immich**: the ambient photo archive and memories
- **Plex, Sonos**: now playing
- **Sonarr / Radarr**: download progress + disk usage
- **Weather**: Open-Meteo forecasts, with BOM via HA as an optional fallback; drives the GPU field (rain, gusts, haze, moon)
- **Calendars**: iCal URLs (no Google API)
- **Commute, fuel prices, bins, NRL, ABC news**
- **AI briefings**: morning and evening summaries plus an ambient one-line concierge,
  written by Claude Haiku, with local Ollama as the automatic fallback (`server/routes/ai.js`)
- **Voice**: see below

## Voice

Everything runs on the kiosk host, and nothing leaves it until the wake word fires.

| Service | Source | What it does |
|---|---|---|
| `voice-agent` | `tools/voice-agent/` | USB mic → openWakeWord → endpointed capture → STT → `/api/voice/transcript` |
| `voice-stt` | `tools/voice-pc/stt_server.py` | faster-whisper `base.en` int8, loopback only |
| `voice-tts` | `tools/voice-pc/tts_server.py` | Kokoro TTS; the dashboard falls back to browser `speechSynthesis` |

Transcripts go through local commands first, then Home Assistant assist, then Claude.
Units live in [`deploy/`](deploy/). Transcripts are logged in
`journalctl -u voice-agent` and are deliberately not stored on disk.

## Feature flags

New behaviour ships **flag-gated and default-off**. The flags live in `src/js/config.js`
under `features:` (102 of them) and are copied to `static/js/config.js` on build. **That
file is public and bundled, so never put a secret or an address in it.**

- A flag is flipped on only after it has been verified on the live wall. Each flip is its
  own deploy, and the rollback (flipping it back) is proven straight away.
  `npm run verify:flags -- --flag <name>` runs the suite in both states.
- A flag marked **`INERT-ON-V3`** is read only by the incumbent, so flipping it changes
  nothing on `/`. `tests/flag-surface.spec.js` derives these marks and keeps them honest.
- A flag change never changes a URL, so the kiosk needs a hard reload
  (`Page.reload({ignoreCache:true})`) before the change shows up.

## Setup

```bash
npm install

# Development
npm run dev        # Vite dev server
npm start          # Express on :3000 (second terminal)

# Production build
npm run build      # vite build + copy-static-config → dist/
npm start
```

Copy `.env.example` to `.env` and fill it in. That file documents every variable. The
essentials are:

```env
HA_HOST=http://homeassistant.local:8123
HA_TOKEN=your_long_lived_token
GO2RTC_HOST=http://<go2rtc-host>:1984
# Server-side location. Required for weather and AI context. The frontend has its
# own copy in src/js/config.js, and the server does NOT read it.
WEATHER_LAT=<lat>
WEATHER_LON=<lon>
```

If `HA_HOST` or `HA_TOKEN` is blank, HA turns itself off and `/api/ha/*` answers 503, but
the rest of the dashboard still runs. AI text works out of the box on local Ollama. If you
add `ANTHROPIC_API_KEY`, Claude Haiku is used whenever it is set, and any API error falls
back to Ollama.

## Testing

```bash
npm run build                          # browser specs need a build
npm test                               # full Playwright suite (test server on :3210, AI upstreams stubbed)
npx playwright test tests/<name>.spec.js
npm run verify:contrast                # contrast sweep over real backdrops
npm run verify:contracts               # route ↔ contract-test scan
npm run verify:patterns                # known-defect pattern scan
npm run verify:v3-coverage
```

- Contract tests assert known status sets and JSON shapes, never live data, because any
  upstream may be down on any machine. A new route gets its contract test in the same
  change.
- **Pre-push gate:** `git config core.hooksPath .githooks` wires up six gates (~60 s): a
  guard against a leftover temporary flag flip, the contract scan, the build, `npm test`,
  the pattern scan and the contrast sweep.
- Every new test should be able to fail. Inject the wrong answer the test is meant to
  catch, confirm the suite goes red, then restore it. Several green-but-blind tests have
  been caught this way.

## Deployment

Deploys are **pull-based**. A push to `origin/main` is picked up by the host's
`dashboard-deploy.timer` within 5 minutes. `deploy/update-dashboard.sh` pulls, runs
`npm run build` and restarts `dashboard.service`. To deploy immediately:

```bash
sudo systemctl start dashboard-deploy.service   # oneshot; blocks until done
```

After a deploy, the kiosk keeps running the old bundle until it reloads.

The dashboard lives at `/home/dashboard/dashboard` and runs as the `dashboard` user under
two systemd units. **Do not also run it under PM2.** A second process fighting over port
3000 crash-loops forever on `EADDRINUSE` and never actually restarts the live server.

`/etc/systemd/system/dashboard.service`, as captured from the live host:

```ini
[Unit]
Description=Dashboard Web Server
After=network-online.target
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

`/etc/systemd/system/dashboard-kiosk.service`. Runs as `dashboard`, the user lightdm
auto-logs into on `:0`. The binary is `/usr/bin/chromium`, not `chromium-browser`:

```ini
[Unit]
Description=Dashboard Kiosk
After=network-online.target

[Service]
User=dashboard
Environment=XAUTHORITY=/home/dashboard/.Xauthority
Environment=DISPLAY=:0
ExecStart=/usr/bin/chromium \
  --noerrdialogs \
  --disable-infobars \
  --kiosk http://localhost:3000 \
  --incognito \
  --check-for-update-interval=31536000 \
  --disable-session-crashed-bubble \
  --overscroll-history-navigation=0 \
  --autoplay-policy=no-user-gesture-required \
  --remote-debugging-port=9222 \
  --remote-debugging-address=127.0.0.1

Restart=always
RestartSec=10

[Install]
WantedBy=graphical.target
```

**The last three flags are load-bearing:**

- `--autoplay-policy=no-user-gesture-required`: the kiosk has no pointer. Without this
  flag, weather video **and all TTS audio** stop silently, with no error anywhere.
- `--remote-debugging-port=9222` / `--remote-debugging-address=127.0.0.1`: every script in
  `scripts/kiosk/` drives CDP on localhost, so without these the whole measurement and
  verification toolchain does nothing.

Install units from a capture of the running host, never from a doc. This block was
missing those three flags until 2026-08-01.

This unit must be the **only** thing that launches the kiosk Chromium. Older Raspberry Pi
OS images can leave a per-user `~/.config/systemd/user/kiosk.service` pointing at the same
URL. If both run, they fight over the profile lock and restart-loop on a grey screen.
Check with `systemctl --user list-units --all | grep -i kiosk` and disable any you find.

Other units on the host: `voice-agent`, `voice-stt`, `voice-tts`, and
`kiosk-x11vnc` + `kiosk-novnc`, which give a browser shell and a live view of the screen
([`deploy/REMOTE-ACCESS.md`](deploy/REMOTE-ACCESS.md)).

Useful checks:

```bash
systemctl status dashboard dashboard-kiosk --no-pager
journalctl -u dashboard -n 100 --no-pager
curl -s localhost:3000/api/system/metrics     # temps, load (no vcgencmd on the G11)
```

The CSP can be enforced per host (`CSP_ENFORCE=1` in `.env`). If an asset, font or stream
goes blank, check `curl -s localhost:3000/api/csp-report` first.

## Running 24/7

The page runs for weeks without a reload, so slow leaks are the main way it fails. The
house rules:

- Never rely on `transitionend`/`animationend` for cleanup alone. They never fire under
  `display:none`, so always pair them with a `setTimeout` fallback.
- Revoke every `URL.createObjectURL` on every terminal path. Blob memory doesn't show up
  in the JS heap.
- Per-event code paths need symmetric teardown, and on-disk caches keyed by dynamic text
  need pruning.
- Measure, don't reason: the `scripts/kiosk/` CDP probes compare the live heap, DOM,
  listeners and GPU cost against known baselines.

## Adding a feature

1. Add a route in `server/routes/`, mount it in `server.js`, and add its contract test in
   the same change.
2. Build the V3 side in `src/v3/` (a subject or a core module). Only touch `src/js/` if the
   incumbent needs it too, or if V3 already imports the module from there.
3. Put it behind a default-off flag in `src/js/config.js`.
4. Style it with design tokens (`src/v3/css/tokens.css`, `src/css/base/variables.css`,
   [`docs/STYLE_GUIDE.md`](docs/STYLE_GUIDE.md)).
5. `npm run build && npm test`, deploy, verify on the wall, then flip the flag.
