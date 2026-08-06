import express from "express";

import { binWindow, binsConfigured, loadCollections } from "../services/binSchedule.js";

const router = express.Router();

// Bin reminder. The schedule and the window rule both live in
// ../services/binSchedule.js — this route is just the HTTP shape.
//
// The window deliberately went from "day before at 5pm, then all of collection
// day" to "day before from midday, then a last chance until 7am". The rubbish
// truck comes early, so the old all-day reminder spent collection day asking for
// something that was no longer possible.

router.get("/api/bins", async (_req, res) => {
  if (!binsConfigured()) {
    return res.json({ configured: false });
  }

  const now = new Date();
  const { collections, source } = await loadCollections({ now });
  const window = binWindow(collections, now);

  if (!window.due) {
    return res.json({ configured: true, due: false, source });
  }

  const bins = window.collection.bins.map((bin) => bin.colour);
  const words = window.collection.bins.map((bin) => bin.word);

  res.json({
    configured: true,
    due: true,
    eve: window.eve,
    lastChance: window.lastChance,
    bins,
    words,
    label: window.eve ? "Bins out tonight" : "Last chance — truck's due",
    source
  });
});

export default router;
