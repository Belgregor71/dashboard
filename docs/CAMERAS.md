# Camera Integration Guide (Home Assistant + go2rtc)

This dashboard proxies camera streams and snapshots through the dashboard server so the Pi browser only talks to **one origin**, avoiding CORS/mixed-content issues.

## 1) Environment variables

Copy `.env.example` to `.env` and set the LAN IPs for Home Assistant and go2rtc:

```bash
HA_HOST=http://192.168.0.179:8123
GO2RTC_HOST=http://192.168.0.179:1984
HA_TOKEN=your_long_lived_token
```

> **Tip:** Never use `localhost` here unless Home Assistant/go2rtc are running on the same host as the dashboard.

### Home Assistant websocket auth

The dashboard server owns the Home Assistant websocket connection and authenticates with `HA_TOKEN`. Browser clients subscribe to `/api/ha/stream`, so the long-lived token is not exposed to the kiosk browser.

If Home Assistant logs repeated invalid authentication for `/api/websocket` from the dashboard host, check that `HA_TOKEN` is a current long-lived access token for an enabled Home Assistant user. Restart the dashboard after changing the token. The server stops retrying after Home Assistant returns `auth_invalid` to avoid repeated failed-login events and possible HTTP bans.

## 2) Camera configuration

Camera tiles are defined in `server/config/cameras.js`. Update the IDs and stream paths to match your go2rtc mapping:

```js
export const CAMERA_CONFIG = [
  {
    id: "kitchen",
    name: "Kitchen",
    entity: "camera.kitchen",
    mode: "live",
    streamType: "webrtc",
    streamFallbacks: ["hls", "mjpeg"],
    streamPaths: {
      webrtc: "/api/webrtc?src=kitchen",
      hls: "/api/hls?src=kitchen",
      mjpeg: "/api/mjpeg?src=kitchen"
    },
    snapshotPath: "/api/camera_proxy/camera.kitchen"
  }
];
```

## 2a) Motion popup snapshot behavior

The motion popup overlay now renders a **still snapshot image** (not a live iframe stream) from:

* `/api/camera/<camera_id>/snapshot?ts=<cachebuster>`

The server prefers each camera's `eventImageEntity` (for example `image.<camera>_event_image`) and automatically falls back to `cameraEntity` via Home Assistant camera proxy when the event image is missing/unavailable.

Near-real-time Home Assistant entity changes are delivered through the server-side websocket bridge and `/api/ha/stream`.

Current assumptions in `server/config/cameras.js` include:

* `doorbell` uses `image.doorbell_event_image`
* `backyard` uses `image.backyard_event_image`

If those entities don't exist in your HA instance, snapshot fallback still uses camera proxy.

## 3) go2rtc mapping

Make sure go2rtc knows about each stream name referenced above. Example `go2rtc.yaml`:

```yaml
streams:
  kitchen: rtsp://USER:PASS@CAMERA_IP/live0
  piano_room: rtsp://USER:PASS@CAMERA_IP/live0
  tilt_pan: rtsp://USER:PASS@CAMERA_IP/live0
  doorbell: rtsp://USER:PASS@CAMERA_IP/live0
  front_yard: rtsp://USER:PASS@CAMERA_IP/live0
  driveway: rtsp://USER:PASS@CAMERA_IP/live0
  backyard: rtsp://USER:PASS@CAMERA_IP/live0
  patio: rtsp://USER:PASS@CAMERA_IP/live0
  side_gate: rtsp://USER:PASS@CAMERA_IP/live0
```

If you already have the Eufy integration in Home Assistant exposing RTSP, point go2rtc at those RTSP URLs. Keep the names (`kitchen`, `piano_room`, etc.) aligned with `server/config/cameras.js`.

## 4) Validate from the Pi

From the Pi browser, check:

* `http://<dashboard-host>:3000/api/camera/kitchen/snapshot`
* `http://<dashboard-host>:3000/api/camera/kitchen/stream?type=hls`

If those work, the dashboard tiles should render without CORS or mixed-content errors.

### Troubleshooting

* **`/api/image_proxy/...` or `/api/camera_proxy/...` returns 503**: the dashboard server did not load `HA_HOST` (and optionally `HA_TOKEN`). Confirm `.env` exists, restart the server, and avoid `localhost` in `HA_HOST` unless Home Assistant is running on the same host.
