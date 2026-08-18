/* ═══════════════════════════════════════════════════════════════════════════
   HA-DRIVEN COMMANDS — the channel the cutover left with no listener.

   Home Assistant can fire a `dashboard_command` event and drive this screen.
   Every hop of that path survived the cutover except the last one:
   `haWs.js:173` subscribes to the event, `haRoutes.js:103` relays it over SSE
   generically, `client.js:131` emits `ha:event:dashboard_command` on the bus —
   and V3 calls `connectHA()`, so all of that runs on the wall today. The only
   subscriber ever written lives in `services/homeAssistant/events.js`, whose
   sole caller is `js/core/app.js`. Fifth instance of the cutover's signature
   defect: not broken, never wired.

   ── Why this honours two commands and refuses the rest ─────────────────────

   Measured against the live house 2026-08-17, not assumed. HA holds 26 scripts
   that fire this event. Their `last_triggered`:

     script.dashboard_switch_view        2026-05-01
     script.dashboard_test_camera_popup  2026-02-06
     the other 24                        never

   No automation fires it at all. So this is not a feature the house lost in the
   cutover — it is a remote control nobody has picked up since months before V3
   existed, and reviving all of it would be building for a caller that has never
   called.

   Most of what it can say is addressed to furniture V3 does not own, besides:
   `agenda_*` means the timeline view, `status_calendar` the status view,
   `camera_pin` / `camera_cycle_*` / `camera_live_*` the cameras grid,
   `next_month` / `show_details` the calendar month view. V3 has subjects and a
   depth, not views. Porting those is inventing surfaces, not restoring a
   channel — so they are declined here and the decision is recorded rather than
   left as a silent gap for the next reader to rediscover.

   What is honoured is what has an unambiguous V3 counterpart. Everything else
   answers `command:unknown` — REFUSED OUT LOUD rather than swallowed. A remote
   control whose buttons quietly do nothing is the same failure this module
   exists to fix, one layer further in.
   ═══════════════════════════════════════════════════════════════════════════ */

import { emit, on } from "../../js/core/eventBus.js";
import { voiceSnapshot } from "../../js/services/voiceSnapshot.js";
import { showSubject } from "../subjects/index.js";
import { deepen, setDepth, getDepth, DEPTH } from "./depth.js";

function flag(name) {
  return Boolean(globalThis.window?.CONFIG?.features?.[name]);
}

let registered = false;
let coords = {};

/* In-flight handler, so `__v3Command` can be awaited. The bus is synchronous
   and `showSubject` is not; without this a test would have to poll for a mount
   and could not tell "slow" from "never". */
let inFlight = Promise.resolve();

/* ── viewManager's alias map, duplicated on purpose ─────────────────────────
   `normalizeViewId` is not exported, and importing `core/viewManager.js` to
   reuse six entries would pull the incumbent's DOM view router into V3's
   import closure — the coupling `tests/v3-closure.spec.js` exists to notice.
   Six lines of duplication beat that. The HA payloads that worked before the
   cutover keep working because these are the same six aliases they were
   normalised through then.
─────────────────────────────────────────────────────────────────────────── */
const VIEW_ALIASES = new Map([
  ["briefing-view", "briefing"],
  ["status-view", "status"],
  ["weather-view", "weather"],
  ["camera", "cameras"],
  ["calendar", "timeline"],
  ["agenda", "timeline"]
]);

/* ── view id → V3 subject ───────────────────────────────────────────────────
   Only mappings the house itself already asserts. None of these is a judgement
   call I made up:

   · `status`   → `show.status`   — Phase 6 built this subject as the V3 answer
                                    to the status view. Same content, same job.
   · `briefing` → `show.briefing` — same name, same content, one surface across.
   · `timeline` → `show.day`      — viewManager aliases `calendar` and `agenda`
                                    onto `timeline`, and `localIntents.js:192`
                                    already matches "the calendar" / "the
                                    diary" / "my schedule" / "the agenda" to
                                    `show.day`. The equivalence is the voice
                                    lane's, not mine.
   · `weather`  → `show.forecast` — the weather view was forecast-led. GATED on
                                    the subject's own flag: the registry is
                                    deliberately left open so `__v3Subject` can
                                    drive an unflipped subject for verification,
                                    which means a caller reaching it by any
                                    other door has to re-apply the gate itself
                                    or a rollback stops being a rollback.

   `cameras` is absent and that is the answer, not an omission. V3 has no
   cameras grid; `show.camera` needs a camera named, and `switch_view` never
   names one. Picking one would be the house inventing which camera you meant.

   `home` is handled separately — it is not a subject at all. See below.
─────────────────────────────────────────────────────────────────────────── */
const VIEW_SUBJECTS = new Map([
  ["status", { id: "show.status" }],
  ["briefing", { id: "show.briefing" }],
  ["timeline", { id: "show.day" }],
  ["weather", { id: "show.forecast", flag: "v3ForecastWeek" }]
]);

/* The incumbent treats these three as one command (`events.js:60`). Kept as a
   set rather than collapsed, because HA's scripts are the caller and one of
   them is already on the wire. */
const STATUS_COMMANDS = new Set(["system_status", "status", "system_status_view"]);

/* What the channel last did. Read on the wall over CDP and by the specs —
   `command:executed` has exactly one subscriber in the repo
   (`voiceOverlay.js:70`) and it is incumbent-only, so without this the only
   evidence a command arrived would be the mount it happened to produce, and a
   REFUSAL produces nothing to look at by definition. */
let last = null;

function record(event, command, ok, message) {
  last = { event, command, ok, message, at: Date.now() };
  /* Same event names and same `{command, ok, message}` shape the incumbent
     emits, so a V3 consumer written later matches one contract rather than two.
     The shape carries an `ok` the incumbent never sets to false, and a subject
     that declines is exactly what that field was for. */
  emit(event, { command, ok, message });
}

function executed(command, message, ok = true) {
  record("command:executed", command, ok, message);
}

function unknown(command, message = "Unknown command") {
  record("command:unknown", command, false, message);
}

function normalizeViewId(view) {
  if (typeof view !== "string") return "";
  const normalized = view.trim().toLowerCase();
  return VIEW_ALIASES.get(normalized) || normalized;
}

/**
 * Take the wall to a subject at depth 3.
 *
 * ⚠ THE DECLINE PATH IS NOT OPTIONAL. `showSubject()` tears the previous
 * subject down BEFORE it looks the new one up, and `deepen()` falls through to
 * `sustain()` for a shallower target — so a decline while the surface was
 * already at SUBJECT leaves depth 3 HELD WITH NOTHING IN IT, re-armed by every
 * repeat. Seen on the wall 2026-08-15 through the voice lane
 * (`{depth: 3, held: true, subject: null, mount: 0}`); this lane reaches the
 * same function and would reach the same state. Stepped down explicitly, and
 * only from deeper than a glance.
 */
async function showFor(command, subjectId) {
  const shown = await showSubject({ id: subjectId }, voiceSnapshot(coords));

  if (shown) {
    deepen(DEPTH.SUBJECT, `command-${subjectId}`);
    executed(command, `Showing ${subjectId.replace("show.", "")}`);
    return;
  }

  if (getDepth() > DEPTH.GLANCE) setDepth(DEPTH.GLANCE, `command-${subjectId}`);
  executed(command, "Nothing to show", false);
}

async function handleCommand(data) {
  const payload = data && typeof data === "object" ? data : {};
  const command = payload.command || payload.intent || payload.action;

  if (!command) {
    unknown("");
    return;
  }

  if (command === "switch_view") {
    const view = normalizeViewId(payload.view);

    /* ── home is the resting wall, not a subject ──────────────────────────
       The incumbent's `home` was the ambient view among four. V3 has no views:
       depth 0 IS the resting wall, the hour and the photograph. So "go home"
       means "let this go", which is the same recession the goodnight action
       performs — and for the same reason it must be `setDepth`, not `deepen`:
       deepen() re-arms a hold on whatever is up instead of releasing it. */
    if (view === "home") {
      setDepth(DEPTH.FIELD, "command-home");
      executed(command, "Back to the wall");
      return;
    }

    const target = VIEW_SUBJECTS.get(view);
    if (!target) {
      unknown(command, view ? `No V3 surface for "${view}"` : "No view named");
      return;
    }
    if (target.flag && !flag(target.flag)) {
      unknown(command, `"${view}" is behind a flag that is off`);
      return;
    }

    await showFor(command, target.id);
    return;
  }

  if (STATUS_COMMANDS.has(command)) {
    /* `data.target` is dropped deliberately. The incumbent paired this with
       `status:highlight`, which `systemStatus.js:403` consumes to pick out one
       row of a list view. V3's status subject is not a list with rows to
       highlight, and forwarding an event nothing can act on would read as
       support for something that does not happen. */
    await showFor(command, "show.status");
    return;
  }

  unknown(command, `"${command}" has no V3 surface`);
}

/**
 * Subscribe V3 to HA's command channel.
 *
 * ⚠ Registers BEFORE `connectHA()` in boot, for the same reason the entity feed
 * does: a command that arrives between the socket opening and the subscription
 * existing is not delayed, it is gone.
 */
export function initCommands({ lat = null, lon = null } = {}) {
  if (registered) return false;
  registered = true;
  coords = typeof lat === "number" && typeof lon === "number" ? { lat, lon } : {};

  on("ha:event:dashboard_command", (data) => {
    inFlight = handleCommand(data).catch(() => {
      /* A command that throws must not take the bus down with it — every other
         subscriber to this event runs after us. */
    });
  });

  /* Drives the REAL subscription rather than the handler, so neutering the
     `on()` above turns the specs red. Returns the handler's promise because the
     bus is synchronous and `showSubject` is not. */
  if (globalThis.window) {
    globalThis.window.__v3Command = (data) => {
      emit("ha:event:dashboard_command", data);
      return inFlight;
    };
    globalThis.window.__v3Commands = () => last;
  }

  return true;
}
