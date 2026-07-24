// Pure calendar-occasion detection for the delight registry — Phase 10
// (docs/vision/phase-10-temperament.md). The Easter date math is lifted verbatim
// from the retired occasionPopup so the rules are unchanged; only the full-screen
// confetti scene is gone. The occasion now rides the delight budget as a
// house-voiced celebration line on the focus-hero, once per year, instead of a
// 17-animation overlay.
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

// Big, gossipy lines in the house register (docs/design/VOICE.md) — every
// occasion gets a full moment now, not one careful beat. The ONE exception is
// ANZAC Day: solemn days get none of this and stay plain (rule 8).
// celebrate() speaks them through `phrase`, and uses the title as the caption.
const OCCASIONS = {
  newyear:        { icon: "🥂", title: "New Year",          lines: ["Happy New Year! Clean slate, gorgeous — try not to wreck it by February.", "Happy New Year! New year, same fabulous you."] },
  valentine:      { icon: "💝", title: "Valentine's Day",   lines: ["Happy Valentine's! Somebody say something nice before the day gets away.", "Valentine's Day. Go on — you know what to do."] },
  goodfriday:     { icon: "🌺", title: "Good Friday",       lines: ["Good Friday! Four days off and I am thrilled about it.", "Good Friday's here — the long weekend, and doesn't it know it."] },
  easter:         { icon: "🐣", title: "Easter",            lines: ["Happy Easter! The eggs won't hide themselves, and frankly neither will I.", "Happy Easter — hope the Bunny remembered the good hiding spots."] },
  anzac:          { icon: "🌺", title: "ANZAC Day",         lines: ["ANZAC Day — lest we forget."] },
  halloween:      { icon: "🎃", title: "Halloween",         lines: ["Halloween tonight! Small visitors incoming — the lolly bowl's about to earn its keep.", "Halloween tonight! Someone's a ghost, someone's a tradie, and honestly it's a toss-up."] },
  newyeareve:     { icon: "🎆", title: "New Year's Eve",    lines: ["Last night of the year! Make it count, or at least make it loud.", "New Year's Eve — see it out in style, or in trackies, no judgement."] },
  christmas:      { icon: "🎄", title: "Christmas",         lines: ["Merry Christmas! The good glass is out and I'm not apologising for it.", "Merry Christmas, gorgeous — try to look surprised."] }
};

// Rotate a line pool without randomness: a stable per-day index keeps the module
// pure/testable and gives a different phrasing across the years it recurs.
function pickLine(lines, now) {
  return lines[Math.floor(now.getTime() / 86400000) % lines.length];
}

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

  let id = null;
  if (month === 1  && day === 1)  id = "newyear";
  else if (month === 2 && day === 14) id = "valentine";
  else if (month === goodFriday.month && day === goodFriday.day) id = "goodfriday";
  else if (month === easter.month && day === easter.day) id = "easter";
  else if (month === 4 && day === 25) id = "anzac";
  else if (month === 10 && day === 31) id = "halloween";
  else if (month === 12 && day === 31) id = "newyeareve";
  else if (month === 12 && day === 25) id = "christmas";

  if (!id) return null;
  const occ = OCCASIONS[id];
  return { id, icon: occ.icon, title: occ.title, line: pickLine(occ.lines, now) };
}
