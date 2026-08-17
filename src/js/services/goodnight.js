/* ═══ V3-SHARED-RUNTIME ═════════════════════════════════════════════════════
   Loaded by BOTH surfaces: the incumbent (/) and V3 (/v3/).
   `src/js/` is not the old dashboard — it is V3's runtime library. A cleanup
   that retires "the legacy tree" takes this file out from under V3 with it.
   docs/design/V3-CUTOVER.md §1 · guarded by tests/v3-closure.spec.js
   ════════════════════════════════════════════════════════════════════════ */

/* ── GOODNIGHT, minus the surface ───────────────────────────────────────────
   Everything the routine does that is not "how this particular screen goes to
   rest": fetch tomorrow, write the line, fire the scene. Lifted out of
   modules/goodnightRoutine.js on 2026-08-17 so V3 could reach it.

   ⚠ WHY IT HAD TO MOVE RATHER THAN BE IMPORTED WHERE IT SAT: the routine's
   last act is `engageScreensaver()`, and the screensaver is an incumbent
   module V3 has no counterpart for. Importing goodnightRoutine.js from V3
   would have pulled the whole incumbent screensaver into V3's bundle to reach
   two pure functions and one HA call. So the SHARED half lives here and each
   surface keeps its own ending: the incumbent engages the screensaver, V3
   lets the wall fall back to depth 0.

   The copy is deliberately IDENTICAL on both surfaces — a house that says a
   different goodnight depending on which URL is up is two houses.
─────────────────────────────────────────────────────────────────────────── */

import { callHAService } from "./homeAssistant/client.js";
import { CONFIG } from "../core/config.js";

/** Three is a preview, not an agenda. Past that nobody is listening. */
const MAX_EVENTS = 3;

/**
 * Tomorrow's first few events, already spoken-formatted.
 *
 * ⚠ Returns `null`, never `[]`, when the calendar could not be read. Those are
 * different facts and this house has shipped the bug of conflating them more
 * than once: `[]` makes buildMessage() say "nothing on the calendar tomorrow —
 * a whole day with nothing to do", which is a confident claim about a day
 * nobody actually looked at. A fetch that failed at 10pm the night before a
 * 7am flight would have said exactly that.
 *
 * @returns {Promise<string[]|null>}
 */
export async function tomorrowEvents() {
  try {
    const res  = await fetch("/api/calendar/all");
    if (!res.ok) return null;
    const data = await res.json();

    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowStr = tomorrow.toDateString();

    const events = data.events ?? data ?? null;
    if (!Array.isArray(events)) return null;

    return events
      .filter(ev => {
        const d = new Date(ev.start ?? ev.startDate ?? ev.date);
        return d.toDateString() === tomorrowStr;
      })
      .slice(0, MAX_EVENTS)
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
    return null;
  }
}

/**
 * The line. `null` events means "we could not look" — and the honest shape of
 * that is to say goodnight and leave the day alone, not to guess at it.
 *
 * @param {string[]|null} events
 */
export function goodnightMessage(events) {
  let msg = "Goodnight!";

  if (events === null) {
    // Nothing about tomorrow. Deliberately no apology and no mention of the
    // calendar: someone on their way to bed does not need to hear about a
    // failed fetch.
  } else if (events.length === 0) {
    msg += " Nothing on the calendar tomorrow — a whole day with nothing to do, isn't that just decadent.";
  } else if (events.length === 1) {
    msg += ` Tomorrow you've got ${events[0]}, so get some actual sleep for once.`;
  } else {
    const last = events[events.length - 1];
    const rest = events.slice(0, -1).join(", ");
    msg += ` Tomorrow you've got ${rest}, and ${last} — big day, better rest up.`;
  }

  msg += " Sleep well, gorgeous.";
  return msg;
}

/**
 * Fire the house's goodnight scene. Never throws and never reports: the script
 * may not exist in HA, and a lamp that stayed on is not a reason to refuse to
 * say goodnight.
 */
export async function runGoodnightScene() {
  if (!CONFIG.homeAssistant?.enabled) return false;
  const scriptId = CONFIG.homeAssistant?.goodnightScript ?? "script.goodnight";
  try {
    await callHAService({
      domain: "script",
      service: "turn_on",
      target: { entity_id: scriptId },
    });
    return true;
  } catch {
    return false;                       // non-fatal — script may not exist
  }
}

/**
 * The whole shared half of the routine: the scene goes off while the calendar
 * is being read, because neither should wait on the other — the lights going
 * down are the part the room notices first.
 *
 * @returns {Promise<string>} the line to speak.
 */
export async function prepareGoodnight() {
  const [events] = await Promise.all([
    tomorrowEvents(),
    runGoodnightScene(),
  ]);
  return goodnightMessage(events);
}
