import express from "express";

const router = express.Router();

// Accept day as number (0–6) or full name ("Sunday" … "Saturday")
function parseDayNumber(value) {
  if (value === undefined || value === null || value === "") return null;
  const names = ["sunday","monday","tuesday","wednesday","thursday","friday","saturday"];
  const lower = String(value).toLowerCase().trim();
  const byName = names.indexOf(lower);
  if (byName >= 0) return byName;
  const n = parseInt(lower, 10);
  return n >= 0 && n <= 6 ? n : null;
}

// Given the actual collection date and a reference date when yellow was collected,
// return which bins go out.  Weeks since reference:
//   even (0, 2, 4 …) → yellow  (same cycle as reference)
//   odd  (1, 3, 5 …) → green
function calcBins(collectionDate, yellowRef) {
  const bins = ["red"];
  if (!yellowRef) return bins;

  const ref = new Date(yellowRef);
  ref.setHours(0, 0, 0, 0);
  const target = new Date(collectionDate);
  target.setHours(0, 0, 0, 0);

  const MS_PER_WEEK = 7 * 24 * 60 * 60 * 1000;
  const weeksDiff = Math.round((target - ref) / MS_PER_WEEK);
  bins.push(weeksDiff % 2 === 0 ? "yellow" : "green");
  return bins;
}

router.get("/api/bins", (req, res) => {
  const collectionDayNum = parseDayNumber(process.env.BIN_COLLECTION_DAY);
  if (collectionDayNum === null) {
    return res.json({ configured: false });
  }

  const yellowRef   = process.env.BIN_YELLOW_REFERENCE ?? null;
  const now         = new Date();
  const todayDay    = now.getDay();
  const isDay       = todayDay === collectionDayNum;
  const isEve       = (todayDay + 1) % 7 === collectionDayNum;

  // Show eve reminder from 5 pm onward; show day-of reminder all day
  const showEve = isEve && now.getHours() >= 17;
  const showDay = isDay;

  if (!showEve && !showDay) {
    return res.json({ configured: true, due: false });
  }

  // The collection we're reminding about
  const collectionDate = new Date(now);
  if (isEve) collectionDate.setDate(collectionDate.getDate() + 1);

  const bins  = calcBins(collectionDate, yellowRef);
  const label = showEve ? "Bins out tonight" : "Bins out this morning";

  res.json({ configured: true, due: true, eve: showEve, bins, label });
});

export default router;
