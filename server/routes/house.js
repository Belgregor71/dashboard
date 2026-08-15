import express from "express";
import { loopbackOnly } from "../middleware/security.js";
import { openItems, resolvedItems, resolve, forget } from "../services/unresolved.js";

/* What the house is currently wondering about (services/unresolved.js).
 *
 * Separate from the vault routes because this is not the household's writing —
 * it is the house's own observations about its devices, and it exists whether
 * or not VAULT_ENABLED is set. Mounting it under the vault router would have
 * tied "can the house wonder about things" to "is the knowledge base on",
 * which are unrelated questions.
 *
 * Loopback-gated: it names cameras and times, and the only legitimate caller is
 * the kiosk. The same asymmetry the vault and cost routes trade on.
 */
const router = express.Router();

router.get("/api/house/unresolved", loopbackOnly("The unresolved list"), (_req, res) => {
  try {
    res.json({ open: openItems(), resolved: resolvedItems() });
  } catch (err) {
    console.error("[house] listing unresolved failed:", err.message);
    res.status(500).json({ error: "could not list" });
  }
});

/* Telling the house the answer. This is the half that makes it a conversation
   rather than a log: "the kitchen camera was unplugged" turns an open question
   into a resolved one with a reason the house can repeat back later. */
router.post("/api/house/unresolved/:key/resolve", loopbackOnly("Resolving"), (req, res) => {
  try {
    const resolution = typeof req.body?.resolution === "string" ? req.body.resolution : "";
    res.json({ resolved: resolve(req.params.key, resolution) });
  } catch (err) {
    console.error("[house] resolving failed:", err.message);
    res.status(500).json({ error: "could not resolve" });
  }
});

// Deleting is not resolving. Resolve keeps the story ("that cleared up");
// forget removes it entirely, for something that should never have been
// recorded at all.
router.delete("/api/house/unresolved/:key", loopbackOnly("Forgetting"), (req, res) => {
  try {
    res.json({ forgotten: forget(req.params.key) });
  } catch (err) {
    console.error("[house] forgetting failed:", err.message);
    res.status(500).json({ error: "could not forget" });
  }
});

export default router;
