// Pure calendar-occasion detection for the delight registry — Phase 10
// (docs/vision/phase-10-temperament.md). The date math (Easter + Nth-weekday for
// the AU-specific Mother's/Father's Day) is lifted verbatim from the retired
// occasionPopup so the rules are unchanged; only the full-screen confetti scene is
// gone. The occasion now rides the delight budget as a house-voiced celebration
// line on the focus-hero, once per year, instead of a 17-animation overlay.
//
// No imports, no DOM, no IO — same discipline as delight.js, so it unit-tests in
// plain node (tests/occasions.spec.js). The runtime (personalityRuntime) reads
// today's occasion into the delight ctx.
//
// NOT here (each already has its own, higher-priority delight trigger):
//   · birthdays        → birthday-morning (from the calendar, with the name)
//   · Christmas Eve     → christmas-eve
// and school holidays (a multi-week period, not a day-moment) is intentionally
// dropped — it never fit the once-a-year delight budget.

function calcEaster(year) {
  const a = year % 19;
  const b = Math.floor(year / 100), c = year % 100;
  const d = Math.floor(b / 4), e = b % 4;
  const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return { month, day };
}

function addDays(year, month, day, offset) {
  const d = new Date(year, month - 1, day);
  d.setDate(d.getDate() + offset);
  return { month: d.getMonth() + 1, day: d.getDate() };
}

function nthWeekday(year, month, nth, weekday) {
  const firstDay = new Date(year, month - 1, 1).getDay();
  const offset = (weekday - firstDay + 7) % 7;
  return 1 + offset + (nth - 1) * 7;
}

// Warm, short lines in the house register — celebrate() speaks them through
// `phrase`, and uses the title as the card caption.
const OCCASIONS = {
  newyear:        { icon: "🥂", title: "New Year",          line: "Happy New Year." },
  valentine:      { icon: "💝", title: "Valentine's Day",   line: "Happy Valentine's Day." },
  goodfriday:     { icon: "🌺", title: "Good Friday",       line: "Good Friday — the long weekend's here." },
  eastersaturday: { icon: "🥚", title: "Easter Saturday",   line: "Easter Saturday." },
  easter:         { icon: "🐣", title: "Easter",            line: "Happy Easter." },
  anzac:          { icon: "🌺", title: "ANZAC Day",         line: "ANZAC Day — lest we forget." },
  mothers:        { icon: "💐", title: "Mother's Day",      line: "Happy Mother's Day." },
  fathers:        { icon: "🏆", title: "Father's Day",      line: "Happy Father's Day." },
  halloween:      { icon: "🎃", title: "Halloween",         line: "Happy Halloween." },
  newyeareve:     { icon: "🎆", title: "New Year's Eve",    line: "Last night of the year." },
  christmas:      { icon: "🎄", title: "Christmas",         line: "Merry Christmas." }
};

/**
 * Today's fixed/moveable calendar occasion as a delight occasion object
 * ({ id, icon, title, line }), or null on an ordinary day. AU dates.
 */
export function detectOccasion(now = new Date()) {
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  const day = now.getDate();

  const easter = calcEaster(year);
  const goodFriday = addDays(year, easter.month, easter.day, -2);
  const easterSat = addDays(year, easter.month, easter.day, -1);
  const mothersDay = nthWeekday(year, 5, 2, 0);   // AU: 2nd Sunday May
  const fathersDay = nthWeekday(year, 9, 1, 0);   // AU: 1st Sunday September

  let id = null;
  if (month === 1  && day === 1)  id = "newyear";
  else if (month === 2 && day === 14) id = "valentine";
  else if (month === goodFriday.month && day === goodFriday.day) id = "goodfriday";
  else if (month === easterSat.month && day === easterSat.day) id = "eastersaturday";
  else if (month === easter.month && day === easter.day) id = "easter";
  else if (month === 4 && day === 25) id = "anzac";
  else if (month === 5 && day === mothersDay) id = "mothers";
  else if (month === 9 && day === fathersDay) id = "fathers";
  else if (month === 10 && day === 31) id = "halloween";
  else if (month === 12 && day === 31) id = "newyeareve";
  else if (month === 12 && day === 25) id = "christmas";

  return id ? { id, ...OCCASIONS[id] } : null;
}
