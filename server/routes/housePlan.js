import express from "express";
import { readFile } from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

import { loopbackOnly } from "../middleware/security.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/* The illustrated plan of the house and where its cameras sit
   (src/v3/subjects/camera-plan.js, features.v3CameraPlan).

   ⚠ PRIVATE ON PURPOSE, TWICE. This repo is public and the street address is in
   its history, so a floor plan with the cameras' coverage drawn on it lives only
   in the gitignored data/house-plan/, and only the kiosk may read it: any device
   on the LAN can reach every other route. No files on a box: both routes 404 and
   the wall shows its cameras as it always has. */
const DIR = path.join(__dirname, "..", "..", "data", "house-plan");
const kioskOnly = loopbackOnly("The house plan");

const router = express.Router();

router.get("/api/house-plan", kioskOnly, async (_req, res) => {
  try {
    res.json(JSON.parse(await readFile(path.join(DIR, "cameras.json"), "utf8")));
  } catch {
    res.status(404).json({ error: "No house plan on this box" });
  }
});

router.get("/api/house-plan/image", kioskOnly, (_req, res) => {
  res.sendFile(path.join(DIR, "plan.webp"), { maxAge: "1d" }, (err) => {
    if (err && !res.headersSent) res.status(404).json({ error: "No house plan on this box" });
  });
});

export default router;
