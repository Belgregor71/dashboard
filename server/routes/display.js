import express from "express";
import { execFile } from "child_process";
import { loopbackOnly } from "../middleware/security.js";

const router = express.Router();

// Audit M11 / SS4. The report says there is no hardware display-power control.
// There is — the Pi's `dashboard` crontab has carried it all along:
//
//   0 21 * * * DISPLAY=:0 xset dpms force off
//   0 5  * * * DISPLAY=:0 xset dpms force on
//
// What was missing is any way to INTERRUPT that window. Between 21:00 and
// 05:00 a doorbell ring still speaks its TTS and still draws the camera popup,
// to a panel that is powered down. This route is the interrupt: a security
// event lights the panel for a hold, then it goes back down on its own.
//
// Deliberately narrow — "security events only" was the call. Kitchen presence
// does NOT reach here: someone up at 2am for a glass of water should not get a
// 32" dashboard in the face. The caller is cameraPopupOverlay, gated on the
// same isLiveWorthy set the wake gate uses, so one rule decides both.

// xset works from cron with DISPLAY alone (verified as the dashboard user on
// the Pi — X allows same-user local connections), so no XAUTHORITY is needed.
const DISPLAY = ":0";
const XSET_TIMEOUT_MS = 4000;

let restoreTimer = null;
let litUntil = 0;

// Read per-request, never at module load: ES imports hoist above server.js's
// dotenv.config(), so a module-level process.env read is frozen to its default
// and the documented knob is silently unsettable (the KOKORO_VOICE /
// TTS_CACHE_MAX_BYTES trap, twice over).
function offWindow() {
  const start = String(process.env.DISPLAY_OFF_START ?? "21:00");
  const end   = String(process.env.DISPLAY_OFF_END   ?? "05:00");
  return { start, end };
}

function holdMs() {
  const raw = Number(process.env.DISPLAY_WAKE_HOLD_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : 90000;
}

function toMinutes(hhmm) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm).trim());
  if (!match) return null;
  const h = Number(match[1]);
  const m = Number(match[2]);
  if (h > 23 || m > 59) return null;
  return h * 60 + m;
}

// The window wraps midnight, so a naive start<=now<end is wrong for every real
// setting of it. Exported for the contract test — this is the part worth pinning.
export function isWithinOffWindow(now, start, end) {
  const s = toMinutes(start);
  const e = toMinutes(end);
  if (s === null || e === null) return false;
  const minutes = now.getHours() * 60 + now.getMinutes();
  if (s === e) return false;              // degenerate: never off
  if (s < e) return minutes >= s && minutes < e;
  return minutes >= s || minutes < e;     // wraps midnight (21:00 → 05:00)
}

function xset(action) {
  return new Promise((resolve) => {
    execFile(
      "xset",
      ["dpms", "force", action],
      { env: { ...process.env, DISPLAY }, timeout: XSET_TIMEOUT_MS },
      (error) => resolve(error ? { ok: false, error: error.message } : { ok: true })
    );
  });
}

// POST /api/display/wake — light the panel for a hold, then let it fall back.
// Idempotent by design: a second event inside the hold extends it rather than
// stacking timers, since a ring often arrives as several entity updates.
router.post("/api/display/wake", loopbackOnly("Display control"), async (req, res) => {
  const { start, end } = offWindow();
  const now = new Date();

  if (!isWithinOffWindow(now, start, end)) {
    // Outside the window the panel is already on and the crontab owns it.
    // Doing nothing is the correct answer, not an error.
    return res.json({ woken: false, reason: "outside-off-window", window: { start, end } });
  }

  const result = await xset("on");
  if (!result.ok) {
    return res.status(503).json({ woken: false, error: "xset failed", detail: result.error });
  }

  const hold = holdMs();
  litUntil = Date.now() + hold;
  if (restoreTimer) clearTimeout(restoreTimer);
  restoreTimer = setTimeout(async () => {
    restoreTimer = null;
    // Re-check the window at restore time, not at wake time: a ring at 04:59
    // must not power the panel down again at 05:00:30, seconds after the
    // crontab brought it up for the day.
    if (isWithinOffWindow(new Date(), start, end)) await xset("off");
  }, hold);
  // Never keep the process alive for this — it is a courtesy, not work.
  restoreTimer.unref?.();

  res.json({ woken: true, holdMs: hold, window: { start, end } });
});

// Reads X's own view. `dpmsEnabled` is load-bearing and worth exposing: the Pi
// has TWO boot-time actors running `xset -dpms` (a failed
// ~/.config/systemd/user/disable-dpms.service and the LXDE autostart). They are
// currently losing, which is the only reason the 21:00 crontab can blank the
// panel at all. If one ever wins, the whole off-window stops silently and this
// field is how you find out.
function readDpmsState() {
  return new Promise((resolve) => {
    execFile(
      "xset",
      ["q"],
      { env: { ...process.env, DISPLAY }, timeout: XSET_TIMEOUT_MS },
      (error, stdout) => {
        if (error) return resolve({ dpmsEnabled: null, monitor: null });
        resolve({
          dpmsEnabled: /DPMS is Enabled/i.test(stdout),
          monitor: /Monitor is (\w+)/i.exec(stdout)?.[1]?.toLowerCase() ?? null
        });
      }
    );
  });
}

// GET /api/display/state — what the route believes, for verification on the Pi.
router.get("/api/display/state", async (req, res) => {
  const { start, end } = offWindow();
  const x = await readDpmsState();
  res.json({
    window: { start, end },
    withinOffWindow: isWithinOffWindow(new Date(), start, end),
    holdMs: holdMs(),
    litUntil: litUntil > Date.now() ? new Date(litUntil).toISOString() : null,
    ...x
  });
});

export default router;
