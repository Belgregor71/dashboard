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
 */
export function rankQueue(candidates, now = new Date()) {
  const t = now.getTime();
  return candidates
    .filter((c) => c && (c.expiresAt == null || c.expiresAt > t))
    .slice()
    .sort((a, b) => b.score - a.score);
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
 */
export function selectForMode(queue, mode, { cooldowns = {}, now = new Date(), currentId = null } = {}) {
  if (mode === MODE.VOICE) return { hero: null, stack: [] };

  const t = now.getTime();
  let eligible = queue.filter(
    (c) =>
      c.id === currentId ||
      c.cooldownMs === 0 ||
      !cooldowns[c.id] ||
      cooldowns[c.id] <= t
  );

  if (mode === MODE.AMBIENT) eligible = eligible.filter((c) => c.interrupt);

  const depth = mode === MODE.DWELL ? 3 : 1;
  const stack = eligible.slice(0, depth);
  return { hero: stack[0] ?? null, stack };
}
