import { haPost } from "../ha/haRest.js";
import { createCoverageTracker } from "./motionCoverage.js";

// Watchdog: tracks per-feed freshness/failures, evaluates every minute, and
// pushes a phone notification (via HA notify) when a feed degrades or recovers.
// Two feed kinds:
//   heartbeat  — expected to succeed continuously while the kiosk runs;
//                flagged when the last success is older than staleMs.
//   on-demand  — only runs when used (snapshots, TTS, AI); staleness means
//                nothing, so flagged on consecutive failures instead.

const EVAL_INTERVAL_MS = 60_000;
const NOTIFY_AFTER_EVALS = 3; // problem must persist ~3 min before pushing
const RENOTIFY_COOLDOWN_MS = 6 * 60 * 60 * 1000;
const QUIET_START_HOUR = 22; // no pushes 22:00–07:00; held until morning
const QUIET_END_HOUR = 7;

// A feed is "warn" past staleMs and escalates to "error" past 2× staleMs.
const FEEDS = {
  ha: { label: "Home Assistant", kind: "heartbeat", staleMs: 10 * 60 * 1000 },
  // Not a feed we call — a fact we read. Its value is diagnostic: when the
  // internet is down, weather + AI + news all fail SEPARATELY and the chip reads
  // like three unrelated faults. This names the one cause.
  wan: { label: "Internet", kind: "state", entity: "binary_sensor.archer_ax11000_wan_status", notify: false },
  motion: { label: "Motion events", kind: "heartbeat", staleMs: 24 * 60 * 60 * 1000 },
  // The house-wide canary above is satisfied by ANY camera firing, which is the
  // right question for a total outage and blind to a partial one. This feed
  // asks the per-camera question instead — see motionCoverage.js.
  motionCoverage: { label: "Motion coverage", kind: "coverage" },
  weather: { label: "Weather", kind: "heartbeat", staleMs: 45 * 60 * 1000 },
  calendar: { label: "Calendar", kind: "heartbeat", staleMs: 2 * 60 * 60 * 1000 },
  cameras: { label: "Camera snapshots", kind: "on-demand", failThreshold: 3 },
  ai: { label: "AI briefings", kind: "on-demand", failThreshold: 2 },
  tts: { label: "Text-to-speech", kind: "on-demand", failThreshold: 2 }
};

// Matches the eufy binary sensors the frontend popups key off — any one of
// these firing proves the whole eufy-ws → HA → dashboard pipeline is alive.
const MOTION_ENTITY_RE = /^binary_sensor\.\w+_(motion|person)_detected$/;
const DOORBELL_RING_ENTITY = "binary_sensor.doorbell_ringing";

const startedAt = Date.now();
const feedState = new Map(); // id → mutable state
const coverage = createCoverageTracker({ startedAt });

let haManager = null;
let haConnected = false;
let haLastEventAt = null;
let evalTimer = null;

function getFeedState(id) {
  let state = feedState.get(id);
  if (!state) {
    state = {
      lastSuccessAt: null,
      lastFailureAt: null,
      lastError: null,
      consecutiveFailures: 0,
      level: "ok",
      problemEvals: 0,
      notifiedAt: null,
      lastNotifyAt: null,
      pendingRecovery: false
    };
    feedState.set(id, state);
  }
  return state;
}

export function reportSuccess(feedId) {
  if (!FEEDS[feedId]) return;
  const state = getFeedState(feedId);
  state.lastSuccessAt = Date.now();
  state.consecutiveFailures = 0;
  state.lastError = null;
}

export function reportFailure(feedId, message) {
  if (!FEEDS[feedId]) return;
  const state = getFeedState(feedId);
  state.lastFailureAt = Date.now();
  state.consecutiveFailures += 1;
  state.lastError = message || "unknown error";
}

function formatAge(ms) {
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

/**
 * Pure mapper for a `kind: "state"` feed — an HA binary_sensor read straight
 * across. Exported so the mapping is unit-testable without a live socket.
 *
 * The warn/error split is a real distinction, not hedging: `off` is the router
 * telling us the WAN is down, while unknown/unavailable means the router
 * integration itself is unreachable. Reporting the second as "internet is down"
 * would be a claim we cannot support — and it is the more likely state when HA
 * is the thing having a bad day.
 */
export function stateFeedLevel(entity, entityId = "sensor") {
  if (!entity) return { level: "warn", detail: `${entityId} not found` };
  if (entity.state === "on") return { level: "ok", detail: null };
  if (entity.state === "off") return { level: "error", detail: "internet is down" };
  return { level: "warn", detail: `router reports ${entity.state}` };
}

/**
 * Is anyone home, according to a signal INDEPENDENT of the eufy lane?
 *
 * `person.*` is fed by HA's own device trackers, so it stays truthful when the
 * camera pipeline is the thing that is broken — which is the only case this is
 * consulted in. Tri-state on purpose: no person entities at all is "unknown",
 * not "away". See the warning on evaluate() in motionCoverage.js.
 */
export function occupancyFrom(states) {
  const people = (states || []).filter((entity) => entity?.entity_id?.startsWith("person."));
  if (!people.length) return "unknown";
  if (people.some((entity) => entity.state === "home")) return "home";
  // Every tracker reporting unknown/unavailable is not an empty house.
  if (people.every((entity) => entity.state === "not_home")) return "away";
  return "unknown";
}

function currentOccupancy() {
  if (!haManager?.getStates) return "unknown";
  try {
    return occupancyFrom(haManager.getStates());
  } catch {
    return "unknown";
  }
}

export function getMotionCoverage() {
  return coverage.evaluate({ occupancy: currentOccupancy() });
}

function evaluateFeed(id) {
  const config = FEEDS[id];
  const state = getFeedState(id);
  const now = Date.now();

  if (id === "ha") {
    if (!haManager) return { level: "ok", detail: "HA disabled" };
    if (!haConnected) return { level: "error", detail: state.lastError || "disconnected" };
    // Connected but silent: HA emits state_changed constantly, so a quiet
    // socket past the threshold means a zombie connection.
    const sinceEvent = now - (haLastEventAt ?? startedAt);
    if (sinceEvent > config.staleMs) {
      return { level: "error", detail: `connected but no events for ${formatAge(sinceEvent)}` };
    }
    return { level: "ok", detail: null };
  }

  if (config.kind === "coverage") {
    if (!haManager) return { level: "ok", detail: "HA disabled" };
    const { level, detail } = coverage.evaluate({ now, occupancy: currentOccupancy() });
    return { level, detail };
  }

  // A state feed mirrors an HA binary_sensor rather than tracking our own calls.
  if (config.kind === "state") {
    if (!haManager) return { level: "ok", detail: "HA disabled" };
    return stateFeedLevel(haManager.getState(config.entity), config.entity);
  }

  if (config.kind === "heartbeat") {
    if (id === "motion" && !haManager) return { level: "ok", detail: "HA disabled" };
    const reference = state.lastSuccessAt ?? startedAt;
    const age = now - reference;
    if (age > config.staleMs * 2) {
      return { level: "error", detail: `no success for ${formatAge(age)}` };
    }
    if (age > config.staleMs) {
      return { level: "warn", detail: `no success for ${formatAge(age)}` };
    }
    return { level: "ok", detail: null };
  }

  // on-demand
  if (state.consecutiveFailures >= config.failThreshold) {
    return {
      level: "error",
      detail: `${state.consecutiveFailures} consecutive failures — ${state.lastError || "unknown"}`
    };
  }
  return { level: "ok", detail: null };
}

export function inQuietHours(date = new Date()) {
  const hour = date.getHours();
  return hour >= QUIET_START_HOUR || hour < QUIET_END_HOUR;
}

export async function sendPush(title, message) {
  const service = process.env.HEALTH_NOTIFY_SERVICE;
  if (!service || !haManager) {
    // Not configured is a choice, not a failure — log it and treat as handled
    // so the evaluator doesn't retry (and re-log) every minute.
    console.warn(`[health] push skipped (no notify service): ${title} — ${message}`);
    return true;
  }
  try {
    await haPost(`/api/services/notify/${service}`, { title, message });
    return true;
  } catch (error) {
    console.error("[health] push failed:", error?.message || error);
    return false;
  }
}

async function handleTransitions(id, level, detail) {
  const state = getFeedState(id);
  const config = FEEDS[id];
  const now = Date.now();
  state.level = level;
  state.detail = detail;

  if (level === "ok") {
    state.problemEvals = 0;
    if (state.notifiedAt) state.pendingRecovery = true;
    state.notifiedAt = null;
    if (state.pendingRecovery && !inQuietHours()) {
      const sent = await sendPush("Dashboard recovered", `${config.label} is healthy again.`);
      if (sent) state.pendingRecovery = false;
    }
    return;
  }

  state.pendingRecovery = false;
  state.problemEvals += 1;
  const cooledDown = !state.lastNotifyAt || now - state.lastNotifyAt > RENOTIFY_COOLDOWN_MS;
  // `notify: false` feeds are shown, never pushed. The internet feed is the
  // reason this exists: a push travels HA → the companion app → the internet
  // that is, by hypothesis, down. Pretending to notify is worse than not.
  if (config.notify === false) return;
  if (state.problemEvals >= NOTIFY_AFTER_EVALS && !state.notifiedAt && cooledDown && !inQuietHours()) {
    const sent = await sendPush("Dashboard watchdog", `${config.label}: ${detail}`);
    if (sent) {
      state.notifiedAt = now;
      state.lastNotifyAt = now;
    }
  }
}

async function evaluateAll() {
  for (const id of Object.keys(FEEDS)) {
    const { level, detail } = evaluateFeed(id);
    await handleTransitions(id, level, detail);
  }
}

export function getHealth() {
  const levels = { ok: 0, warn: 1, error: 2 };
  let overall = "ok";
  const feeds = Object.entries(FEEDS).map(([id, config]) => {
    const state = getFeedState(id);
    // A state or coverage feed accumulates no history, so read it LIVE.
    // Otherwise a fresh boot — or a look between the one-minute eval ticks —
    // reports the "ok" default at exactly the moment someone is asking why
    // nothing is loading.
    const derived = config.kind === "state" || config.kind === "coverage";
    const view = derived ? evaluateFeed(id) : state;
    if (levels[view.level] > levels[overall]) overall = view.level;
    return {
      id,
      label: config.label,
      level: view.level,
      detail: view.detail || null,
      lastSuccessAt: state.lastSuccessAt,
      lastError: state.lastError
    };
  });
  return { overall, updatedAt: Date.now(), feeds };
}

function noteMotionEntity(entityId, stateValue, changedAt) {
  const isMotion = MOTION_ENTITY_RE.test(entityId) || entityId === DOORBELL_RING_ENTITY;
  if (!isMotion || stateValue !== "on") return;
  const state = getFeedState("motion");
  const ts = changedAt ?? Date.now();
  if (!state.lastSuccessAt || ts > state.lastSuccessAt) state.lastSuccessAt = ts;
  // The ring entity carries no camera name and is deliberately not counted: if
  // the doorbell's motion lane died while rings still worked, motion IS broken
  // and the divergence check should say so.
  coverage.noteEvent(entityId, ts);
}

export function startHealthService({ manager = null } = {}) {
  if (evalTimer) return;
  haManager = manager;

  if (haManager) {
    haConnected = haManager.getStatus().connected;

    haManager.on("status", (status) => {
      haConnected = Boolean(status.connected);
      if (haConnected) haLastEventAt = Date.now();
    });

    haManager.on("event", ({ eventType, data }) => {
      haLastEventAt = Date.now();
      if (eventType !== "state_changed") return;
      const newState = data?.new_state;
      if (newState?.entity_id) noteMotionEntity(newState.entity_id, newState.state, Date.now());
    });

    // Seed the motion canary from HA's own history so a server restart
    // doesn't reset the 24h clock.
    haManager.on("snapshot", (states) => {
      for (const entity of states) {
        // last_changed marks the most recent on/off edge — recent enough
        // either way to prove the pipeline was alive at that moment.
        if (!entity?.entity_id) continue;
        const isMotion =
          MOTION_ENTITY_RE.test(entity.entity_id) || entity.entity_id === DOORBELL_RING_ENTITY;
        if (!isMotion) continue;
        const changed = Date.parse(entity.last_changed || "");
        if (!Number.isFinite(changed)) continue;
        const state = getFeedState("motion");
        if (!state.lastSuccessAt || changed > state.lastSuccessAt) state.lastSuccessAt = changed;
        // Seeds last-seen only, never the house event log — see seed()'s note.
        coverage.seed(entity.entity_id, changed);
      }
    });
  }

  evalTimer = setInterval(() => {
    evaluateAll().catch((error) => console.error("[health] evaluate failed:", error));
  }, EVAL_INTERVAL_MS);
  evalTimer.unref?.();
  console.log("[health] watchdog started");
}
