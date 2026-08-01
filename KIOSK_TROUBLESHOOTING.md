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

## No audio (TTS plays in software but nothing comes out of the display)

`/etc/asound.conf` pins the system-wide default. If it points anywhere other than the HDMI output carrying the display's speakers, every TTS/audio call succeeds in the browser (`audio.play()` resolves with no error) and nothing is audible.

> **This section previously described the Pi's layout incorrectly in both directions** — it
> claimed headphones were card 0 with HDMI on 1 and 2, and that `asound.conf` pinned card 1.
> The Pi's real layout was card 0 `vc4hdmi0` (the *connected* panel), card 1 `vc4hdmi1`
> (disconnected), card 2 `Headphones`, pinned to card **0**. Never port a card number from
> this or any doc — **derive it from ELD**, below.

### Find the live output from ELD, don't guess

The only reliable signal is which HDMI audio device has a monitor actually attached:

```sh
for f in /proc/asound/card*/eld*; do
  echo "--- $f"; grep -E 'monitor_present|eld_valid|monitor_name' "$f" 2>/dev/null
done
aplay -l
```

The device with `monitor_present 1` / `eld_valid 1` is the one wired to the panel. `eld#N.M`
maps to card `N`, and `M` indexes that card's HDMI devices **in `aplay -l` order** (not to the
device number itself).

**On the G11 (AMD):** HDMI audio is **one card with several devices** — `card 0
[HD-Audio Generic]` exposing devices 3, 7, 8 and 9, plus `card 1` for the ALC233 analog jack.
`defaults.pcm.card N` alone is therefore **insufficient**; the device must be named too:

```sh
sudo cp /etc/asound.conf /etc/asound.conf.bak
sudo tee /etc/asound.conf <<'EOF'
pcm.!default {
    type plug
    slave.pcm { type hw; card 0; device 3 }
}
ctl.!default { type hw; card 0 }
EOF
```

(`card 0 device 3` is correct for the current panel — `eld#0.0` shows `monitor_present 1`.
**Re-derive it if the panel or HDMI port changes.**)

**On the Pi 4 (rollback host):** each HDMI port is its own card, so the simpler
`defaults.pcm.card N` / `defaults.ctl.card N` form is enough — card **0** for the panel.

### Test before involving the browser at all

```sh
aplay -D default /path/to/any.wav
```

If that's silent, it's still a hardware/ALSA config issue, not the app. If it plays, restart the kiosk so Chromium reopens its audio device against the new default - it caches the device at browser launch, so just reloading the page isn't enough:

```sh
sudo systemctl restart dashboard-kiosk.service
```

### Volume

```sh
amixer -c 1 sset PCM 100%   # 100% is 0.00dB - the ceiling for this device, no further gain available
```

If it's still too quiet at 100%, the next lever is the display's own physical volume control, not the Pi.
