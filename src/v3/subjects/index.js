/* ═══════════════════════════════════════════════════════════════════════════
   SUBJECTS — depth 3. Voice named one thing; that thing fills the screen.

   Each subject owns the mount, declares its own cost, and MUST tear itself
   down on leave. That last part is not boilerplate: this is the one genuinely
   per-event path in V3, and per-event paths are where this house has leaked
   before — 709 zombie lottie wrappers and 230k detached nodes came from
   exactly this shape of code.

   The registry is deliberately small. A subject that cannot be shown returns
   false and the turn falls through to the model, which is a better outcome
   than a screen that goes blank confidently.

   ── The contract, as of Phase 4 ─────────────────────────────────────────────

   A subject is `(ctx) => { node, teardown, speech?, refs? } | null`, sync or
   async. It BUILDS its node; this file MOUNTS it. That split is what stops six
   modules each having their own opinion about `replaceChildren`, and it means
   the "did anything actually mount" check lives in exactly one place — the
   check that Phase 2 spent a whole review learning to make, after both routes
   into depth 2 were found deepening into an empty lattice.

   `speech` exists for the one subject whose words are not knowable in advance.
   Everything else answers through localAnswers.js, where the INCUMBENT can
   reach the same sentence — it has no depth 3, so those ids fall through to
   answer() and must still be able to say something.
   ═══════════════════════════════════════════════════════════════════════════ */

// No escaping helper is imported because no string here reaches the DOM as
// markup — every text path below uses textContent.


import { showDay } from "./calendar.js";
import { showAhead } from "./ahead.js";
import { showForecast } from "./forecast.js";
import { showList } from "./lists.js";
import { showRecipe } from "./recipe.js";
import { showYear } from "./memories.js";
import { showMedia } from "./media.js";
import { showBriefing } from "./briefing.js";
import { showStatus } from "./status.js";
import { record } from "../core/feature-census.js";

let mount = null;
let active = null;      // { id, teardown }

function ensureMount() {
  if (!mount) mount = document.getElementById("subject-mount");
  return mount;
}

/** Tear down whatever is showing. Idempotent, and safe to call on a mount that
 *  was never populated. */
export function clearSubject() {
  if (active?.teardown) {
    try { active.teardown(); } catch { /* a broken teardown must not wedge depth */ }
  }
  active = null;
  const m = ensureMount();
  if (m) m.replaceChildren();
}

/* ── Camera ─────────────────────────────────────────────────────────────────
   "show me the driveway".

   Two stages on purpose. The still lands immediately — it is a cached JPEG the
   server already holds — so the screen answers within a frame or two. The live
   MJPEG is then layered over it and only revealed once it has actually
   delivered a frame, because a battery camera takes ~15-20s to wake and an
   empty <img> for twenty seconds reads as broken.

   Teardown clears BOTH srcs. An MJPEG <img> whose src is left set keeps the
   HTTP connection open and keeps decoding forever — on a surface that runs for
   weeks that is not a leak, it is a fire.
─────────────────────────────────────────────────────────────────────────── */
function showCamera(cameraId, label) {
  const wrap = document.createElement("div");
  wrap.className = "subject subject--camera";
  wrap.dataset.cell = "cameras";

  const still = document.createElement("img");
  still.className = "subject__frame";
  still.alt = "";
  still.src = `/api/camera/${encodeURIComponent(cameraId)}/snapshot?t=${Date.now()}`;

  const live = document.createElement("img");
  live.className = "subject__frame subject__frame--live";
  live.alt = "";

  const caption = document.createElement("p");
  caption.className = "subject__caption said said--2";
  caption.textContent = label;

  wrap.append(still, live, caption);

  // Reveal the stream only once it has actually painted something.
  const onLive = () => live.classList.add("is-ready");
  live.addEventListener("load", onLive);
  live.src = `/api/camera/${encodeURIComponent(cameraId)}/live`;

  return {
    node: wrap,
    teardown: () => {
      live.removeEventListener("load", onLive);
      // Order matters: drop the src BEFORE the node goes, or Chromium can keep
      // the MJPEG connection alive on a detached element.
      live.src = "";
      still.src = "";
      live.remove();
      still.remove();
      wrap.remove();
    }
  };
}

/* ── The sky ────────────────────────────────────────────────────────────────
   The radar loop the server already proxies and caches, over the real map.
   A 3x3 tile mosaic at z7, basemap under, rain over — both served from our own
   cache, so this costs no third-party call at the moment it is asked for.
─────────────────────────────────────────────────────────────────────────── */
async function showSky() {
  let meta = null;
  try {
    const res = await fetch("/api/weather/radar/meta");
    if (res.ok) meta = await res.json();
  } catch { /* fall through */ }
  if (!meta?.tiles?.length) return null;

  const wrap = document.createElement("div");
  wrap.className = "subject subject--sky";
  wrap.dataset.cell = "sky";

  const grid = document.createElement("div");
  grid.className = "subject__radar";
  for (const { x, y } of meta.tiles) {
    const cell = document.createElement("div");
    cell.className = "subject__tile";
    const base = document.createElement("img");
    base.alt = "";
    base.src = `/api/weather/radar/basemap/${meta.z}/${x}/${y}`;
    const over = document.createElement("img");
    over.alt = "";
    over.className = "subject__overlay";
    over.src = `/api/weather/radar/overlay/${meta.z}/${x}/${y}`;
    cell.append(base, over);
    grid.append(cell);
  }

  wrap.append(grid);

  return {
    node: wrap,
    teardown: () => {
      for (const img of wrap.querySelectorAll("img")) img.src = "";
      wrap.remove();
    }
  };
}

/* Human labels for the camera ids, kept here rather than fetched: /api/cameras
   would be a network round trip inside the answer path, and the whole premise
   of the fast lane is that there isn't one. */
const CAMERA_LABELS = {
  doorbell: "The front door",
  front_yard: "The front yard",
  driveway: "The driveway",
  backyard: "The backyard",
  patio: "The patio",
  side_gate: "The side gate",
  tilt_pan: "The yard camera"
};

/* ── The registry ───────────────────────────────────────────────────────────
   One row per intent id. `show.tonight` and `show.day` both open the day: the
   plan's original four `show.*` ids predate the six subjects and "what about
   tonight" is a question about the evening's shape, which is the calendar's
   answer and not the recipe's.
─────────────────────────────────────────────────────────────────────────── */
const REGISTRY = {
  "show.camera": (intent) => {
    const id = intent.slots?.camera;
    if (!id) return null;
    return showCamera(id, CAMERA_LABELS[id] ?? id.replace(/_/g, " "));
  },
  "show.sky": () => showSky(),
  "show.day": (_intent, snapshot) => showDay(snapshot),
  "show.tonight": (_intent, snapshot) => showDay(snapshot),
  /* ⚠ DELIBERATELY NOT FLAG-GATED, though both are flag-gated features. The gate
     lives in localIntents' matcher, which is the single place that decides
     whether the lane recognises these sentences at all — and it has to be there
     rather than here, because the SPOKEN answer is the half that can be wrong:
     with the calendar's server-side horizon unwidened, the month's answerer
     would count a truncated feed and say "3 things coming up" with authority.
     Declining the sentence declines both halves at once.

     Leaving the registry open is what makes `window.__v3Subject("show.forecast")`
     work while the flag is still off, which is how these get looked at on the
     wall BEFORE the flip rather than after it. The recipePanel flag's own note
     records the opposite trap: a flag with no verify hook can only be eyeballed
     by shipping it on, which is not a verification, it is a deployment. */
  "show.forecast": () => showForecast(),
  "show.ahead": (_intent, snapshot) => showAhead(snapshot),
  "show.list": (intent, snapshot) => showList(snapshot, intent.slots?.list ?? "shopping"),
  "show.recipe": (_intent, snapshot) => showRecipe(snapshot),
  "show.year": () => showYear(),
  "show.media": () => showMedia(),
  "show.briefing": () => showBriefing(),
  // Phase 6. Carries its own `speech` — the box's health is not in the voice
  // snapshot, so localAnswers has nothing to answer this with. See status.js.
  "show.status": () => showStatus()
};

/**
 * Show the subject an intent named.
 *
 * @returns {Promise<false|{speech: string|null, refs: string[]}>} false means
 *          "nothing to show" — the caller falls through rather than leaving the
 *          screen empty and confident. A truthy result carries whatever the
 *          subject wants said about itself, which is usually nothing.
 */
export async function showSubject(intent, snapshot) {
  clearSubject();

  const build = REGISTRY[intent?.id];
  /* Feature census (docs/AUGUST-IMPROVEMENTS.md §1). A no-op until
     initFeatureCensus() has run. `unknown` is the intent lane and the subject
     registry disagreeing about what exists — the id was matched, and there is
     nothing here to show for it. */
  if (!build) {
    if (intent?.id) record("subject", intent.id, "unknown");
    return false;
  }

  let built = null;
  try {
    built = await build(intent, snapshot);
  } catch {
    // A subject that throws is a subject that cannot be shown. It must not be
    // able to take the depth machinery — or the voice turn — down with it.
    built = null;
  }

  if (!built?.node || !built?.teardown) {
    clearSubject();
    /* ⚠ `empty` is the outcome worth watching and the reason this is counted
       per-outcome rather than as one "it ran" tally. A subject that is asked
       for and returns nothing EVERY time is exactly as dead as one that is
       never asked for — and it looks busy from here. `showList` returns null
       whenever HA is down, `showSky` whenever the radar meta is empty. */
    record("subject", intent.id, "empty");
    return false;
  }

  const m = ensureMount();
  if (!m) {
    try { built.teardown(); } catch { /* nothing mounted it; still clean up */ }
    record("subject", intent.id, "empty");
    return false;
  }

  m.replaceChildren(built.node);
  active = { id: intent.id, teardown: built.teardown };
  record("subject", intent.id, "shown");

  return { speech: built.speech ?? null, refs: built.refs ?? [] };
}

/** Every id the registry can build, for the feature census roster.
 *
 *  ⚠ Derived from the REGISTRY's OWN KEYS rather than written out again: object
 *  keys are string literals and survive minification, where a function name does
 *  not (`grep -c bomCandidate dist/assets/v3-*.js` is 0). A subject added to the
 *  registry is therefore in the roster the same moment, with nothing to keep in
 *  step by hand. See src/v3/core/feature-census.js.
 */
export function subjectRoster() {
  return Object.keys(REGISTRY);
}

/** Which subject is mounted, for the debug hook and the tests. */
export function activeSubject() {
  return active?.id ?? null;
}
