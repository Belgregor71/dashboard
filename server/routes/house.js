import express from "express";
import { loopbackOnly } from "../middleware/security.js";
import {
  openItems, resolvedItems, resolve, forget, ambientResolutions, markAired
} from "../services/unresolved.js";
import { buildHouseClaims, MIN_DAYS } from "../services/houseLately.js";
import { occupancyDays, houseDay } from "../services/occupancyDays.js";
import { readFeatureCensus } from "./censusFeatures.js";
import { readDepthCensus } from "./census.js";

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

/* ── The ambient half: what the wall may SAY, and saying it once ────────────
 *
 * Resolutions only. `unresolved.js`'s header carries the argument for the
 * asymmetry; what matters at this layer is that these are TWO routes rather
 * than one GET with a side effect, and that split is deliberate.
 *
 * ⚠ A GET THAT BURNS WHAT IT RETURNS WOULD MAKE THE FEATURE UNDEBUGGABLE. The
 * whole point of a one-shot line is that it is said once, so a curl checking
 * "is there anything to say?" would consume the only copy and the wall would
 * then show nothing — a feature that breaks precisely when someone looks at
 * it, silently, and looks like a bug in the client. Keeping the read pure
 * means the read is repeatable and the airing means what it says: the wall
 * took it, not somebody asked.
 *
 * Loopback-gated for the same reason the list above it is — it names cameras.
 */
router.get("/api/house/resolutions", loopbackOnly("The resolutions feed"), (_req, res) => {
  try {
    res.json({ resolutions: ambientResolutions() });
  } catch (err) {
    console.error("[house] listing resolutions failed:", err.message);
    /* An empty list, not a 502. The wall polls this every minute for weeks and
       a store it cannot read is the house having nothing to say — which is
       already the answer on almost every one of those polls. */
    res.json({ resolutions: [] });
  }
});

router.post("/api/house/resolutions/aired", loopbackOnly("Airing"), (req, res) => {
  try {
    const keys = Array.isArray(req.body?.keys) ? req.body.keys : [];
    res.json({ aired: markAired(keys) });
  } catch (err) {
    console.error("[house] airing failed:", err.message);
    res.status(500).json({ error: "could not air" });
  }
});

/* WHAT THE HOUSE HAS BEEN LIKE LATELY — docs/AUGUST-IMPROVEMENTS.md §4.6.
 *
 * The sibling of /api/weather/lately, and the same philosophy in both
 * directions: the verdict is computed ON GET rather than stored, so one curl
 * answers the question and there is no second thing to keep in step; and an
 * unreadable record degrades to an empty answer rather than a 502, because a
 * house with nothing to say is not a broken server.
 *
 * ⛔ LOOPBACK-GATED, and for a stronger reason than the unresolved list above.
 * That one names cameras; this one names residents and counts what they asked.
 * unresolved.js:36-45 draws the line — the house may speak about what it
 * witnessed, and answers questions about the people only when asked.
 */
router.get("/api/house/lately", loopbackOnly("The house record"), async (_req, res) => {
  const today = houseDay();
  try {
    /* The route does the IO and buildHouseClaims stays pure — the split
       services/lately.js established, so the claim builder can be tested
       against a fixture without a disk or a clock. */
    const [features, depth, occupancy] = await Promise.all([
      readFeatureCensus(),
      readDepthCensus(),
      occupancyDays()
    ]);
    res.json({
      minDays: MIN_DAYS,
      claims: buildHouseClaims({ features, depth, occupancy }, { today })
    });
  } catch (err) {
    console.error("[house] lately read failed:", err.message);
    res.json({ minDays: MIN_DAYS, claims: buildHouseClaims({}, { today }) });
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
