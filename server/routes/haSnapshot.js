import express from "express";
import { compileSchema } from "../middleware/validate.js";
import { haSnapshotSchema } from "../schemas/ha.js";
import { getHaSnapshot } from "../services/haService.js";
import { normalizeBaseUrl } from "../config.js";

const router = express.Router();
const validateHaSnapshot = compileSchema(haSnapshotSchema);

router.get("/api/ha/snapshot", async (_req, res) => {
  const haTarget = normalizeBaseUrl(process.env.HA_HOST);
  const token = process.env.HA_TOKEN;

  if (!haTarget || !token) {
    res.status(502).json({
      ok: false,
      error: { code: "HA_UNAVAILABLE", message: "Home Assistant unavailable" }
    });
    return;
  }

  try {
    const snapshot = await getHaSnapshot({
      haHost: haTarget,
      token,
      validateSnapshot: validateHaSnapshot
    });
    res.json(snapshot);
  } catch (error) {
    console.error("HA snapshot upstream error:", error?.message || error);
    res.status(502).json({
      ok: false,
      error: { code: "HA_UNAVAILABLE", message: "Home Assistant unavailable" }
    });
  }
});

export default router;
