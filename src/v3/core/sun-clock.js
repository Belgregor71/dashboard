/* ═══════════════════════════════════════════════════════════════════════════
   THE SUN-DIMMED HOUR — features.v3SunClock (audit F1 census, family 4).

   The incumbent's `ambientClock` (study 05, docs/design/homeos-ambient-clock.html)
   had the Mode-0 clock's brightness track the sun on a smooth curve — dims with
   the sky, never a hard sunset switch. V3 never read that flag and never had the
   behaviour: `--sun-alt` was written to the root every minute and nothing
   consumed it (docs/audit/F1-FLAG-CENSUS-2026-09-11.md).

   The curve is the incumbent's, measured on the wall at 3–4 m: the small-hours
   floor at astronomical twilight, full strength once the sun is 6° up. The
   ceiling is V3's own full-strength hour (1.0) rather than the incumbent's 0.9,
   so a day with this flag on is the day the wall already shows.

   Type and opacity only — no new motion. The hour's existing opacity transition
   eases each minute's step, so the idle GPU stays where it was.
   ═══════════════════════════════════════════════════════════════════════════ */

export const CLOCK_DIM_DAY = 1;     // sun well up → V3's normal hour
export const CLOCK_DIM_NIGHT = 0.3; // the small-hours floor — dim, never off
export const CLOCK_ALT_DAY = 6;     // ° above the horizon mapped to CLOCK_DIM_DAY
export const CLOCK_ALT_NIGHT = -18; // ° (astronomical twilight) mapped to CLOCK_DIM_NIGHT

/** Sun altitude in degrees → the hour's opacity, linear between the two
 *  altitudes and clamped outside them. A non-finite altitude reads as day: an
 *  unknown sky must never dim the only clock on the wall. */
export function clockDim(altitudeDeg) {
  if (!Number.isFinite(altitudeDeg)) return CLOCK_DIM_DAY;
  const t = (altitudeDeg - CLOCK_ALT_NIGHT) / (CLOCK_ALT_DAY - CLOCK_ALT_NIGHT);
  const clamped = Math.min(1, Math.max(0, t));
  return CLOCK_DIM_NIGHT + clamped * (CLOCK_DIM_DAY - CLOCK_DIM_NIGHT);
}
