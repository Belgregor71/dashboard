/* ═══════════════════════════════════════════════════════════════════════════
   THE CAST PIPES UP — a few unprompted moments a day.

   No scheduler of its own: attention.js already decides what deserves the wall,
   so a moment is that same candidate, heard. It cannot speak about something the
   house has not already judged worth showing, and nothing here invents a reason.

   Silent, by the owner's rule, on Anzac Day: the script holds nothing for it and
   the map below does not reach it. Silent in quiet hours, to an empty room, and
   while someone is gaming. `moment` is the arbiter's lowest author, so it never
   talks over anything.
   ═══════════════════════════════════════════════════════════════════════════ */

import { isQuiet } from "./dog-schedule.js";

export const MAX_MOMENTS_A_DAY = 4;

const OCCASIONS = new Set(["newyear", "valentine", "goodfriday", "easter", "halloween", "newyeareve", "christmas", "christmas-eve"]);
const DELIGHTS = { "power-restored": "delight:power-restored", "first-rain-after-dry": "delight:first-rain" };
const HOUSEHOLD = /\b(greg|brett)\b/i;

/** The script's event for something on the wall, or null. Pure. */
export function momentEvent(candidate) {
  const id = String(candidate?.id ?? "");
  const text = String(candidate?.text ?? "");
  if (/^bin-(night|last-chance|weather):/.test(id)) return "bins:eve";
  if (/^(rain-incoming|tomorrow-rain):/.test(id)) return "weather:rain-coming";
  if (/^(bom|weather):/.test(id)) return /storm|thunder/i.test(`${id} ${text}`) ? "weather:storm" : null;
  if (!id.startsWith("delight:")) return null;

  const occasion = id.slice("delight:".length);
  if (OCCASIONS.has(occasion)) return `occasion:${occasion}`;
  if (DELIGHTS[occasion]) return DELIGHTS[occasion];
  // Only the household has lines: anyone else's birthday stays on the wall alone.
  if (occasion === "home-after-away" || occasion === "birthday-morning") {
    const name = `${candidate.caption ?? ""} ${text}`.match(HOUSEHOLD)?.[1]?.toLowerCase();
    if (!name) return null;
    return `delight:${occasion === "birthday-morning" ? "birthday" : occasion}:${name}`;
  }
  return null;
}

/** May `event` be spoken now? Pure: `tally` is the day's moments so far. */
export function mayPipeUp(event, { now, present, gaming, tally }) {
  if (!event || isQuiet(now) || !present || gaming) return false;
  return !tally.has(event) && tally.size < MAX_MOMENTS_A_DAY;
}
