import express from "express";

import { loopbackOnly } from "../middleware/security.js";
import { robotTrack } from "../services/robotTrack.js";

/* Where the robot vacuum is and has been (server/services/robotTrack.js).
   Kiosk only, like the house plan it is drawn on: a path through the rooms is a
   floor plan by another name. */
const router = express.Router();

router.get("/api/robot/track", loopbackOnly("The robot's track"), (_req, res) => {
  const track = robotTrack();
  if (!track) return res.status(404).json({ error: "No robot on this box" });
  res.set("Cache-Control", "no-store");
  res.json(track);
});

export default router;
