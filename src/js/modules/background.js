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
// modes (the atmosphere tint + readability gradient sit above it in CSS). Static
// by design: fetched once, no rotation timer — the 0%-GPU-at-rest invariant. The
// element is only created when the flag is on → flag-off is byte-identical.
const immichThumb = (id) => `/api/immich/asset/${encodeURIComponent(id)}/thumb`;

async function fetchRandomAssetIds(count = 1) {
  const res = await fetch(`/api/immich/random?count=${count}`, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) return [];
  return ((await res.json()).assets ?? []).map((a) => a?.id).filter(Boolean);
}

async function loadAwakePhoto(img) {
  try {
    const [assetId] = await fetchRandomAssetIds(1);
    if (!assetId) return;
    img.onload = () => {
      img.classList.add("is-loaded");
      awakePhotoAssetId = assetId;
      awakePhotoDay = localDayKey(); // the day this photo belongs to
    };
    img.src = immichThumb(assetId);
  } catch {
    /* Immich down/unreachable → the #background sky gradient shows through */
  }
}

// ── Day-boundary cross-dissolve (features.awakePhotoDissolve) ──
// WP-D follow-up: the photo no longer holds for the whole session — when the
// local calendar day flips, fetch ONE new photo and fade it in over the old on
// --t-settle (60s), then drop the old node. Still static at rest (no rotation
// timer; one slow settle per day), so the 0%-GPU invariant holds. Local date
// key, not toISOString — the UTC date mismatches "today" across midnight.
const DISSOLVE_SETTLE_MS = 60 * 1000; // matches --t-settle in variables.css
const DISSOLVE_CLEANUP_BUFFER_MS = 2000;

let awakePhotoDay = null;
let awakePhotoAssetId = null;
let dissolveInFlight = false;

const localDayKey = () => new Date().toDateString();

async function dissolveAwakePhoto(settleMs = null) {
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
    next.onload = () => {
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
    };
    next.onerror = () => {
      next.remove(); // broken load → keep the old photo, retry next check
      dissolveInFlight = false;
    };
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
  loadAwakePhoto(img);

  if (window.CONFIG?.features?.awakePhotoDissolve) {
    // Init-once interval (allowed by the kiosk memory rules — no per-event timer).
    setInterval(() => {
      if (awakePhotoDay && localDayKey() !== awakePhotoDay) void dissolveAwakePhoto();
    }, 10 * 60 * 1000);
    window.__forcePhotoDissolve = ({ settleMs = null } = {}) => dissolveAwakePhoto(settleMs);
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
