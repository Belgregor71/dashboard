import { getLabelledSpans, coveringSpan } from "./vaultIndex.js";

// What the ambient ground is allowed to call the OCCASION a photograph belongs to.
//
// Stage 1 (photoNames.js) gave the wall back the vault's people. This is the
// other half: the vault's dates. Until now every date in the vault was prose —
// trips/thailand-2026.md says "29 March to 12 April 2026" and nothing could read
// it — so a photograph from inside a fifteen-day trip was captioned with the
// same bare year as a Tuesday at home.
//
// The join is at READ time and nothing is copied between stores, which is the
// decision this whole lane rests on: the vault is MEANING (what a trip was),
// Immich is the INDEX (when a photograph was taken). Neither knows about the
// other; this file asks one a question about the other's answer.
//
// Server-side for the same reason photoNames is: note content is loopback-only
// (docs/design/VAULT.md "Routes"). The browser receives a rendered phrase — one
// short string — and never the span table or the notes behind it.

/** ⚠ Read PER REQUEST. server.js's static imports all evaluate before its
 *  dotenv.config(), so a module-load read is frozen at undefined (the
 *  KOKORO_VOICE trap, and M2 in the forensic audit). */
function vaultEnabled() {
  const raw = process.env.VAULT_ENABLED;
  return (raw ? raw.trim().replace(/^["']|["']$/g, "") : null) === "1";
}

/* The photograph's LOCAL calendar day.
 *
 * ⚠ Local, never UTC, and this is load-bearing rather than pedantic: the route
 * returns `localDateTime`, and Thailand is UTC+7. `new Date(...).toISOString()`
 * on a 9am Bangkok photograph yields the PREVIOUS day, which silently drops
 * every morning of a trip out of its own span — and does it at both ends, so a
 * fifteen-day trip loses its first morning and gains a day it wasn't on.
 *
 * A plain string slice avoids the round trip entirely. `localDateTime` is an
 * ISO-shaped string whose first ten characters ARE the local day; anything that
 * is not that shape is a shape we do not understand, and coveringSpan rejects it. */
function dayOf(asset) {
  const raw = asset?.localDateTime;
  return typeof raw === "string" ? raw.slice(0, 10) : null;
}

/**
 * Add a `trip` string to each asset that falls inside a labelled vault span.
 *
 * The shape added is a phrase, not a record — "Mexico 2017" — because that is
 * all a caption can use and it is all the browser should be told. Assets outside
 * every span are returned UNTOUCHED, without even the key, so the common case
 * (a Tuesday at home) is byte-identical to before.
 *
 * ⚠ THE YEAR IS APPENDED HERE, from the PHOTOGRAPH, and the author never writes
 * it. The trip replaces the bare year in the caption (ground.js captionFor), so
 * an author who wrote `label: Thailand` by hand would silently delete the year
 * from the wall and leave "Chiang Mai · Thailand" answering nobody's question.
 * Deriving it removes that footgun and one more: a label and a span that
 * disagree about the year cannot happen if only one of them holds it.
 *
 * The photo's year rather than the span's, which differ only for a trip across
 * New Year — and there the photograph is right and the trip's start is not.
 *
 * OFF ⇒ IDENTITY, three ways over:
 *   1. VAULT_ENABLED unset — the rollback, one .env edit and a restart.
 *   2. No note carries a `date:` — which is true of every note ever written
 *      until someone authors one, so this ships INERT and turns on when the
 *      vault repo is pushed, not when the code deploys.
 *   3. A note has dates but no `label:` — nothing to say, so nothing is said.
 *
 * Never mutates its input: the route memo holds the raw upstream assets and is
 * shared between requests, so a mutation here would pin a caption into a cache
 * the vault reindex can no longer reach.
 */
export function labelTrips(assets) {
  const list = Array.isArray(assets) ? assets : [];
  if (!list.length || !vaultEnabled()) return list;

  const spans = getLabelledSpans();
  if (!spans.length) return list;

  return list.map((asset) => {
    const day = dayOf(asset);
    const span = coveringSpan(spans, day);
    return span ? { ...asset, trip: `${span.label} ${day.slice(0, 4)}` } : asset;
  });
}
