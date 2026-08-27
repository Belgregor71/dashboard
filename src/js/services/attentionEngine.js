/* ═══ V3-SHARED-RUNTIME ═════════════════════════════════════════════════════
   Loaded by BOTH surfaces: the incumbent (/) and V3 (/v3/).
   `src/js/` is not the old dashboard — it is V3's runtime library. A cleanup
   that retires "the legacy tree" takes this file out from under V3 with it.
   docs/design/V3-CUTOVER.md §1 · guarded by tests/v3-closure.spec.js
   ════════════════════════════════════════════════════════════════════════ */

import { gatherBriefingContext } from "../modules/briefingData.js";
import {
  evaluateInsights,
  claimCooldown,
  recordFuelPrice
} from "./insightRules.js";
import { evaluatePredictive } from "./predictiveRules.js";
import { rankQueue, selectForMode } from "./attentionRank.js";
import { isGamingQuiet } from "./quietMode.js";
import { get as getContext } from "../core/contextStore.js";
import { emit } from "../core/eventBus.js";
import { collectMemory } from "../core/memoryRuntime.js";
import { collectDelight } from "../core/personalityRuntime.js";
import { phrase, shouldSpeak } from "../core/personality.js";

// The unified attention runtime (docs/vision/phase-2-attention-engine.md).
// It merges the scored insight candidates (insightRules, over the async
// briefing context) with the live source candidates (candidateSources, read
// from the DOM by focusHero each tick) into ONE ranked queue. The presence
// mode sets the floor + depth via selectForMode; the pure ranking core lives
// in attentionRank.js so it stays node-testable.
//
// This absorbs insightEngine.js's job (briefing refresh + the cooldown store)
// for the flag-on path; insightEngine stays as the flag-off path until a later
// cleanup. It does NOT rephrase: the deterministic template IS the house voice
// (docs/design/VOICE.md), the same conclusion insightEngine.js reached.

const REFRESH_MS = 5 * 60 * 1000;
const QUIET_START_HOUR = 21;
const QUIET_END_HOUR = 6;
const COOLDOWN_KEY = "dashboard:insight-cooldowns";
const FUEL_HISTORY_KEY = "dashboard:fuel-history";

let insightCandidates = []; // from the async briefing refresh
let injected = [];          // debug-injected candidates (__forceCandidate)
let currentHeroId = null;

function readJson(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem(key)) ?? fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch { /* storage full/blocked — cooldowns just won't persist */ }
}

function inQuietHours(now = new Date()) {
  const hour = now.getHours();
  return hour >= QUIET_START_HOUR || hour < QUIET_END_HOUR;
}

// Phase 3 predictive candidates (docs/vision/phase-3-anticipate.md) — flag-gated
// so flag-off is byte-identical to Phase 2.
function predictiveEnabled() {
  try {
    return Boolean(window.CONFIG?.features?.predictiveCandidates);
  } catch {
    return false;
  }
}

// Phase 6 House Model (docs/vision/phase-6-intent.md) — flag-gated so flag-off
// passes no intent and the gate keeps its exact Phase 3–5 behaviour.
function intentEnabled() {
  try {
    return Boolean(window.CONFIG?.features?.houseIntent);
  } catch {
    return false;
  }
}

// Phase 9 memory engine (docs/vision/phase-9-remember.md) — flag-gated so flag-off
// keeps Phase 3's on-this-day regex path exactly.
function memoryEnabled() {
  try {
    return Boolean(window.CONFIG?.features?.memoryEngine);
  } catch {
    return false;
  }
}

// Phase 10 personality (docs/vision/phase-10-temperament.md) — flag-gated so
// flag-off keeps each candidate's current tone and adds no delight candidate.
function personalityEnabled() {
  try {
    return Boolean(window.CONFIG?.features?.personality);
  } catch {
    return false;
  }
}

/* There was an aiPhrase() here that POSTed { type: "insight" } to
   /api/ai/brief. `insight` was never one of that route's SYSTEM_PROMPTS, so the
   route's `SYSTEM_PROMPTS[body.type] ? body.type : "morning"` fallback silently
   served the full MORNING BRIEFING prompt; buildPrompt then ignored `text`
   (it reads only time/weather/events/…), leaving the model a system prompt
   swearing the Time line is fact on four axes and a user turn reading exactly
   "Time: unknown". It answered the only way it could — "I need the actual time,
   day of the week and season to give you a proper briefing" — and that reached
   the wall, unasked, twice over: refresh() phrased only the top insight, but
   phrasedById persisted, so each new top candidate added another refusal.
   The length<=140 guard passed them all; a refusal is short.
   insightEngine.js:13 had already retired this pass for being a near-identity
   transform that only cost latency. It stays retired here too. */

async function refresh() {
  if (inQuietHours()) {
    insightCandidates = [];
    return;
  }

  const type = new Date().getHours() < 12 ? "morning" : "evening";
  const ctx = await gatherBriefingContext(type);
  const now = new Date();

  let fuelHistory = readJson(FUEL_HISTORY_KEY, {});
  if (ctx.fuel?.price != null) {
    fuelHistory = recordFuelPrice(fuelHistory, ctx.fuel.price, now);
    writeJson(FUEL_HISTORY_KEY, fuelHistory);
  }

  insightCandidates = evaluateInsights(ctx, now, { fuelHistory });

  // Phase 3: merge predictive candidates into the same scored list. Ranking,
  // decay (expiresAt), cooldowns and phrasing are all Phase 2 — this is the one
  // added collection + concat. Guarded so flag-off is untouched.
  if (predictiveEnabled()) {
    let predictive = evaluatePredictive(ctx, now, { fuelHistory });
    // Phase 9 "Replace": the structured memory engine owns on-this-day, so the
    // Phase 3 regex candidate stands down to avoid a duplicate anniversary line.
    if (memoryEnabled()) predictive = predictive.filter((c) => !c.id.startsWith("on-this-day:"));
    insightCandidates = [...insightCandidates, ...predictive].sort((a, b) => b.score - a.score);
  }

  // Phase 9: merge at most one rarity-budgeted, context-matched memory candidate
  // into the same scored list — the Phase 3 guarded-concat pattern. The runtime
  // owns the entries + budget + cooldowns; collectMemory returns [] when off.
  if (memoryEnabled()) {
    insightCandidates = [...insightCandidates, ...collectMemory(ctx, now)].sort((a, b) => b.score - a.score);
  }

  // Phase 10: merge at most one gentle delight celebration — the same guarded
  // concat. The runtime owns the signals + persisted budget; collectDelight
  // returns [] when off or when no rare moment is live.
  if (personalityEnabled()) {
    insightCandidates = [...insightCandidates, ...collectDelight(now)].sort((a, b) => b.score - a.score);
  }

}

/**
 * The synchronous read for focusHero's tick. Merges the cached insight
 * candidates + the live source candidates + any debug-injected candidates,
 * ranks them, and applies the presence mode.
 * Claims the insight cooldown when the hero changes.
 */
export function getSelection({ sources = [], now = new Date(), mode = "glance", weights = null } = {}) {
  const intent = intentEnabled() ? getContext().intent : null;

  // Phase 10: route every candidate's copy through the one temperament voice, and
  // let the centralised silence thresholds drop a line the house would stay quiet
  // about. Flag-off → the list is untouched (byte-identical ranking + selection).
  let candidates = [...insightCandidates, ...sources, ...injected];
  if (personalityEnabled()) {
    candidates = candidates
      .filter((c) => shouldSpeak(c, intent))
      .map((c) => ({ ...c, text: phrase(intent, c.kind ?? c.source, { text: c.text }) }));
  }

  const queue = rankQueue(candidates, now, { weights });
  const cooldowns = readJson(COOLDOWN_KEY, {});
  const sel = selectForMode(queue, mode, {
    cooldowns, now, currentId: currentHeroId, intent, quiet: isGamingQuiet()
  });

  const nextId = sel.hero ? sel.hero.id : null;
  if (nextId !== currentHeroId) {
    currentHeroId = nextId;
    // Phase 8: the hero changed — announce the presentation so routineRuntime can
    // learn dwell vs ignore (no-op when nothing listens, i.e. routineLearning off).
    emit("attention:hero", { hero: sel.hero ? { id: sel.hero.id, source: sel.hero.source } : null });
    // Only cooldown-bearing candidates (the nagging insight rules) get claimed;
    // live readouts carry cooldownMs:0 and should keep showing.
    if (sel.hero && sel.hero.cooldownMs > 0) {
      writeJson(COOLDOWN_KEY, claimCooldown(sel.hero, { cooldowns, now }));
    }
  }

  return { ...sel, queue };
}

export function initAttentionEngine() {
  refresh().catch((e) => console.warn("Attention refresh failed:", e?.message));
  setInterval(() => {
    refresh().catch((e) => console.warn("Attention refresh failed:", e?.message));
  }, REFRESH_MS);

  // Debug/verification hook — inject synthetic candidate(s) so the queue and the
  // interrupt/dwell behaviour can be driven from the Pi over CDP (matches
  // __presence / __forceInsight). Accepts one candidate or an array; pass null
  // to clear.
  window.__forceCandidate = (candidate) => {
    injected = candidate == null ? [] : Array.isArray(candidate) ? candidate : [candidate];
    return injected;
  };

  // Force an immediate context+candidate refresh — lets __nowcastProbe (which
  // seeds ctx.nowcast) take effect without waiting out the 5-min cycle.
  window.__refreshAttention = () => refresh();
}
