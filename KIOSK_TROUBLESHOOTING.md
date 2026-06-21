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

The Pi has three ALSA playback devices: the 3.5mm headphone jack (card 0) and two HDMI outputs (cards 1 and 2, one per HDMI port). `/etc/asound.conf` pins a single system-wide default card - if it points at the headphone jack while the display's speakers are on HDMI, every TTS/audio call succeeds in the browser (`audio.play()` resolves with no error) but nothing is audible, because it's playing into a jack with nothing plugged in.

### Check what's actually connected

```sh
for f in /sys/class/drm/*HDMI*/status; do echo "$f:"; cat "$f"; done
aplay -l   # lists card 0 (Headphones), card 1 (vc4hdmi0), card 2 (vc4hdmi1)
```

`HDMI-A-1` connected maps to ALSA card 1 (`vc4hdmi0`); `HDMI-A-2` maps to card 2.

### Point the default device at the right HDMI output

```sh
sudo cp /etc/asound.conf /etc/asound.conf.bak
echo 'defaults.pcm.card 1
defaults.ctl.card 1' | sudo tee /etc/asound.conf
```

(Use `2` instead of `1` if the display is on the second HDMI port.)

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
