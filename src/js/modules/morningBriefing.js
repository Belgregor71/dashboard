import { wakeScreensaver, resetIdleTimer } from "./screensaver.js";
import { speak } from "../core/tts.js";
import { generateBriefing } from "./aiBriefing.js";
import { switchView } from "../core/viewManager.js";

// 5:35am Mon–Fri, 7:30am Sat–Sun
const SCHEDULE = {
  weekday: { hour: 5,  minute: 35 },
  weekend: { hour: 7,  minute: 30 },
};

let firedDate = null; // date string of last trigger — prevents double-fire

function targetTime() {
  const day = new Date().getDay(); // 0 = Sun, 6 = Sat
  return (day === 0 || day === 6) ? SCHEDULE.weekend : SCHEDULE.weekday;
}

async function triggerMorningBriefing() {
  wakeScreensaver();
  resetIdleTimer();
  switchView("briefing");

  try {
    const summary = await generateBriefing();
    if (summary) await speak(summary, { rate: 0.90 });
  } catch { /**/ }
}

function tick() {
  const now     = new Date();
  const dateStr = now.toDateString();

  if (firedDate === dateStr) return; // already fired today

  const { hour, minute } = targetTime();
  if (now.getHours() !== hour || now.getMinutes() !== minute) return;

  firedDate = dateStr;
  triggerMorningBriefing();
}

export function initMorningBriefing() {
  setInterval(tick, 30_000); // check every 30s — never misses a minute
  tick();                     // also check on boot
}
