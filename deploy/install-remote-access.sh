#!/usr/bin/env bash
#
# Install browser-based remote access on the kiosk host (GMKtec G11, Debian 13).
#
#   Cockpit  -> https://<host>:9090        shell, systemd, journal, temps
#   noVNC    -> http://<host>:6080/vnc.html   watch/drive the actual kiosk screen
#
# Replaces what Raspberry Pi Connect used to do on the old Pi 4.
# Run ON the kiosk host. Idempotent - safe to re-run.
#
#   ssh pi-dashboard
#   ~/dashboard/deploy/install-remote-access.sh
#
# Needs a real sudo password: sudo on this box is narrowed to three passwordless
# systemctl commands, so package installs will prompt.

set -euo pipefail

UNIT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VNC_PASS_FILE=/etc/x11vnc.pass
NOVNC_PORT=6080
COCKPIT_PORT=9090

die() { echo "ERROR: $*" >&2; exit 1; }
say() { echo; echo "==> $*"; }

# --- Guards ---------------------------------------------------------------
[[ -e /usr/bin/apt-get ]] || die "Not a Debian/apt host. Run this on the kiosk."
[[ -e /tmp/.X11-unix/X0 ]] || die "No X display :0 found. Is the kiosk session up?"
for u in kiosk-x11vnc.service kiosk-novnc.service; do
    [[ -f "$UNIT_DIR/$u" ]] || die "Missing $u next to this script (expected in $UNIT_DIR)."
done

say "Requesting sudo (needed for apt + /etc + systemd units)"
sudo -v || die "sudo failed."

# --- Packages -------------------------------------------------------------
# python3-websockify is the one that ships /usr/bin/websockify; the 'websockify'
# package ships only /usr/bin/rebind, which is a genuinely confusing dead end.
say "Installing cockpit, x11vnc, novnc, python3-websockify"
sudo apt-get update
sudo DEBIAN_FRONTEND=noninteractive apt-get install -y \
    cockpit x11vnc novnc python3-websockify

command -v websockify >/dev/null || die "websockify still not on PATH after install."
[[ -f /usr/share/novnc/vnc.html ]] || die "noVNC web root missing /vnc.html."

# --- VNC password ---------------------------------------------------------
# websockify binds to the LAN, so this password is the only thing standing
# between the house network and control of the kiosk. Not optional.
if sudo test -s "$VNC_PASS_FILE"; then
    say "VNC password already set at $VNC_PASS_FILE (delete it and re-run to change)"
else
    say "Set a VNC password (used when you open the noVNC page)"
    read -rsp "  VNC password: " vncpass; echo
    read -rsp "  Confirm:      " vncpass2; echo
    [[ "$vncpass" == "$vncpass2" ]] || die "Passwords did not match."
    [[ -n "$vncpass" ]] || die "Empty password refused."
    # x11vnc truncates to 8 chars, silently. Say so rather than let it surprise you.
    [[ ${#vncpass} -le 8 ]] || echo "  note: VNC only uses the first 8 characters."
    sudo x11vnc -storepasswd "$vncpass" "$VNC_PASS_FILE" >/dev/null
    unset vncpass vncpass2
fi
sudo chown root:root "$VNC_PASS_FILE"
sudo chmod 600 "$VNC_PASS_FILE"

# --- Units ----------------------------------------------------------------
say "Installing systemd units"
sudo install -m 0644 "$UNIT_DIR/kiosk-x11vnc.service" /etc/systemd/system/
sudo install -m 0644 "$UNIT_DIR/kiosk-novnc.service"  /etc/systemd/system/
sudo systemctl daemon-reload

say "Enabling services"
sudo systemctl enable --now cockpit.socket
sudo systemctl enable --now kiosk-x11vnc.service
sudo systemctl enable --now kiosk-novnc.service

# --- Verify ---------------------------------------------------------------
say "Verifying"
sleep 2
fail=0
for svc in cockpit.socket kiosk-x11vnc.service kiosk-novnc.service; do
    if systemctl is-active --quiet "$svc"; then
        echo "  OK      $svc"
    else
        echo "  FAILED  $svc"
        systemctl --no-pager --lines=15 status "$svc" || true
        fail=1
    fi
done

ip=$(hostname -I 2>/dev/null | awk '{print $1}')
echo
if [[ $fail -eq 0 ]]; then
    echo "Done."
    echo "  Cockpit : https://${ip}:${COCKPIT_PORT}          (log in as 'dashboard', system password)"
    echo "  Screen  : http://${ip}:${NOVNC_PORT}/vnc.html    (VNC password set above)"
    echo
    echo "The noVNC page is /vnc.html - the web root has no index, so a bare"
    echo "http://${ip}:${NOVNC_PORT}/ will look broken. That is expected."
else
    echo "One or more services failed to start - see the status output above."
    exit 1
fi
