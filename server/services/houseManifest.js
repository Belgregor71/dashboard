/* ═══ THE HOUSE'S TOOL MANIFEST — HOUSE-MIND S8 (docs/design/HOUSE-MIND.md §S8) ═
   One declared table of what an AI may READ about this house and what it may
   DO to it: the capability, its kind, what backs it, the gate it sits behind
   and who calls it. tests/house-manifest.spec.js derives the truth from the
   source and goes red on an AI-facing input this table does not declare, an
   act that is not behind SAFE_SERVICES, and a row nothing calls.

   ── What this is NOT ────────────────────────────────────────────────────────
   Not a runtime facade and not a namespace in the browser. The enforcement
   points stay where they are: planCall() + SAFE_SERVICES for acts
   (services/voiceTools.js, ha/haRoutes.js), loopbackOnly on the routes, the
   arbiter and tts.js on the page. This DESCRIBES them; it widens nothing.

   ⛔ Server-side only. Nothing here goes into the shipped config.js or the
   public bundle, and no row names an entity: the roster stays in voiceTools.js.

   ── S8b ─────────────────────────────────────────────────────────────────────
   The rows that carry a `render` are the house-state block of the /converse
   prompt, IN PROMPT ORDER. With CONVERSE_MANIFEST=1, converseSystem() builds
   that block from converseReads() below instead of five hand-wired calls; the
   result is byte-identical for the same inputs (the spec asserts it), so a
   sixth input is one more row rather than one more call.
   ═══════════════════════════════════════════════════════════════════════════ */

import {
  houseContext,
  unresolvedContext,
  latelyContext,
  houseLatelyContext,
  houseTodayContext
} from "./voiceShape.js";

/* Every server file that talks to a model, by the name the rows use. */
export const CALLERS = Object.freeze({
  converse: "server/routes/voice.js",
  briefing: "server/routes/ai.js",
  recipe: "server/routes/recipe.js",
  memory: "server/services/conversationLog.js"
});

export const CAPABILITIES = Object.freeze([
  /* ── READ: the /converse house-state block, in prompt order ─────────────── */
  {
    name: "house.now", kind: "read", backing: "houseContext", gate: "VOICE_HOUSE_CONTEXT",
    callers: ["converse"], what: "the page's houseDigest(): what the house can and cannot see right now",
    render: (i) => houseContext(i.digest)
  },
  {
    name: "house.unresolved", kind: "read", backing: "unresolvedContext", gate: "VOICE_HOUSE_CONTEXT",
    callers: ["converse"], what: "what the house cannot account for, and what it has since resolved",
    render: (i) => unresolvedContext(i.open, i.resolved)
  },
  {
    name: "weather.record", kind: "read", backing: "latelyContext", gate: "VOICE_HOUSE_CONTEXT",
    callers: ["converse"], what: "the weather record's claims (services/lately.js)",
    render: (i) => latelyContext(i.claims)
  },
  {
    name: "house.lately", kind: "read", backing: "houseLatelyContext", gate: "VOICE_HOUSE_CONTEXT",
    callers: ["converse"], what: "what the house has counted about itself, by the day (services/houseLately.js)",
    render: (i) => houseLatelyContext(i.houseClaims)
  },
  {
    name: "house.today", kind: "read", backing: "houseTodayContext", gate: "VOICE_HOUSE_CONTEXT + HOUSE_TODAY",
    callers: ["converse"], what: "today's timed weather events (services/houseToday.js, S7)",
    render: (i) => houseTodayContext(i.today)
  },

  /* ── READ: the rest of what reaches a model ─────────────────────────────── */
  {
    name: "vault.notes", kind: "read", backing: "buildContext", gate: "VAULT_ENABLED",
    callers: ["converse"], what: "retrieved vault notes for the question asked"
  },
  {
    name: "tools.roster", kind: "read", backing: "entityRoster", gate: "VOICE_TOOLS_ENABLED",
    callers: ["converse"], what: "the names of the things the act tools may touch"
  },
  {
    name: "briefing.payload", kind: "read", backing: "buildPrompt", gate: "loopbackOnly",
    callers: ["briefing"], what: "the page-supplied briefing payload: time, weather, events, bins, chores, commute, fuel, news, home"
  },
  {
    name: "recipe.search", kind: "read", backing: "web_search", gate: "none: an upstream web search, no house data",
    callers: ["recipe"], what: "the model's own web search for tonight's dish"
  },
  {
    name: "memory.exchanges", kind: "read", backing: "distil", gate: "memoryEnabled",
    callers: ["memory"], what: "the day's converse exchanges, consolidated into a remembered note"
  },

  /* ── ACT: the curated roster, and nothing else ──────────────────────────── */
  { name: "set_light", kind: "act", backing: "planCall", gate: "SAFE_SERVICES", callers: ["converse"], what: "turn a rostered light on or off" },
  { name: "set_switch", kind: "act", backing: "planCall", gate: "SAFE_SERVICES", callers: ["converse"], what: "turn a rostered switch on or off" },
  { name: "run_routine", kind: "act", backing: "planCall", gate: "SAFE_SERVICES", callers: ["converse"], what: "run a rostered scene or script" },
  { name: "control_media", kind: "act", backing: "planCall", gate: "SAFE_SERVICES", callers: ["converse"], what: "play, pause, stop or set the volume of a rostered player" }
]);

/**
 * The /converse house-state block, as the non-empty rendered rows in order.
 * @param {{digest?: any, open?: any, resolved?: any, claims?: any, houseClaims?: any, today?: any}} inputs
 * @returns {string[]}
 */
export function converseReads(inputs = {}) {
  const out = [];
  for (const row of CAPABILITIES) {
    if (row.kind !== "read" || typeof row.render !== "function" || !row.callers.includes("converse")) continue;
    const text = row.render(inputs);
    if (text) out.push(text);
  }
  return out;
}
