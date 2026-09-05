/* ═══════════════════════════════════════════════════════════════════════════
   RESOLUTIONS — the house saying that something it could not explain is fine
   again, and saying it quietly.

   The server half is `server/services/unresolved.js`, and its header carries
   the argument this module exists to honour. In one line: an OPEN question is
   answered and never announced, because "the kitchen camera has gone quiet and
   I can't account for it", unprompted at 11pm, is a horror film. A RESOLVED
   one is the end of that story, costs the room nothing, and CHARACTER.md:196
   already licenses it — *"When it is told the answer, it takes it."*

   ── The register, which is the whole of the design ──────────────────────────

   ⚠⚠ **THIS IS THE MOST DEMOTED THING ON THE WALL, AND IT HAS TO STAY THAT
   WAY.** `core/health.js` documents what happens when the house's own plumbing
   gets a loud voice: a degraded feed used to ride in through `announce()` at
   score 72, win depth 1, and set "Home Assistant isn't answering." in 132px
   Fraunces across the top half of the glass. The owner's verdict at the panel,
   verbatim: *"the big text error messages take away from the dashboard
   itself."* That was BAD news in the loud register. Good news in the loud
   register is not better — it is the same wall spending its one editorial
   voice on its own maintenance, just more cheerfully.

   So `SCORE` is 41. That is the Low band (40-49) — the same shelf as the
   commute, tonight's menu and now-playing — and three properties fall out of
   `attentionRank.selectForMode` for free rather than being enforced here:

     1. **An empty room sees nothing.** MODE.AMBIENT is interrupt-only, so a
        resolution announced to nobody is not shown dimly to nobody; it is not
        shown. It sits in the queue and expires.
     2. **It can never take the glance.** Depth 1 needs `interrupt` or the High
        floor at 70. This has neither, so the wall cannot light up for it.
        `core/attention.js` puts the bar plainly: a surface that lit up for
        "Chicken Fajitas" is a surface nobody trusts, and a camera coming back
        is squarely in Chicken Fajitas territory.
     3. **It reaches the glass only at depth 2** — one cell of the spread, to
        somebody who has already been standing there for thirty seconds. That
        is the correct audience for it: a person looking at the wall on
        purpose, who has room for one more small true thing.

   ⚠ **IT NEVER SPEAKS.** There is no `speak()` on this path and adding one
   would not be a small change. health.js's reason transfers directly and is
   about FREQUENCY, not about sentiment: a wall that runs for weeks and talks
   about its own plumbing is the surface teaching the household to stop
   listening to it. The line is written to be READ.

   ── One-shot, and where that is enforced ────────────────────────────────────

   The server owns it. `GET /api/house/resolutions` is pure and returns only
   what is fresh and unaired; `POST .../aired` burns it. This module POSTs
   after `announce()` returns, not before the fetch, so the mark means the line
   reached the queue rather than that somebody polled.

   ⚠ A failed POST re-announces on the next poll. That is the deliberate
   direction to fail in: `announce()` REPLACES on a repeat id, so the cost of a
   double is one cell that lingers a minute longer, and the cost of burning it
   early is a resolution nobody ever saw. Rare and quiet beats lost and silent.
   ═══════════════════════════════════════════════════════════════════════════ */

/* ⚠ NO `record()` IMPORT, AND THAT IS NOT AN OMISSION. `core/attention.js`
   already records `attn:<source>` at offered / hero / shown for every candidate
   in the queue, and this raises one under `source: "resolution"` — so the
   census key exists and is counted by the engine, the same way `attn:arrival`
   and `attn:memory` are. A fourth outcome recorded from here would be
   "announced", which is what "offered" already means one tick later. */
import { announce } from "./attention.js";

const POLL_MS = 60_000;

/* The Low band. See the header — this number is the feature's manners. */
const SCORE = 41;

/* How long one stays in the queue once announced. Long enough that somebody
   who walks up a few minutes after the camera came good still gets told;
   short enough that a spread composed half an hour later is about today.
   ⚠ NOT OPTIONAL — `announce()` requires it, and its reason is exactly this
   case: "an announcement with no end is a claim about the present that becomes
   a lie, and there is no timer here to clean it up." */
const LIFE_MS = 15 * 60 * 1000;

let timer = null;
let last = null;

/* Announced this session, so a POST that failed does not become a permanent
   double. Bounded by the server's own one-shot: an id only ever reaches here
   when the store still thinks it is unaired, so this Set grows at the rate the
   house actually resolves things — a handful a month, not a leak. */
const seen = new Set();

async function poll() {
  let resolutions = null;
  try {
    const res = await fetch("/api/house/resolutions", { signal: AbortSignal.timeout(5000) });
    if (res.ok) resolutions = (await res.json())?.resolutions;
  } catch {
    /* Unreachable server: this page is served BY it, so a failed poll is a
       restart in progress or a page that is about to stop working anyway.
       Nothing is inferred from it — the same reading core/health.js takes. */
  }
  if (!Array.isArray(resolutions) || !resolutions.length) {
    last = { at: new Date().toISOString(), announced: [] };
    return [];
  }

  const announced = [];
  for (const item of resolutions) {
    if (!item?.key || typeof item.text !== "string" || !item.text.trim()) continue;
    if (seen.has(item.key)) continue;
    seen.add(item.key);

    announce({
      /* Keyed on the observation, not the moment. The same camera resolving
         twice is two stories to the store (it opens a new item), but only one
         of them can be in the queue at a time, and a replace is the right
         outcome if it somehow is. */
      id: `resolution:${item.key}`,
      source: "resolution",
      text: item.text.trim(),
      score: SCORE,
      /* ⚠ Both spelled out rather than left to `announce()`'s defaults. This is
         the line that keeps the feature quiet, and a reader checking whether
         this can ever seize the wall should find the answer here rather than
         having to prove an absence. */
      interrupt: false,
      expiresAt: Date.now() + LIFE_MS,
      cooldownMs: 0
    });
    announced.push(item.key);
  }

  /* Burn them server-side. Fire-and-forget on purpose: the announce has
     already happened and a failed mark costs one repeat, which `seen` above
     absorbs for the life of this page anyway. */
  if (announced.length) {
    fetch("/api/house/resolutions/aired", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ keys: announced })
    }).catch(() => {});
  }

  last = { at: new Date().toISOString(), announced };
  return announced;
}

/** The last poll, for __v3(). */
export function lastResolution() {
  return last;
}

export function initResolutions({ enabled = false } = {}) {
  if (!enabled || timer) return;

  /* ⚠ Registered BEFORE the first poll, not after — the first poll is a fetch
     and anything driving this page over CDP can arrive during that gap. A hook
     that only exists once an async load has settled is the flake this repo has
     root-caused twice. Returns the promise rather than awaiting it so the
     registration itself stays synchronous. */
  window.__v3Resolutions = () => poll();

  poll();
  // Init-once, per CLAUDE.md's kiosk discipline: no per-event path here, so
  // there is nothing to tear down symmetrically.
  timer = setInterval(() => { poll(); }, POLL_MS);
}