import {
  COMMUTE_ORIGIN,
  COMMUTE_GREG_DEST,
  COMMUTE_BRETT_DEST
} from "../config/config.js";
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
    path: "/icons/car.lottie"
  });

  container._lottieInstance = anim;
  return anim;
}

// Below this, a traffic delay is just noise not worth flagging on the panel.
const DELAY_THRESHOLD_MIN = 2;

async function getDriveTime(origin, destination) {
  const url =
    `/api/commute?origin=${encodeURIComponent(origin)}` +
    `&destination=${encodeURIComponent(destination)}`;

  try {
    const res = await fetch(url);
    const data = await res.json();
    if (!res.ok || typeof data.seconds !== "number") return { text: "Unavailable" };

    const minutes = Math.round(data.seconds / 60);
    // TomTom already bakes traffic into `seconds`; trafficDelaySeconds is the
    // portion of that due to congestion vs free-flow (already fetched server-side).
    const delayMin = Math.round((data.trafficDelaySeconds ?? 0) / 60);
    return { text: `${minutes} min`, delayMin };
  } catch (err) {
    console.error("Commute API error:", err);
    return { text: "Error" };
  }
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
  const [greg, brett] = await Promise.all([
    getDriveTime(COMMUTE_ORIGIN, COMMUTE_GREG_DEST),
    getDriveTime(COMMUTE_ORIGIN, COMMUTE_BRETT_DEST)
  ]);

  renderCommuteRow(document.getElementById("commute-greg"), "Greg", greg);
  renderCommuteRow(document.getElementById("commute-brett"), "Brett", brett);
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
