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

async function getDriveTime(origin, destination) {
  const url =
    `/api/commute?origin=${encodeURIComponent(origin)}` +
    `&destination=${encodeURIComponent(destination)}`;

  try {
    const res = await fetch(url);
    const data = await res.json();
    if (!res.ok || typeof data.seconds !== "number") return "Unavailable";

    const minutes = Math.round(data.seconds / 60);
    return `${minutes} min`;
  } catch (err) {
    console.error("Commute API error:", err);
    return "Error";
  }
}

export async function updateCommuteTimes() {
  const [gregTime, brettTime] = await Promise.all([
    getDriveTime(COMMUTE_ORIGIN, COMMUTE_GREG_DEST),
    getDriveTime(COMMUTE_ORIGIN, COMMUTE_BRETT_DEST)
  ]);

  const gregEl = document.getElementById("commute-greg");
  const brettEl = document.getElementById("commute-brett");

  if (gregEl) gregEl.textContent = `Greg – ${gregTime}`;
  if (brettEl) brettEl.textContent = `Brett – ${brettTime}`;
}

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
