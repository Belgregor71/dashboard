import {
  COMMUTE_ORIGIN,
  COMMUTE_GREG_DEST,
  COMMUTE_BRETT_DEST
} from "../config/config.js";

async function getDriveTime(origin, destination) {
  const url =
    `/api/commute?origin=${encodeURIComponent(origin)}` +
    `&destination=${encodeURIComponent(destination)}`;

  try {
    const res = await fetch(url);
    const data = await res.json();

    const element = data.rows[0].elements[0];
    if (element.status !== "OK") return "Unavailable";

    return element.duration_in_traffic
      ? element.duration_in_traffic.text
      : element.duration.text;
  } catch (err) {
    console.error("Commute API error:", err);
    return "Error";
  }
}

export async function updateCommuteTimes() {
  const gregTime = await getDriveTime(COMMUTE_ORIGIN, COMMUTE_GREG_DEST);
  const brettTime = await getDriveTime(COMMUTE_ORIGIN, COMMUTE_BRETT_DEST);

  const gregEl = document.getElementById("commute-greg");
  const brettEl = document.getElementById("commute-brett");

  if (gregEl) gregEl.textContent = `Greg – ${gregTime}`;
  if (brettEl) brettEl.textContent = `Brett – ${brettTime}`;
}

export function updateCommuteVisibility() {
  const now = new Date();
  const hour = now.getHours();
  const panel = document.getElementById("commute-panel");
  if (!panel) return;

  const shouldShow = hour >= 6 && hour < 9;
  if (shouldShow) {
    panel.classList.remove("is-collapsed");
    requestAnimationFrame(() => {
      panel.classList.remove("is-hidden");
    });
    return;
  }

  if (panel.classList.contains("is-hidden")) return;
  panel.classList.add("is-hidden");
  panel.addEventListener(
    "transitionend",
    () => {
      if (panel.classList.contains("is-hidden")) {
        panel.classList.add("is-collapsed");
      }
    },
    { once: true }
  );
}
