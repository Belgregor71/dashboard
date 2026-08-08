/* ═══════════════════════════════════════════════════════════════════════════
   DISPLAY — V3 knows whether the thing it is drawing to is switched on.

   Step 5.1 of docs/design/V3-MIGRATION.md, and the plan's one line for it
   ("Energy saver — display off overnight") turned out to describe a job that is
   already done. Worth writing down, because it is the whole reason this file
   looks nothing like the module it was supposed to port:

   ── What was actually true, measured on the G11 before any of this was written

   The panel ALREADY goes dark on V3. Display power has never been the page's
   job — it is the `dashboard` crontab, and it survived the Pi→G11 migration
   intact:

       0 21 * * * DISPLAY=:0 xset dpms force off
       0 5  * * * DISPLAY=:0 xset dpms force on

   DPMS is a property of the X display, not of the URL Chromium happens to be
   showing, so it has been powering V3's panel down at 21:00 exactly as it does
   the incumbent's. `GET /api/display/state` on the live box confirms it:
   `dpmsEnabled: true`, window 21:00→05:00.

   And the incumbent's modules/energySaver.js — the "91 lines" this step was
   scoped against — is very nearly a no-op. Its only real effect is an HA switch
   toggle behind `homeAssistant.energySaver.monitorEntityId`, which is `""`.
   What remains is a body class that paints the background black and hides three
   views V3 does not have. Porting it faithfully would have produced nothing.

   ── So what the gap really is ──────────────────────────────────────────────

   Two things, and neither is "turn the panel off".

   1. NOTHING CAN LIGHT THE PANEL. This is audit SS4, and V3 makes it sharper
      than the incumbent ever did. core/alerts.js is the one path that puts
      itself on the screen unasked: a doorbell at 3am forces depth 3, mounts the
      camera and speaks out loud — to a panel that is powered down. The picture
      is the half that matters and it is the half nobody sees.

   2. THE SURFACE KEEPS MOVING IN THE DARK. DPMS does not fire
      `visibilitychange`, so as far as the page is concerned nothing happened.
      The substrate's rAF loop is the only thing in V3 that runs continuously,
      and on a windy or rainy night it runs at 15fps until 05:00 for an empty
      room and a dead panel. That is the calm law's plainest possible violation:
      moving for a reason the room cannot see, where the room cannot see
      ANYTHING.

   ── The rule about waking, which was already decided ───────────────────────

   Security events only. That call is server/routes/display.js's, made when the
   route was written, and it is not re-litigated here: kitchen presence does NOT
   reach this file. Someone up at 2am for a glass of water should not get a 32"
   dashboard in the face. V3's alert path is exactly and only the front door and
   the side gate, so the two line up without needing a new rule.

   ── Why the X reading and not just the clock ───────────────────────────────

   The audit records a live fragility: two boot-time actors run `xset -dpms`
   (a failed user unit and the LXDE autostart). They are losing today, and that
   is the ONLY reason the crontab can blank the panel at all. If one ever wins,
   the off-window silently stops happening — and a client that believed the
   clock would pause the atmosphere on a fully lit panel every night, which
   reads as a frozen dashboard rather than as a broken assumption.

   So the clock is the trigger and X is the authority: the window says when to
   go and ASK, `monitor` says what is actually true. Unknown (no xset, i.e. any
   dev box) falls back to the window, and every unknown fails towards LIT.
   ═══════════════════════════════════════════════════════════════════════════ */

import { isWithinOffWindow } from "../../js/services/displayWindow.js";

/* Matches modules/energySaver.js CHECK_INTERVAL_MS. The transitions being
   watched for are on the minute (a crontab's are, by construction), so a
   minute's granularity is the most this can ever need. */
const CHECK_MS = 60_000;

/* While we believe the panel is dark, re-ask X this often anyway. Covers the
   case where something outside the dashboard lights it — noVNC, Cockpit, a
   hand on the keyboard — without polling localhost all day for an answer that
   only changes twice. */
const CONFIRM_MS = 5 * 60_000;

let timer = null;
let listeners = [];
let window_ = null;          // { start, end } from the server; null = unasked
let monitor = null;          // "on" | "off" | null (no xset — dev box)
let monitorAt = 0;
let dark = false;
let litUntil = 0;
let lastWindowBelief = null;
let wakes = 0;

/* Read per-call, never at module load: ES imports hoist above the point where
   /js/config.js has set window.CONFIG, so a module-level read is frozen to
   `undefined` and the flag silently reads false forever. This repo has paid for
   that one three times (KOKORO_VOICE, TTS_CACHE_MAX_BYTES, and the M2 route). */
function flag(name) {
  return Boolean(globalThis.window?.CONFIG?.features?.[name]);
}

async function readState() {
  try {
    const res = await fetch("/api/display/state");
    if (!res.ok) return false;
    const body = await res.json();
    if (body?.window?.start && body?.window?.end) window_ = body.window;
    // `monitor` is X's own answer. Absent xset gives null, which is honest and
    // is NOT the same as "off" — see the fail-towards-lit rule in the header.
    monitor = body?.monitor ?? null;
    monitorAt = Date.now();
    return true;
  } catch {
    // The server being unreachable is not evidence about a monitor. Keep the
    // last belief rather than inventing one.
    return false;
  }
}

function computeDark(now) {
  // Never dark until the server has told us when the window is. A client that
  // guessed 21:00 would be wrong the moment DISPLAY_OFF_START changed, and
  // wrong in the direction that freezes a lit screen.
  if (!window_) return false;
  if (now < litUntil) return false;
  if (!isWithinOffWindow(new Date(now), window_.start, window_.end)) return false;
  // Inside the window, X gets the last word when it has one.
  return monitor !== "on";
}

function publish(next) {
  if (next === dark) return;
  dark = next;
  // The attribute is the seam anything else can hang off without importing
  // this module — CSS included, should a later phase want it.
  document.documentElement.dataset.panelDark = dark ? "1" : "0";
  for (const fn of listeners) {
    try { fn(dark); } catch { /* one bad listener must not stop the rest */ }
  }
}

/**
 * One pass. Exported for the debug hook and the specs: waiting out a real
 * 21:00 to find out whether this works is not a verification method.
 */
export async function evaluateDisplay({ now = Date.now() } = {}) {
  const believed = window_
    ? isWithinOffWindow(new Date(now), window_.start, window_.end)
    : null;

  // Ask X on the edges and then occasionally, rather than every minute all
  // night. The edge is the important one: it is the 21:00 tick that has to
  // find out whether the crontab actually managed it.
  const edge = believed !== lastWindowBelief;
  const stale = believed && now - monitorAt >= CONFIRM_MS;
  if (!window_ || edge || stale) await readState();
  lastWindowBelief = believed;

  publish(computeDark(now));
  return dark;
}

/** Is the panel powered down right now? */
export function isPanelDark() { return dark; }

/**
 * Light the panel, if it is dark and if we are allowed to.
 *
 * Deliberately NOT awaited by its caller. A doorbell's job is to announce
 * itself; the panel coming up is a courtesy attached to that, and an alert that
 * waited on an `xset` round trip before speaking would have turned a 4s
 * announcement into a slower one to fix a screen nobody is looking at yet.
 *
 * Returns the route's answer (or null when it was not called at all) so a spec
 * can tell "declined" from "attempted and failed".
 */
export async function requestPanelWake(reason = "alert") {
  // Two flags, two different questions. `v3EnergySaver` is whether V3 knows
  // about the panel at all; `displayWake` is whether a security event may light
  // it, which is a decision the incumbent already publishes and shares.
  if (!flag("v3EnergySaver") || !flag("displayWake")) return null;
  if (!dark) return null;

  try {
    const res = await fetch("/api/display/wake", { method: "POST" });
    const body = await res.json().catch(() => ({}));
    if (body?.woken) {
      // The hold is the SERVER's number — it owns the restore timer, and a
      // client guess that disagreed would either pause the substrate while the
      // panel was still lit or leave it running after it went back down.
      litUntil = Date.now() + (Number(body.holdMs) || 0);
      wakes += 1;
      publish(false);
    }
    return { ok: res.ok, reason, ...body };
  } catch {
    return { ok: false, reason, error: "unreachable" };
  }
}

/** Subscribe to dark/lit changes. Returns an unsubscribe. */
export function onPanelDark(fn) {
  listeners.push(fn);
  return () => { listeners = listeners.filter((x) => x !== fn); };
}

/** For __v3(). */
export function displayState() {
  return {
    dark,
    window: window_,
    monitor,
    litUntil: litUntil > Date.now() ? new Date(litUntil).toISOString() : null,
    wakes
  };
}

export function initDisplay() {
  // Flag-off is not "initialise and do nothing" — it is no timer, no fetch and
  // no attribute, so the flag-off build is the build that shipped before it.
  if (!flag("v3EnergySaver")) return false;
  if (timer) return true;

  document.documentElement.dataset.panelDark = "0";
  void evaluateDisplay();

  // Init-once, at startup, never re-created. The per-event timers are where
  // this house has leaked before; this is not one of those.
  timer = setInterval(() => { void evaluateDisplay(); }, CHECK_MS);

  window.__v3Display = () => displayState();
  // Drive the whole thing without waiting for 21:00. `panelDark` forces the
  // belief directly so a spec can prove what a dark panel does, rather than
  // proving only that the arithmetic about darkness is right.
  window.__v3PanelDark = (next) => { publish(Boolean(next)); return dark; };
  window.__v3DisplayTick = (now) => evaluateDisplay(now == null ? {} : { now });
  window.__v3Wake = (reason) => requestPanelWake(reason ?? "manual");

  return true;
}

/** Test seam — back to cold, including the timer and every listener. */
export function __resetDisplay() {
  if (timer) { clearInterval(timer); timer = null; }
  listeners = [];
  window_ = null;
  monitor = null;
  monitorAt = 0;
  dark = false;
  litUntil = 0;
  lastWindowBelief = null;
  wakes = 0;
  delete document.documentElement.dataset.panelDark;
}
