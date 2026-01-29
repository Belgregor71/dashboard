# Camera Integration Guide (Home Assistant + go2rtc)

This dashboard proxies camera streams and snapshots through the dashboard server so the Pi browser only talks to **one origin**, avoiding CORS/mixed-content issues.

## 1) Environment variables

Copy `.env.example` to `.env` and set the LAN IPs for Home Assistant and go2rtc:

```bash
HA_HOST=http://192.168.1.10:8123
GO2RTC_HOST=http://192.168.1.10:1984
HA_TOKEN=your_long_lived_token
```

> **Tip:** Never use `localhost` here unless Home Assistant/go2rtc are running on the same host as the dashboard.

## 2) Camera configuration

Camera tiles are defined in `config/cameras.js`. Update the IDs and stream paths to match your go2rtc mapping:

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

If you already have the Eufy integration in Home Assistant exposing RTSP, point go2rtc at those RTSP URLs. Keep the names (`kitchen`, `piano_room`, etc.) aligned with `config/cameras.js`.

## 4) Validate from the Pi

From the Pi browser, check:

* `http://<dashboard-host>:3000/api/camera/kitchen/snapshot`
* `http://<dashboard-host>:3000/api/camera/kitchen/stream?type=hls`

If those work, the dashboard tiles should render without CORS or mixed-content errors.
