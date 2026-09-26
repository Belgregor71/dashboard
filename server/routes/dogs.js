import express from "express";

const router = express.Router();

/* Birthdays for Benji and Teddy's popups (src/v3/core/dog-schedule.js).

   The dates live ONLY in the box's .env, never in the repo — config.js is
   tracked and bundled into a public repo, and these are people's birthdays:

     DOG_BIRTHDAYS="Benji 20/5, Teddy 20/5, Greg 2/12, Brett 16/5"

   Day/month, no year. A name that is one of the dogs marks that dog's own
   birthday (he pops up alone, in his birthday outfits); any other name is a
   family birthday (either dog, or both). NAMES NEVER LEAVE THE SERVER: the
   answer carries a date, which dogs it belongs to, and whether a person has a
   birthday that day — nothing a screenshot of the network tab could turn into
   a list of who lives here. Unset is an empty list, not an error. */

export const DOG_IDS = ["benji", "teddy"];

export function parseBirthdays(raw = "") {
  const byDate = new Map();
  const bad = [];
  for (const part of String(raw).split(/[,;]/)) {
    const entry = part.trim();
    if (!entry) continue;
    const m = entry.match(/^(.+?)\s+(\d{1,2})\/(\d{1,2})$/);
    const day = m && Number(m[2]);
    const month = m && Number(m[3]);
    // 29/2 is allowed; its day simply only comes round in a leap year.
    const valid = m && month >= 1 && month <= 12 && day >= 1
      && day <= new Date(Date.UTC(2024, month, 0)).getUTCDate();
    if (!valid) { bad.push(entry); continue; }
    const key = `${month}/${day}`;
    const slot = byDate.get(key) ?? { month, day, dogs: [], family: false };
    const id = m[1].trim().toLowerCase();
    if (DOG_IDS.includes(id)) {
      if (!slot.dogs.includes(id)) slot.dogs.push(id);
    } else {
      slot.family = true;
    }
    byDate.set(key, slot);
  }
  const days = [...byDate.values()].sort((a, b) => a.month - b.month || a.day - b.day);
  return { days, bad: bad.length };
}

let warned = false;

router.get("/api/dogs/birthdays", (_req, res) => {
  const { days, bad } = parseBirthdays(process.env.DOG_BIRTHDAYS);
  if (bad && !warned) {
    warned = true;
    // The count only — an unparseable entry may still hold a name.
    console.warn(`[dogs] DOG_BIRTHDAYS: ${bad} entr${bad === 1 ? "y" : "ies"} not "Name D/M" — skipped`);
  }
  res.json({ days });
});

export default router;
