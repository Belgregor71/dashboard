import { wakeScreensaver, resetIdleTimer } from "./screensaver.js";
import { speak } from "../core/tts.js";
import { generateBriefing } from "./aiBriefing.js";
import { switchView } from "../core/viewManager.js";

// Add or change entries here to adjust schedule
const SCHEDULES = [
  { name: "morning-weekday", days: [1, 2, 3, 4, 5], hour: 5,  minute: 35, type: "morning", rate: 0.90 },
  { name: "morning-weekend", days: [0, 6],           hour: 7,  minute: 30, type: "morning", rate: 0.90 },
  { name: "evening",         days: [0, 1, 2, 3, 4, 5, 6], hour: 18, minute: 0,  type: "evening", rate: 0.92 },
];

const firedDates = {}; // { scheduleName → dateString } prevents double-fire

async function trigger(schedule) {
  wakeScreensaver();
  resetIdleTimer();
  switchView("briefing");

  try {
    const summary = await generateBriefing({ type: schedule.type });
    if (summary) await speak(summary, { rate: schedule.rate });
  } catch { /**/ }
}

function tick() {
  const now     = new Date();
  const day     = now.getDay(); // 0 = Sun, 6 = Sat
  const dateStr = now.toDateString();

  for (const schedule of SCHEDULES) {
    if (!schedule.days.includes(day)) continue;
    if (firedDates[schedule.name] === dateStr) continue;
    if (now.getHours() !== schedule.hour || now.getMinutes() !== schedule.minute) continue;

    firedDates[schedule.name] = dateStr;
    trigger(schedule);
  }
}

export function initMorningBriefing() {
  setInterval(tick, 30_000);
  tick();
}
