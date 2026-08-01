# Remote access to the kiosk host

Browser-based shell + screen viewing for the G11, replacing what Raspberry Pi
Connect did on the old Pi 4. Pi Connect and RealVNC's bundled service are both
tied to Pi hardware / Pi OS, so neither survived the 2026-08-01 migration.

Two tools, two jobs:

| | URL | What it gives you |
|---|---|---|
| **Cockpit** | `https://192.168.0.183:9090` | Terminal, systemd (start/stop `dashboard.service`, watch `dashboard-deploy.timer`), searchable journal, CPU/RAM/temp graphs |
| **noVNC** | `http://192.168.0.183:6080/vnc.html` | The actual kiosk screen, live, viewable and drivable from a browser tab |

Both are free and fully local — Debian repo packages, no account, no cloud
relay, no licence. "VNC" here is the protocol; the implementation is **x11vnc**
(GPL), not RealVNC's paid product.

## Install

Run on the kiosk host. Idempotent — safe to re-run.

```bash
ssh pi-dashboard
~/dashboard/deploy/install-remote-access.sh
```

Two prompts:

- **sudo password** — the existing Linux password for the `dashboard` account.
  Needed because `sudo` on this box is narrowed to three passwordless
  `systemctl` commands; apt and `/etc` writes fall outside that.
- **VNC password** — you invent it at the prompt. Stored at `/etc/x11vnc.pass`
  (root, 0600). Keep it *different* from the account password: the VNC scheme
  silently truncates to 8 characters.

Cockpit takes the system password instead (it authenticates through PAM), so
there is nothing extra to set for it.

## Architecture

```
browser ──http:6080──> websockify ──127.0.0.1:5900──> x11vnc ──> Xorg :0
                       (kiosk-novnc)                  (kiosk-x11vnc)   (the real panel)
```

x11vnc attaches to the **existing** display rather than spawning its own, so
you see exactly what is on the 32" panel — not a parallel desktop. Port 5900 is
bound to localhost only; websockify is the sole front door.

Units live in this directory and are installed to `/etc/systemd/system/`:
`kiosk-x11vnc.service`, `kiosk-novnc.service`.

## Gotchas

These are the ones that cost real time, in the order you're likely to hit them.

**`http://host:6080/` looks broken.** The Debian noVNC web root ships no
`index.html`. The entry point is **`/vnc.html`**. Nothing is wrong.

**`websockify: command not found` after installing `websockify`.** The CLI is in
**`python3-websockify`**. Debian's `websockify` package ships only
`/usr/bin/rebind`. The installer pulls both.

**x11vnc dies with `XOpenDisplay failed`.** Xorg here is started by lightdm with
`-auth /var/run/lightdm/root/:0`, which is root-readable only. The unit passes
that path explicitly and runs as root for exactly this reason. This reads like a
permissions bug but is a missing-flag bug.

**Screen is frozen while the panel is clearly updating.** x11vnc trusts X damage
events by default. Uncomment `-noxdamage` in `kiosk-x11vnc.service` to poll the
framebuffer instead, then `daemon-reload` and restart. Costs noticeably more
CPU.

**Parts of the dashboard render black.** Chromium composites through the GPU and
X11 framebuffer capture does not always see GPU-presented surfaces — the same
class of problem as CDP screencast being blind to hardware video — which is why
`scripts/kiosk/` probes playback via `getVideoPlaybackQuality` rather than by
screenshotting it. Weather background loops and video are the likely casualties.
`-noxdamage` sometimes helps; a compositor change is the real fix if it matters.

**Nothing responds after a lightdm restart.** x11vnc exits when X goes away.
`Restart=always` re-arms it within 5s; if it's still down,
`systemctl status kiosk-x11vnc`.

## CPU cost

`-wait 100 -defer 100` caps updates at ~10fps rather than the ~30fps default —
plenty for reading a dashboard and meaningfully cheaper. With no viewer
connected x11vnc costs ~nothing, so leaving it enabled does not eat into the
quiescent budget (≤8% of a core; see `docs/audit/HOST-BASELINES.md`). While
you're actively watching, expect it to register — don't mistake your own VNC
session for a dashboard regression when reading `scripts/kiosk/gpucpu.sh`.

## Changing the VNC password

```bash
sudo rm /etc/x11vnc.pass
~/dashboard/deploy/install-remote-access.sh   # re-prompts, skips the rest
sudo systemctl restart kiosk-x11vnc
```

## Security posture

LAN-only by design. websockify binds `0.0.0.0:6080`; to narrow it to one
interface, replace `0.0.0.0` with the LAN IP in `kiosk-novnc.service`.

Do **not** port-forward either service. noVNC is unencrypted HTTP and the VNC
password is weak by construction; Cockpit on 9090 is a root-capable admin
console. For access from outside the house, put Tailscale (free tier) in front
rather than opening ports — it would also give the voice STT lane a stable IP
and retire the recurring DHCP drift problem.

## Uninstall

```bash
sudo systemctl disable --now kiosk-novnc kiosk-x11vnc cockpit.socket
sudo rm /etc/systemd/system/kiosk-{novnc,x11vnc}.service /etc/x11vnc.pass
sudo systemctl daemon-reload
sudo apt-get purge -y cockpit x11vnc novnc python3-websockify
```
