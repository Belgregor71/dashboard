// Pure ranking + presence-gating core for the attention engine. No imports,
// no DOM, no storage — everything is passed in, so it unit-tests in plain node
// (tests/insights.spec.js). The runtime (attentionEngine.js) owns the IO and
// calls these.
//
// Presence modes are plain string literals here (mirrors presence.js MODES) to
// keep this module dependency-free.

export const MODE = {
  AMBIENT: "ambient",
  GLANCE: "glance",
  DWELL: "dwell",
  VOICE: "voice"
};

/**
 * Merge, drop-expired, and sort a candidate list best-first.
 * `expiresAt` (epoch ms) drops stale candidates (e.g. "rain in 14 min").
 *
 * Phase 8 (docs/vision/phase-8-learn.md): an optional `weights` map ({ source:
 * nudge }) TILTS the sort by a small learned per-source amount — it never
 * changes the displayed score, only the ordering. Omitted/empty → byte-identical
 * to the pre-Phase-8 sort.
 */
export function rankQueue(candidates, now = new Date(), { weights = null } = {}) {
  const t = now.getTime();
  const eff = (c) => c.score + (weights ? weights[c.source] || 0 : 0);
  return candidates
    .filter((c) => c && (c.expiresAt == null || c.expiresAt > t))
    .slice()
    .sort((a, b) => eff(b) - eff(a));
}

/**
 * Apply the presence floor + depth and cooldowns to a ranked queue.
 * Returns { hero, stack } where the stack includes the hero first.
 *
 *   AMBIENT → interrupt candidates only (otherwise nothing)
 *   GLANCE  → the single top candidate
 *   DWELL   → the top 3 (hero + lean-in stack)
 *   VOICE   → nothing (floor handed to voice, Phase 4)
 *
 * Cooldowns are the insight-rules store ({ id: expiresAt }). The current hero
 * is exempt from its own cooldown; cooldownMs:0 candidates (live readouts:
 * bom/commute/next-event) are never blocked.
 *
 * Phase 6 (docs/vision/phase-6-intent.md): an optional `intent` posture
 * MODULATES the presence floor — presence stays the base. A `rushed` room is
 * left alone (raised to interrupt-only even while technically present); an
 * `unhurried` room earns the DWELL depth sooner. No intent (flag off) → the
 * pre-Phase-6 behaviour, byte-identical.
 */
export function selectForMode(queue, mode, { cooldowns = {}, now = new Date(), currentId = null, intent = null } = {}) {
  if (mode === MODE.VOICE) return { hero: null, stack: [] };

  const t = now.getTime();
  let eligible = queue.filter(
    (c) =>
      c.id === currentId ||
      c.cooldownMs === 0 ||
      !cooldowns[c.id] ||
      cooldowns[c.id] <= t
  );

  const rushed = intent?.tempo === "rushed";
  const unhurried = intent?.tempo === "unhurried";

  // A rushed room raises the floor to interrupt-only; AMBIENT is already there.
  const interruptOnly = mode === MODE.AMBIENT || (rushed && (mode === MODE.GLANCE || mode === MODE.DWELL));
  if (interruptOnly) eligible = eligible.filter((c) => c.interrupt);

  // DWELL depth by presence, or granted early when the room is unhurried.
  const dwellDepth = mode === MODE.DWELL || (unhurried && mode === MODE.GLANCE);
  const depth = dwellDepth && !interruptOnly ? 3 : 1;
  const stack = eligible.slice(0, depth);
  return { hero: stack[0] ?? null, stack };
}
