export function normalizeBaseUrl(url) {
  if (!url) return null;
  const trimmed = url.trim().replace(/[<>]/g, "");
  if (/^https?:\/\//i.test(trimmed)) return trimmed.replace(/\/$/, "");
  return `http://${trimmed.replace(/\/$/, "")}`;
}

export const HOLIDAY_REGION_DEFAULT = "QLD";
export const HOLIDAY_COUNTRY = "AU";

/* ═══ V3 CUTOVER — which built entry `/` serves ═══════════════════════════════
   docs/design/V3-CUTOVER.md §3. Two Vite entries come out of one build
   (vite.config.js:17-21) and both are permanently reachable at fixed URLs:

     /index.html  →  dist/index.html      the incumbent, always
     /v3/         →  dist/v3/index.html   V3, always
     /            →  whichever this flag names

   Only `/` moves, because only `/` is what the kiosk opens — dashboard-kiosk
   .service launches Chromium on a bare `http://localhost:3000` (confirmed on
   the G11, 2026-08-09). So this flag alone decides what is on the wall, and
   neither surface can be stranded by it: the one that loses `/` is still one
   URL away, which is the fallback the cutover plan says V3 otherwise has none
   of. Rollback needs no deploy — `V3_DEFAULT=0` in the Pi's .env and a restart.
   ══════════════════════════════════════════════════════════════════════════ */

/** Built entry, relative to dist/, for each surface. */
export const SURFACE_ENTRY = {
  incumbent: "index.html",
  v3: "v3/index.html"
};

/**
 * Committed default. Flip to "v3" only after the flag-on state has been seen
 * on the live kiosk (project rule: default-off until Pi-verified).
 */
export const DEFAULT_ROOT_SURFACE = "incumbent";

/**
 * Resolve which surface `/` serves. Takes `env` as an argument rather than
 * reading `process.env` at module load: this module is imported by server.js,
 * so its top level runs BEFORE server.js calls dotenv.config() and any value
 * captured up here would be frozen at whatever the shell had (audit
 * 2026-07-26, M2 — that exact bug has been shipped here once already).
 *
 * V3_DEFAULT is a hard override in BOTH directions, so the Pi can be pinned
 * either way without a deploy; unset falls through to the committed default.
 */
export function resolveRootSurface(env = {}) {
  const raw = String(env.V3_DEFAULT ?? "").trim().toLowerCase();
  if (raw === "1" || raw === "true") return "v3";
  if (raw === "0" || raw === "false") return "incumbent";
  return DEFAULT_ROOT_SURFACE;
}
