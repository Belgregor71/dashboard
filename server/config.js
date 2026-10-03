export function normalizeBaseUrl(url) {
  if (!url) return null;
  const trimmed = url.trim().replace(/[<>]/g, "");
  if (/^https?:\/\//i.test(trimmed)) return trimmed.replace(/\/$/, "");
  return `http://${trimmed.replace(/\/$/, "")}`;
}

export const HOLIDAY_REGION_DEFAULT = "QLD";
export const HOLIDAY_COUNTRY = "AU";

/* ═══ THE ONE SURFACE — what `/` serves ══════════════════════════════════════
   V3 became `/` on 2026-08-11 (docs/design/V3-CUTOVER.md §3) and the incumbent
   it replaced was RETIRED on 2026-10-03 (docs/audit/INCUMBENT-RETIREMENT-
   2026-10-03.md). There is one Vite entry, so there is nothing left to choose:

     /            →  dist/v3/index.html
     /v3/         →  the same file, through the static mount
     /index.html  →  302 to `/` (the incumbent's old address; server.js)

   `/` is what the kiosk opens — dashboard-kiosk.service launches Chromium on a
   bare `http://localhost:3000`.

   ⚠ `V3_DEFAULT=0` IS NO LONGER A ROLLBACK. It used to put the incumbent back
   without a deploy; there is no incumbent to put back. server.js logs a
   warning if the variable is still set, rather than silently ignoring a line
   someone believes is a lever. The rollback now is a revert + deploy.
   ══════════════════════════════════════════════════════════════════════════ */

/** The built entry `/` serves, relative to dist/. */
export const ROOT_ENTRY = "v3/index.html";

/**
 * A warning for a `V3_DEFAULT` left in `.env` from the two-surface era, or null.
 * Takes `env` as an argument rather than reading `process.env` at module load
 * (this module's top level runs BEFORE server.js calls dotenv.config()).
 */
export function staleSurfaceWarning(env = {}) {
  const raw = String(env.V3_DEFAULT ?? "").trim();
  if (!raw) return null;
  return `[surface] V3_DEFAULT=${raw} is set but no longer does anything — the incumbent was retired 2026-10-03; / always serves V3`;
}
