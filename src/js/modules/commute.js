import { setCommuteActive } from "./middleSlot.js";

function loadCommuteLottie() {
  const container = document.getElementById("commute-lottie");
  if (!container || !window.lottie) return;
  if (container._lottieInstance) return container._lottieInstance;

  const anim = window.lottie.loadAnimation({
    container,
    renderer: "svg",
    loop: true,
    autoplay: true,
    path: "/icons/car.json"
  });

  container._lottieInstance = anim;
  return anim;
}

// Below this, a traffic delay is just noise not worth flagging on the panel.
const DELAY_THRESHOLD_MIN = 2;

/* ⚠ ONE REQUEST FOR BOTH LEGS, AND NO ADDRESSES IN IT. This used to build
   `/api/commute?origin=<the house's street address>&destination=...` from
   bundled constants — see server/routes/commute.js on why that had to stop. The
   server owns both ends now and returns the labels with the numbers. */
async function fetchLegs() {
  try {
    const res = await fetch("/api/commute/all");
    const data = await res.json();
    if (!res.ok || !Array.isArray(data.legs)) return null;
    return data.legs;
  } catch (err) {
    console.error("Commute API error:", err);
    return null;
  }
}

/** One leg, in the shape the row renderer wants. */
function legResult(leg) {
  if (typeof leg?.seconds !== "number") return { text: "Unavailable" };
  // TomTom already bakes traffic into `seconds`; trafficDelaySeconds is the
  // portion of that due to congestion vs free-flow (already fetched server-side).
  return {
    text: `${Math.round(leg.seconds / 60)} min`,
    delayMin: Math.round((leg.trafficDelaySeconds ?? 0) / 60)
  };
}

function renderCommuteRow(el, name, result) {
  if (!el) return;
  // Rebuild via DOM (not innerHTML) — the delay chip carries a class so its
  // colour comes from --status-warn in CSS, not an inline style.
  el.textContent = `${name} – ${result.text}`;
  if (Number.isFinite(result.delayMin) && result.delayMin >= DELAY_THRESHOLD_MIN) {
    const chip = document.createElement("span");
    chip.className = "commute-delay";
    chip.textContent = `+${result.delayMin} min`;
    el.append(" ", chip);
  }
}

export async function updateCommuteTimes() {
  const legs = await fetchLegs();

  /* The panel has one element per leg, named for the leg. A leg the server does
     not return still gets its row rendered as "Unavailable" rather than left
     with whatever it said an hour ago — a stale drive time is worse than an
     admitted absent one, because it looks current. */
  for (const id of ["greg", "brett"]) {
    const el = document.getElementById(`commute-${id}`);
    if (!el) continue;
    const leg = legs?.find((l) => l.id === id) ?? null;
    renderCommuteRow(el, leg?.label ?? id.charAt(0).toUpperCase() + id.slice(1), legResult(leg));
  }
}

// Debug hook (same convention as __switchView / __engageScreensaver) — lets
// local/CDP verification drive a render with a stubbed /api/commute response.
window.__updateCommuteTimes = updateCommuteTimes;

export function updateCommuteVisibility() {
  const now = new Date();
  const hour = now.getHours();
  const day = now.getDay();

  const isWeekday = day >= 1 && day <= 5;
  const shouldShow = isWeekday && hour >= 6 && hour < 9;
  if (shouldShow) {
    loadCommuteLottie();
  }
  setCommuteActive(shouldShow);
}
