import { fetchPeopleNames } from "./immichClient.js";
import { getRelationships } from "./vaultIndex.js";
import { nameSegment, ambiguousGivenNames } from "../../src/js/services/photoMemory.js";

// What the ambient ground is allowed to call the people in a photograph.
//
// This exists because the V3 cutover cost the wall its only knowledge source.
// The vault's `kind: relationships` map ("our niece Melanie") reached the glass
// through ONE consumer — dailyMemories.js, serving /api/immich/daily-set — and
// that route is fetched only by modules/screensaver.js. V3 has no screensaver
// (src/v3/core/presence.js:7), so the map has been indexed every ten minutes and
// read by nothing. Meanwhile src/v3/core/ground.js captions from raw slim()
// fields: on a live probe the whole caption was "2011".
//
// So this is not new language. It is the SAME language dailyMemories already
// puts under a frozen daily-set photo, applied at the route the ground actually
// fetches. photoMemory.nameSegment is the single authority for how a name is
// said; nothing here re-decides it.
//
// Server-side on purpose. Note content is loopback-only (docs/design/VAULT.md
// "Routes"), and this keeps it that way — the browser receives a rendered
// phrase, never the map.

// ── env (quote-stripping, the .env gotcha) ─────────────────────
// Read PER REQUEST, never at module load: server.js's static imports all
// evaluate before its dotenv.config() (the KOKORO_VOICE trap).
function envVal(key) {
  const raw = process.env[key];
  return raw ? raw.trim().replace(/^["']|["']$/g, "") : null;
}

/** Who must never be named. Also the switch for names at all — see labelPeople. */
export function hiddenNames() {
  const raw = envVal("IMMICH_CAPTION_HIDE_NAMES");
  return raw ? raw.split(",").map((s) => s.trim()).filter(Boolean) : [];
}

/** Both halves must be on: the labels come from the vault, so the vault must be up. */
export function relationshipsEnabled() {
  return envVal("IMMICH_CAPTION_RELATIONSHIPS") === "1" && envVal("VAULT_ENABLED") === "1";
}

// ── the people roster (for given-name ambiguity) ───────────────
//
// displayName() needs to know which given names are shared, or it captions one
// of three Marks "Mark". dailyMemories pays for this with one request per daily
// build; the ground has no build to hang it on, so it is cached here.
//
// ⚠ NEVER awaited on the request path. The kiosk's first fetch after a page load
// already takes ~6 s, and Immich lives on a NAS that sleeps — an await here
// would add a cold upstream round trip to exactly that fetch. The handler warms
// in the background and reads whatever is cached, which for a 24/7 kiosk means
// "the real roster" from the second request onward.
const ROSTER_TTL_MS = 6 * 60 * 60 * 1000;

let roster = null;      // string[] | null (null = never successfully fetched)
let rosterAt = 0;
let inflight = null;

/**
 * Kick off a roster refresh if the cache is cold or stale. Fire-and-forget:
 * returns immediately and never throws.
 */
export function warmRoster() {
  if (inflight) return;
  if (roster && Date.now() - rosterAt < ROSTER_TTL_MS) return;
  inflight = fetchPeopleNames()
    .then((names) => {
      // An empty answer is a failure, not an empty library — Immich down, or the
      // key lost its `person.read` permission. Keeping the previous roster beats
      // silently reverting every caption to bare given names.
      if (Array.isArray(names) && names.length) {
        roster = names;
        rosterAt = Date.now();
      }
    })
    .catch(() => { /* the fallback below is correct without it */ })
    .finally(() => { inflight = null; });
}

/**
 * The ambiguity set for the cached roster.
 *
 * With no roster, qualify EVERY name: verbose, never wrong, and visible enough
 * that the misconfiguration gets noticed. dailyMemories.js:157 makes the same
 * call for the same reason — quietly falling back to bare given names would put
 * the ambiguity back where nobody would see it.
 */
function ambiguity() {
  return roster ? ambiguousGivenNames(roster) : { has: () => true };
}

/** Test seam: forget the cached roster so a spec starts cold. */
export function __resetRoster() {
  roster = null;
  rosterAt = 0;
  inflight = null;
}

// ── the labeller ───────────────────────────────────────────────

/**
 * Rewrite each asset's `people` into the one phrase a caption would say —
 * "our niece Melanie", "Kelly and Rose" — or drop it entirely when there is
 * nobody worth naming.
 *
 * The array shape is kept rather than flattened to a string because
 * ground.js captionFor/captionForFrame both expect a list, and the diptych
 * merges the two halves' lists before joining. One phrase per asset means a
 * pair photographed in the same moment de-duplicates to a single line, which is
 * exactly what captionForFrame is for.
 *
 * OFF ⇒ IDENTITY. Three conditions must all hold; if any fails the assets are
 * returned untouched, byte-identical to the pre-vault response. That is the
 * rollback path (edit the G11's .env, restart) and it is asserted in the specs.
 * The third condition is `hiddenNames()` being non-empty: nameSegment treats an
 * empty hide-list as "names are off" and returns "" for everyone
 * (photoMemory.js:228), so without this guard turning the lane ON would REMOVE
 * the names the ground shows today.
 */
export function labelPeople(assets) {
  const list = Array.isArray(assets) ? assets : [];
  if (!list.length) return list;

  const hideNames = hiddenNames();
  if (!hideNames.length || !relationshipsEnabled()) return list;

  const relationships = getRelationships();
  const ambiguous = ambiguity();

  return list.map((asset) => {
    if (!asset || !Array.isArray(asset.people) || asset.people.length === 0) return asset;
    const phrase = nameSegment(asset.people, hideNames, ambiguous, relationships);
    return { ...asset, people: phrase ? [phrase] : [] };
  });
}
