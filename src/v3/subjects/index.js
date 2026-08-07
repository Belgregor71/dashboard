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
   ═══════════════════════════════════════════════════════════════════════════ */

// No escaping helper is imported because no string here reaches the DOM as
// markup — every text path below uses textContent.

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
  const m = ensureMount();
  if (!m) return null;

  const wrap = document.createElement("div");
  wrap.className = "subject subject--camera";

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
  m.replaceChildren(wrap);

  // Reveal the stream only once it has actually painted something.
  const onLive = () => live.classList.add("is-ready");
  live.addEventListener("load", onLive);
  live.src = `/api/camera/${encodeURIComponent(cameraId)}/live`;

  return () => {
    live.removeEventListener("load", onLive);
    // Order matters: drop the src BEFORE the node goes, or Chromium can keep
    // the MJPEG connection alive on a detached element.
    live.src = "";
    still.src = "";
    live.remove();
    still.remove();
  };
}

/* ── The sky ────────────────────────────────────────────────────────────────
   The radar loop the server already proxies and caches, over the real map.
   A 3x3 tile mosaic at z7, basemap under, rain over — both served from our own
   cache, so this costs no third-party call at the moment it is asked for.
─────────────────────────────────────────────────────────────────────────── */
async function showSky() {
  const m = ensureMount();
  if (!m) return null;

  let meta = null;
  try {
    const res = await fetch("/api/weather/radar/meta");
    if (res.ok) meta = await res.json();
  } catch { /* fall through */ }
  if (!meta?.tiles?.length) return null;

  const wrap = document.createElement("div");
  wrap.className = "subject subject--sky";

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
  m.replaceChildren(wrap);

  return () => {
    for (const img of wrap.querySelectorAll("img")) img.src = "";
    wrap.remove();
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

/**
 * Show the subject an intent named.
 * @returns {Promise<boolean>} false means "nothing to show" — the caller falls
 *          through rather than leaving the screen empty and confident.
 */
export async function showSubject(intent, _snapshot) {
  clearSubject();

  let teardown = null;
  if (intent.id === "show.camera" && intent.slots?.camera) {
    const id = intent.slots.camera;
    teardown = showCamera(id, CAMERA_LABELS[id] ?? id.replace(/_/g, " "));
  } else if (intent.id === "show.sky") {
    teardown = await showSky();
  }

  if (!teardown) {
    clearSubject();
    return false;
  }
  active = { id: intent.id, teardown };
  return true;
}

/** Which subject is mounted, for the debug hook and the tests. */
export function activeSubject() {
  return active?.id ?? null;
}
