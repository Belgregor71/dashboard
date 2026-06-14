import { speak } from "../core/tts.js";
import { engageScreensaver } from "./screensaver.js";
import { callHAService } from "../services/homeAssistant/client.js";
import { CONFIG } from "../core/config.js";

async function getTomorrowEvents() {
  try {
    const res  = await fetch("/api/calendar/all");
    const data = await res.json();

    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowStr = tomorrow.toDateString();

    return (data.events ?? data ?? [])
      .filter(ev => {
        const d = new Date(ev.start ?? ev.startDate ?? ev.date);
        return d.toDateString() === tomorrowStr;
      })
      .slice(0, 3)
      .map(ev => {
        const title = String(ev.title ?? ev.summary ?? "Untitled event");
        const start = ev.start ?? ev.startDate;
        if (!start) return title;
        const d = new Date(start);
        // Skip time for all-day events (midnight exactly)
        if (d.getHours() === 0 && d.getMinutes() === 0) return title;
        const time = d.toLocaleTimeString("en-AU", {
          hour:   "numeric",
          minute: "2-digit",
          hour12: true,
        });
        return `${title} at ${time}`;
      });
  } catch {
    return [];
  }
}

function buildMessage(events) {
  let msg = "Goodnight!";

  if (events.length === 0) {
    msg += " Nothing on the calendar tomorrow.";
  } else if (events.length === 1) {
    msg += ` Tomorrow you have ${events[0]}.`;
  } else {
    const last = events[events.length - 1];
    const rest = events.slice(0, -1).join(", ");
    msg += ` Tomorrow you have ${rest}, and ${last}.`;
  }

  msg += " Sleep well.";
  return msg;
}

async function runHaScene() {
  if (!CONFIG.homeAssistant?.enabled) return;
  const scriptId = CONFIG.homeAssistant?.goodnightScript ?? "script.goodnight";
  try {
    await callHAService({
      domain: "script",
      service: "turn_on",
      target: { entity_id: scriptId },
    });
  } catch {
    // Non-fatal — script may not exist in HA
  }
}

export async function triggerGoodnight() {
  // Fetch calendar and fire HA scene in parallel — neither should block the other
  const [events] = await Promise.all([
    getTomorrowEvents(),
    runHaScene(),
  ]);

  // Speak the goodnight message and wait for it to finish before dimming
  await speak(buildMessage(events), { rate: 0.88 });

  // Transition to minimal clock mode
  engageScreensaver({ startMode: "minimal" });
}
