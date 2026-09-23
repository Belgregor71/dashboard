import express from "express";
import { subscribe, snapshot, storeStatus } from "../services/houseStore.js";

/* The observation store's two faces (HOUSE-MIND S2, services/houseStore.js).
 *
 * NOT loopback-gated, unlike its /api/house/* neighbours in house.js. Those name
 * cameras and times from the house's own ledger; this carries exactly what
 * /api/weather/now, /api/calendar/all and the rest already serve to the same
 * browser, so gating it would be stricter than the data it relays and would
 * only strand a LAN viewer on the fallback fetch.
 *
 * The SSE shape follows /api/ha/stream (server/ha/haRoutes.js): headers, flush,
 * the held state first, then deltas, a 20 s comment heartbeat, and symmetric
 * teardown on close. */
const router = express.Router();

function toSse(event, data) {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

router.get("/api/house/stream", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();

  // Whatever is already held goes first, so a reconnecting page is whole at
  // once rather than filling in over the next five minutes.
  res.write(toSse("house_snapshot", snapshot()));

  const unsubscribe = subscribe((key, entry) => {
    res.write(toSse("house_obs", { key, value: entry.value, at: entry.at }));
  });

  const heartbeat = setInterval(() => {
    res.write(": ping\n\n");
  }, 20_000);

  req.on("close", () => {
    clearInterval(heartbeat);
    unsubscribe();
  });
});

/* What the store holds and how often each source was really read: the number
   that proves "once, not six times" on the live box. No values, only counts. */
router.get("/api/house/store", (_req, res) => {
  res.json(storeStatus());
});

export default router;
