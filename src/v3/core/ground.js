/* ═══════════════════════════════════════════════════════════════════════════
   THE GROUND — depth 0's photograph.

   One photograph, held for the day, replaced at the day boundary. It does not
   rotate on a timer, and the reason is DESIGN_SYSTEM.md §5.1 rather than any
   budget: a rotation timer's only cause would be the passage of time, and time
   passing is explicitly NOT a cause. Nothing outside the screen is changing the
   picture behind a dashboard, so nothing on the screen should change it either.
   Mode 0 on the incumbent surface may leaf through the album because leafing
   through it IS the mode and the room can name that. This is not that.

   ⚠ THE FAILURE MODE THIS FILE IS SHAPED AROUND. The photograph comes off a NAS
   that sleeps, and this page runs for weeks between reloads. An <img> that fires
   NEITHER load NOR error is therefore not a hypothetical: it is the normal
   behaviour of a sleeping Synology, and a latch left holding on that path is
   permanent. Every load below has exactly one terminal path, taken once, with a
   stall timer as the third way out — and every failure leaves the day key unset
   on purpose, because an unset day key is precisely what tells the tick to come
   back for it. The incumbent surface shipped without that and spent whole days
   with an empty ground and no retry.
   ═══════════════════════════════════════════════════════════════════════════ */

/* 30s is far beyond a LAN thumbnail and far under the tick that would retry it. */
const STALL_MS = 30 * 1000;

/* How often we ask whether the calendar day has turned. Cheap, init-once, and
   the only timer this module owns. */
const CHECK_MS = 10 * 60 * 1000;

/* The day-boundary settle. A minute, matching the incumbent's dissolve: the one
   photographic change in a day should not be an event, it should be something
   you notice happened rather than something you watch happen. */
const DISSOLVE_MS = 60 * 1000;
const CLEANUP_BUFFER_MS = 2000;

let host = null;                 // the .photo container
let current = null;              // { img, assetId, dayKey }
let inFlight = false;
let checkTimer = null;
let onPhoto = () => {};

/* Local date key, never toISOString: the UTC date disagrees with "today" for
   ten hours of every Brisbane day, which would move the change to mid-morning. */
const localDayKey = () => new Date().toDateString();

const thumbUrl = (id) => `/api/immich/asset/${encodeURIComponent(id)}/thumb`;

/** One-shot terminal path: whichever of load / error / stall arrives first wins,
 *  and the other two become no-ops. */
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
    arm(fn, ms = STALL_MS) { stall = setTimeout(take(fn), ms); }
  };
}

/**
 * Pick the next photograph. Asks for two and prefers one that is not already on
 * the glass: the server caches `rnd:N` for ten minutes, which makes drawing the
 * same asset twice in a row far likelier than chance, and spending the day's
 * one settle on a visual no-op is worse than not settling at all.
 */
async function pickAsset(exclude) {
  try {
    const res = await fetch("/api/immich/random?count=2", { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    const ids = ((await res.json()).assets ?? []).map((a) => a?.id).filter(Boolean);
    return ids.find((id) => id !== exclude) ?? ids[0] ?? null;
  } catch {
    // Immich down or unreachable → no photograph, and the substrate carries
    // depth 0 on its own. The tick comes back in ten minutes.
    return null;
  }
}

/** The first photograph of the session. */
async function loadFirst(stallMs = STALL_MS) {
  if (inFlight || current) return false;
  const img = host?.querySelector("img");
  if (!img) return false;

  inFlight = true;
  let handedOff = false;
  try {
    const assetId = await pickAsset(null);
    if (!assetId) return false;

    const shot = oneShot();
    img.onload = shot.take(() => {
      img.dataset.shown = "1";
      current = { img, assetId, dayKey: localDayKey() };
      inFlight = false;
      onPhoto(img, { transitioning: false });
    });
    // Both failure paths leave `current` null on purpose — that is what the
    // tick reads to know there is still no photograph.
    img.onerror = shot.take(() => { inFlight = false; });
    shot.arm(() => { inFlight = false; }, stallMs);

    img.decoding = "async";
    img.src = thumbUrl(assetId);
    handedOff = true;
    return true;
  } catch {
    return false;
  } finally {
    if (!handedOff) inFlight = false;
  }
}

/**
 * The day boundary. A second <img> fades in ON TOP of the old one, which stays
 * fully opaque underneath until the settle is over.
 *
 * ⚠ Cross-fading BOTH — new in, old out — would leave the pair at ~50% each in
 * the middle, and two half-transparent photographs do not add up to one opaque
 * one: the substrate shows through and the whole wall dips dark halfway through
 * the settle. Fading only the incoming layer is what makes the exchange
 * invisible.
 *
 * ⚠ Cleanup is a setTimeout, never transitionend. transitionend does not fire
 * while the element or any ancestor is display:none, and at depth 3 a subject
 * covers this layer entirely. That bug class has cost this house 709 zombie
 * wrappers and 230k detached nodes; V3 does not get to relearn it.
 */
async function dissolve(settleMs = DISSOLVE_MS, stallMs = STALL_MS) {
  if (inFlight || !current || !host) return false;
  inFlight = true;
  let handedOff = false;
  try {
    const assetId = await pickAsset(current.assetId);
    if (!assetId) return false;   // keep the photograph we have; retry next tick

    const old = current;
    const next = document.createElement("img");
    next.alt = "";
    next.decoding = "async";
    next.style.transition = `opacity ${settleMs}ms linear`;

    const shot = oneShot();
    const settle = () => {
      next.dataset.shown = "1";
      current = { img: next, assetId, dayKey: localDayKey() };
      inFlight = false;

      // The incoming photograph's own opacity may be lower than the outgoing
      // one's. It may not be applied yet — for the length of the settle both
      // are on the glass, and the scrim has to protect the brighter of them.
      onPhoto(next, { transitioning: true });

      setTimeout(() => {
        old.img.remove();
        // #ground names whatever photograph is currently the ground. Carrying
        // the id across keeps that true for the life of the page, so nothing
        // that looks it up ever holds a detached node.
        next.id = old.img.id || "ground";
        onPhoto(next, { transitioning: false });
      }, settleMs + CLEANUP_BUFFER_MS);
    };

    next.onload = shot.take(settle);
    // A dead incoming photograph must not take the live one with it: drop the
    // half-built node and leave the day key as it was so the tick retries.
    next.onerror = shot.take(() => { next.remove(); inFlight = false; });
    shot.arm(() => { next.remove(); inFlight = false; }, stallMs);

    // Appended BEFORE the src so the element has rendered one frame at opacity
    // 0 — a node inserted already at its final state has nothing to transition
    // from and would cut rather than settle.
    host.append(next);
    next.src = thumbUrl(assetId);
    handedOff = true;
    return true;
  } catch {
    return false;
  } finally {
    if (!handedOff) inFlight = false;
  }
}

function tick() {
  if (!current) { void loadFirst(); return; }
  if (current.dayKey !== localDayKey()) void dissolve();
}

/**
 * @param {HTMLImageElement} img  the #ground element from index.html
 * @param {{onPhoto?: (img: HTMLImageElement, meta: {transitioning: boolean}) => void}} opts
 *        Fired whenever the photograph on the glass changes — once on arrival
 *        and, across a day boundary, again when the settle is complete. The
 *        ground deliberately knows nothing about the scrim; main.js wires them.
 */
export function initGround(img, opts = {}) {
  host = img?.parentElement ?? null;
  if (!host) return;
  onPhoto = opts.onPhoto ?? (() => {});

  void loadFirst();

  // Init-once. Per-event timers are where this house has leaked; this one is
  // registered exactly once at startup and never re-created.
  if (!checkTimer) checkTimer = setInterval(tick, CHECK_MS);

  window.__ground = () => ({
    assetId: current?.assetId ?? null,
    dayKey: current?.dayKey ?? null,
    shown: current?.img?.dataset.shown === "1",
    layers: host.querySelectorAll("img").length,
    inFlight
  });
  // The specs drive the day boundary rather than sitting out a real one, and
  // drive the stall rather than sitting out 30 seconds to prove a latch clears.
  window.__groundDissolve = (settleMs, stallMs) => dissolve(settleMs, stallMs);
  window.__groundRetry = () => loadFirst();
}
