import { haPost } from "../ha/haRest.js";
import { getHealth, sendPush, inQuietHours } from "./healthService.js";
import { getEufyStatus, reconnectEufyDriver } from "./eufyWs.js";

// Self-healing for the motion→wake→popup pipeline. The watchdog
// (healthService) detects degradation; this service repairs the two failure
// modes that have actually happened and that we can act on:
//
//   1. A camera's motion-detection switch turned off at the Eufy device
//      level (2026-07-04 root cause #1) — re-arm it via HA.
//   2. The eufy-security-ws driver losing its cloud push subscription
//      (2026-06-24..07-04 blackout) — disconnect/connect the driver over
//      the eufy-ws API to re-register push.
//
// The third historical failure (zombie HA websocket) already self-heals via
// the 30s heartbeat in server/ha/haWs.js.

const EVAL_INTERVAL_MS = 60_000;
const SWITCH_OFF_EVALS = 5;             // off for ~5 min before re-arming
const SWITCH_REARM_COOLDOWN_MS = 60 * 60 * 1000;
const EUFY_CHECK_EVERY_EVALS = 10;      // probe push lane every ~10 min
const EUFY_RECONNECT_COOLDOWN_MS = 6 * 60 * 60 * 1000;
const EUFY_UNREACHABLE_NOTIFY_COOLDOWN_MS = 6 * 60 * 60 * 1000;
const RECOVERY_LOG_MAX = 50;

// Only cameras whose motion feeds the dashboard's wake/popup features.
// Indoor cams (piano room, tilt-pan) are deliberately off — do NOT add them.
const DEFAULT_DETECTION_SWITCHES = ["switch.kitchen_motion_detection"];

function watchedSwitches() {
  const raw = process.env.RECOVERY_DETECTION_SWITCHES;
  if (!raw) return DEFAULT_DETECTION_SWITCHES;
  return raw.split(",").map((s) => s.trim()).filter(Boolean);
}

const recoveryLog = [];
let haManager = null;
let evalTimer = null;
let evalCount = 0;
const switchState = new Map(); // entityId → { offEvals, lastRearmAt }
let lastEufyReconnectAt = 0;
let lastEufyUnreachableNotifyAt = 0;
let eufyCheckInFlight = false;

export function getRecoveryLog() {
  return recoveryLog;
}

function record(kind, action, ok, detail) {
  const entry = { at: Date.now(), kind, action, ok, detail };
  recoveryLog.unshift(entry);
  if (recoveryLog.length > RECOVERY_LOG_MAX) recoveryLog.pop();
  console.log(`[recovery] ${kind}: ${action} — ${ok ? "ok" : "FAILED"}${detail ? ` (${detail})` : ""}`);
  return entry;
}

async function notify(title, message) {
  // Recovery actions always happen; only the phone push respects quiet hours
  // (the action is also visible in /api/system/health and the server log).
  if (inQuietHours()) return;
  await sendPush(title, message);
}

// ── Guard 1: detection switches ────────────────────────────────

async function evaluateDetectionSwitches() {
  for (const entityId of watchedSwitches()) {
    const entity = haManager.getState(entityId);
    let state = switchState.get(entityId);
    if (!state) {
      state = { offEvals: 0, lastRearmAt: 0 };
      switchState.set(entityId, state);
    }

    if (!entity || entity.state !== "off") {
      state.offEvals = 0;
      continue;
    }

    state.offEvals += 1;
    if (state.offEvals < SWITCH_OFF_EVALS) continue;
    if (Date.now() - state.lastRearmAt < SWITCH_REARM_COOLDOWN_MS) continue;

    try {
      await haPost("/api/services/switch/turn_on", { entity_id: entityId });
      state.lastRearmAt = Date.now();
      state.offEvals = 0;
      record("detection-switch", `re-armed ${entityId}`, true);
      await notify(
        "Dashboard self-heal",
        `${entityId} was off for ${SWITCH_OFF_EVALS}+ minutes — turned it back on so motion wake keeps working.`
      );
    } catch (error) {
      record("detection-switch", `re-arm ${entityId}`, false, error?.message);
    }
  }
}

// ── Guard 2: eufy push lane ────────────────────────────────────

function motionCanaryLevel() {
  const feed = getHealth().feeds.find((f) => f.id === "motion");
  return feed?.level ?? "ok";
}

async function evaluateEufyPushLane() {
  if (eufyCheckInFlight) return;
  eufyCheckInFlight = true;
  try {
    let status;
    try {
      status = await getEufyStatus();
    } catch (error) {
      // eufy-ws itself unreachable — the container is down or the Synology
      // is offline. Nothing to repair from here; make sure a human knows.
      if (Date.now() - lastEufyUnreachableNotifyAt > EUFY_UNREACHABLE_NOTIFY_COOLDOWN_MS) {
        lastEufyUnreachableNotifyAt = Date.now();
        record("eufy-push", "status probe", false, error?.message);
        await notify(
          "Dashboard watchdog",
          "eufy-ws is unreachable — motion events are down and this needs the Synology container restarted."
        );
      }
      return;
    }

    const canaryError = motionCanaryLevel() === "error";
    const pushDown = !status.pushConnected || !status.driverConnected;
    if (!pushDown && !canaryError) return;
    if (Date.now() - lastEufyReconnectAt < EUFY_RECONNECT_COOLDOWN_MS) return;

    lastEufyReconnectAt = Date.now();
    const reason = pushDown
      ? `driver=${status.driverConnected} push=${status.pushConnected}`
      : "motion canary stale";
    record("eufy-push", "driver reconnect attempt", true, reason);

    try {
      const after = await reconnectEufyDriver();
      const ok = after.driverConnected && after.pushConnected;
      record("eufy-push", "driver reconnect result", ok, `driver=${after.driverConnected} push=${after.pushConnected}`);
      await notify(
        "Dashboard self-heal",
        ok
          ? `Eufy push lane looked dead (${reason}) — reconnected the driver, push is back.`
          : `Eufy push lane looked dead (${reason}) — driver reconnect did NOT restore it; the eufy-ws container may need a restart or image update.`
      );
    } catch (error) {
      record("eufy-push", "driver reconnect", false, error?.message);
      await notify(
        "Dashboard self-heal",
        `Eufy push reconnect failed (${error?.message}) — the eufy-ws container likely needs attention.`
      );
    }
  } finally {
    eufyCheckInFlight = false;
  }
}

// ── Wiring ─────────────────────────────────────────────────────

export function startRecoveryService({ manager = null } = {}) {
  if (evalTimer || !manager) return;
  haManager = manager;

  evalTimer = setInterval(() => {
    evalCount += 1;
    evaluateDetectionSwitches().catch((e) => console.error("[recovery] switch eval failed:", e?.message));
    if (evalCount % EUFY_CHECK_EVERY_EVALS === 0) {
      evaluateEufyPushLane().catch((e) => console.error("[recovery] eufy eval failed:", e?.message));
    }
  }, EVAL_INTERVAL_MS);
  evalTimer.unref?.();
  console.log(`[recovery] self-heal started (switches: ${watchedSwitches().join(", ")})`);
}
