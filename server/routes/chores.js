import express from "express";

import { loadChores } from "../services/choreRoster.js";

const router = express.Router();

/* The chore roster. The rules and every date live in
   ../services/choreRoster.js — this route is just the HTTP shape.

   It deliberately answers whose turn it is even when nothing is DUE. /api/bins
   is a reminder and goes quiet outside its window, which is right for a nag and
   wrong for a roster: "who's on bins?" asked on a Tuesday deserves the answer,
   not silence. The window is still reported here, so a caller that wants the
   reminder's timing has it without a second fetch. */

router.get("/api/chores", async (_req, res) => {
  const chores = await loadChores({ now: new Date() });
  res.json(chores);
});

export default router;
