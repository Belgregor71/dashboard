import { fetchHolidaysForYear } from "../services/calendar/holidays.js";

function getTintClassForNow() {
  const hour = new Date().getHours();
  if (hour >= 5 && hour < 9) return "tint-morning";
  if (hour >= 9 && hour < 17) return "tint-day";
  if (hour >= 17 && hour < 21) return "tint-evening";
  return "tint-night";
}

function initStars() {
  const stars = document.getElementById("stars");
  if (!stars || stars.childElementCount > 0) return;

  const frag = document.createDocumentFragment();
  for (let i = 0; i < 90; i++) {
    const star = document.createElement("i");
    star.style.left = `${(Math.random() * 100).toFixed(1)}%`;
    star.style.top = `${(Math.random() * 72).toFixed(1)}%`;
    star.style.animationDelay = `${(Math.random() * 4).toFixed(1)}s`;
    frag.appendChild(star);
  }
  stars.appendChild(frag);
}

const SEASON_CLASSES = ["season-summer", "season-autumn", "season-winter", "season-spring"];
function getSeasonClassForNow() {
  // Southern Hemisphere mapping (this dashboard is QLD-based, same region
  // already hardcoded in src/js/services/calendar/holidays.js)
  const month = new Date().getMonth(); // 0-11
  if ([11, 0, 1].includes(month)) return "season-summer";
  if ([2, 3, 4].includes(month)) return "season-autumn";
  if ([5, 6, 7].includes(month)) return "season-winter";
  return "season-spring";
}

async function checkHoliday() {
  const holidays = await fetchHolidaysForYear(new Date().getFullYear());
  const todayStr = new Date().toDateString();
  const isHoliday = holidays.some(h => new Date(h.start).toDateString() === todayStr);
  document.body.classList.toggle("is-holiday", isHoliday);
}

// ── Awake photographic ground (features.awakeGround, WP-D) ────
// docs/design/DESIGN_ROLLOUT.md. A single Immich photo held behind the awake
// modes (the atmosphere tint + readability gradient sit above it in CSS). It
// does not rotate: one photo per day, replaced by the day-boundary dissolve
// below.
//
// ⚠ WHY IT DOES NOT ROTATE, restated 2026-08-04. This used to cite "the
// 0%-GPU-at-rest invariant", which was REPEALED for the G11 on 2026-08-01 — so
// the reason was dead while the rule it justified was still right. The live
// reason is DESIGN_SYSTEM.md §5.1: a rotation timer's only cause would be the
// passage of time, which §5.1 names explicitly as NOT a cause. Mode 0 may leaf
// through the album because leafing through it IS the mode and the room can
// name that; awake, the photo is ground behind a dashboard and nothing outside
// the screen is changing it. The budget is no longer the argument.
//
// The element is only created when the flag is on → flag-off is byte-identical.
const immichThumb = (id) => `/api/immich/asset/${encodeURIComponent(id)}/thumb`;

// An <img> that never fires load OR error is the failure this whole module has
// to survive: the photo comes off a NAS that sleeps, and this page runs for
// weeks between reloads, so a latch left holding is permanent. Every load below
// therefore has exactly one terminal path, taken once, with a stall timer as the
// third way out. 30s is far beyond a LAN thumbnail and far under the 10-minute
// tick that would retry it.
const LOAD_STALL_MS = 30 * 1000;

/** One-shot terminal path: whichever of load/error/stall arrives first wins. */
function oneShot() {
  let done = false;
  let stall = null;
  const take = (fn) => () => {
    if (done) return;
    done = true;
    clearTimeout(stall);
    stall = null;
    fn();
  };
  return {
    take,
    arm(fn, ms = LOAD_STALL_MS) { stall = setTimeout(take(fn), ms); }
  };
}

async function fetchRandomAssetIds(count = 1) {
  const res = await fetch(`/api/immich/random?count=${count}`, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) return [];
  return ((await res.json()).assets ?? []).map((a) => a?.id).filter(Boolean);
}

// ⚠ Guards the retry, which did not exist before 2026-08-04 and is the reason
// this latch is needed: without it a slow first load and a tick could both be
// in flight, racing to write awakePhotoAssetId.
let initialLoadInFlight = false;

/**
 * The boot photo. Resolves true only when a photo is actually on the glass.
 *
 * ⚠ Every failure path here used to be silent AND terminal: no `onerror`, and a
 * failed fetch returned without ever setting `awakePhotoDay` — which is the
 * variable the day-boundary check is guarded by. One sleeping NAS at page load
 * therefore left the ground empty for the life of the page, with no retry, and
 * the page runs for weeks. Failures must now leave the latch clear so
 * awakePhotoTick() can come back for it.
 */
async function loadAwakePhoto(img) {
  if (!img || initialLoadInFlight) return false;
  initialLoadInFlight = true;
  let handedOff = false;
  try {
    const [assetId] = await fetchRandomAssetIds(1);
    if (!assetId) return false;   // Immich down → the tick retries in 10 min
    const shot = oneShot();
    img.onload = shot.take(() => {
      img.classList.add("is-loaded");
      awakePhotoAssetId = assetId;
      awakePhotoDay = localDayKey(); // the day this photo belongs to
      initialLoadInFlight = false;
    });
    // A broken or stalled load leaves `awakePhotoDay` null on purpose — that is
    // precisely what tells the tick there is still no photo.
    img.onerror = shot.take(() => { initialLoadInFlight = false; });
    shot.arm(() => { initialLoadInFlight = false; });
    img.src = immichThumb(assetId);
    handedOff = true;
    return true;
  } catch {
    /* Immich down/unreachable → the #background sky gradient shows through */
    return false;
  } finally {
    if (!handedOff) initialLoadInFlight = false;
  }
}

// ── Day-boundary cross-dissolve (features.awakePhotoDissolve) ──
// WP-D follow-up: the photo no longer holds for the whole session — when the
// local calendar day flips, fetch ONE new photo and fade it in over the old on
// --t-settle (60s), then drop the old node. Still one settle per day and no
// rotation timer — see the §5.1 note above for why that is the rule now that
// the 0%-GPU invariant it originally cited has been repealed. Local date key,
// not toISOString — the UTC date mismatches "today" across midnight.
const DISSOLVE_SETTLE_MS = 60 * 1000; // matches --t-settle in variables.css
const DISSOLVE_CLEANUP_BUFFER_MS = 2000;

let awakePhotoDay = null;
let awakePhotoAssetId = null;
let dissolveInFlight = false;

const localDayKey = () => new Date().toDateString();

// `stallMs`, like `settleMs`, exists so the debug hook can drive the failure in
// a test instead of the suite sitting out a 30s stall to prove a latch releases.
async function dissolveAwakePhoto(settleMs = null, stallMs = null) {
  const old = document.getElementById("awake-photo");
  if (!old || dissolveInFlight) return false;
  dissolveInFlight = true;
  let handedOff = false;
  try {
    // Ask for two and prefer one that ISN'T the current photo — dissolving to
    // the same asset would spend the day's settle on a visual no-op (and the
    // server's 10-min rnd:N cache makes a repeat more likely than raw chance).
    // A one-photo pool falls back to the repeat rather than never settling.
    const ids = await fetchRandomAssetIds(2);
    const assetId = ids.find((id) => id !== awakePhotoAssetId) ?? ids[0] ?? null;
    if (!assetId) return false; // Immich down → keep the old photo, retry next check
    const next = document.createElement("img");
    next.className = "awake-photo";
    next.alt = "";
    next.decoding = "async";
    if (settleMs) next.style.transition = `opacity ${settleMs}ms ease`; // debug-hook fast path
    const holdMs = (settleMs || DISSOLVE_SETTLE_MS) + DISSOLVE_CLEANUP_BUFFER_MS;
    // ⚠ `dissolveInFlight` used to be released by onload/onerror ONLY. A request
    // that hangs without firing either — the sleeping-NAS shape — left the latch
    // holding forever, and every later dissolve returned early at the guard
    // above. The photo would then never change again for the life of the page,
    // which is the exact symptom this function exists to prevent, arriving by a
    // different road. The stall timer is the third terminal path.
    const shot = oneShot();
    next.onload = shot.take(() => {
      next.classList.add("is-loaded"); // fades in over the old (later sibling paints above)
      awakePhotoAssetId = assetId;
      awakePhotoDay = localDayKey();
      // Cleanup on a timer, never transitionend — it never fires while the
      // element is hidden (the 24/7-kiosk rule), and views hide constantly.
      setTimeout(() => {
        old.remove();
        next.id = "awake-photo"; // the survivor is THE photo again
        dissolveInFlight = false;
      }, holdMs);
    });
    next.onerror = shot.take(() => {
      next.remove(); // broken load → keep the old photo, retry next check
      dissolveInFlight = false;
    });
    // Detaching the stalled node is what makes a late load harmless: onload may
    // still fire on it, but oneShot has already spent its single terminal path,
    // so nothing paints and the latch is not released twice.
    shot.arm(() => {
      next.remove();
      dissolveInFlight = false;
    }, stallMs || LOAD_STALL_MS);
    old.after(next);
    next.src = immichThumb(assetId);
    handedOff = true; // onload/onerror now own the latch
    return true;
  } catch {
    return false;
  } finally {
    if (!handedOff) dissolveInFlight = false;
  }
}

const AWAKE_TICK_MS = 10 * 60 * 1000;

/**
 * The one recurring check the ground gets. Two jobs, in priority order, and the
 * order matters: with no photo there is no day to compare against.
 *
 * ⚠ The retry belongs to `awakeGround`, not to `awakePhotoDissolve` — it repairs
 * "there is a photo at all", which is the ground's own job. The day-flip half
 * stays gated, so the dissolve's flag-off state is still "no day check", as its
 * config note claims.
 *
 * Retrying only every 10 minutes leaves the ground on the bare sky gradient for
 * up to that long if Immich is asleep at boot. That is deliberate: it reuses the
 * one init-once interval instead of adding a per-event timer chain (the 24/7
 * memory rules), a sleeping NAS takes minutes to wake anyway, and the state it
 * replaces was "blank until someone reloads the page", i.e. weeks.
 */
// ⚠ Returns the promise rather than void, and that is load-bearing for the
// tests, not decoration: a tick that resolves immediately lets a spec fire the
// next one while the previous fetch is still in flight, where it is correctly
// refused by the in-flight latch and reads as "the retry did not work". Neither
// callee ever rejects (both resolve to a boolean), so the interval below can
// discard it safely.
function awakePhotoTick() {
  if (!awakePhotoDay) return loadAwakePhoto(document.getElementById("awake-photo"));
  if (!window.CONFIG?.features?.awakePhotoDissolve) return Promise.resolve(false);
  if (localDayKey() !== awakePhotoDay) return dissolveAwakePhoto();
  return Promise.resolve(false);
}

function initAwakeGround() {
  if (!window.CONFIG?.features?.awakeGround) return;
  const bg = document.getElementById("background");
  if (!bg || document.getElementById("awake-photo")) return;
  const img = document.createElement("img");
  img.id = "awake-photo";
  img.className = "awake-photo"; // styling is class-based so a dissolve can pair imgs
  img.alt = "";
  img.decoding = "async";
  bg.prepend(img); // the bottom layer of the ground (tint + readability sit above)
  void loadAwakePhoto(img);

  // Init-once interval (allowed by the kiosk memory rules — no per-event timer).
  setInterval(() => void awakePhotoTick(), AWAKE_TICK_MS);
  // The seam the retry is testable through: the tick is otherwise reachable only
  // by waiting ten minutes, which is how it shipped untested in the first place.
  window.__awakePhotoTick = awakePhotoTick;

  if (window.CONFIG?.features?.awakePhotoDissolve) {
    window.__forcePhotoDissolve = ({ settleMs = null, stallMs = null } = {}) =>
      dissolveAwakePhoto(settleMs, stallMs);
  }
}

export function initBackground() {
  // Under awakeGround the aurora/stars layer is display:none behind the photo
  // ground, so building the 90 star nodes just leaves dead DOM. Skip it.
  if (!window.CONFIG?.features?.awakeGround) initStars();
  updateTint();
  setInterval(updateTint, 10 * 60 * 1000);
  void checkHoliday();
  setInterval(checkHoliday, 24 * 60 * 60 * 1000);
  initAwakeGround();
}

const TINT_CLASSES = ["tint-morning", "tint-day", "tint-evening", "tint-night"];

function updateTint() {
  const tint = document.getElementById("background-tint");
  const tintClass = getTintClassForNow();

  // Apply to the overlay element (controls background wash colour)
  tint?.classList.remove(...TINT_CLASSES);
  tint?.classList.add(tintClass);

  // Apply to body so CSS can target body.tint-* for accent colours
  document.body.classList.remove(...TINT_CLASSES);
  document.body.classList.add(tintClass);

  document.body.classList.remove(...SEASON_CLASSES);
  document.body.classList.add(getSeasonClassForNow());
}
