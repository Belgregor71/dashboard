import express from "express";
import { fetchWithTimeout } from "../utils/fetch.js";

const router = express.Router();

const TOMTOM_BASE = "https://api.tomtom.com";

// Addresses are static config values, so geocoding results are cached
// in memory for the life of the process — no need to hit the geocoder
// on every poll.
const geocodeCache = new Map();

async function geocode(address, apiKey) {
  if (geocodeCache.has(address)) return geocodeCache.get(address);

  const url = new URL(`${TOMTOM_BASE}/search/2/geocode/${encodeURIComponent(address)}.json`);
  url.searchParams.set("key", apiKey);
  url.searchParams.set("limit", "1");

  const r = await fetchWithTimeout(url.toString());
  if (!r.ok) throw new Error(`Geocode HTTP ${r.status}`);
  const data = await r.json();
  const pos = data?.results?.[0]?.position;
  if (!pos) throw new Error(`Geocode failed for "${address}"`);

  const coords = { lat: pos.lat, lon: pos.lon };
  geocodeCache.set(address, coords);
  return coords;
}

router.get("/api/commute", async (req, res) => {
  const { origin, destination } = req.query;
  const apiKey = process.env.TOMTOM_API_KEY;

  if (!apiKey) {
    res.status(500).json({ error: "TomTom API key missing" });
    return;
  }
  if (!origin || !destination) {
    res.status(400).json({ error: "origin and destination are required" });
    return;
  }

  try {
    const [from, to] = await Promise.all([
      geocode(origin, apiKey),
      geocode(destination, apiKey),
    ]);

    const url = new URL(
      `${TOMTOM_BASE}/routing/1/calculateRoute/${from.lat},${from.lon}:${to.lat},${to.lon}/json`
    );
    url.searchParams.set("key", apiKey);
    url.searchParams.set("traffic", "true");
    url.searchParams.set("travelMode", "car");

    const r = await fetchWithTimeout(url.toString());
    if (!r.ok) throw new Error(`Routing HTTP ${r.status}`);
    const data = await r.json();

    const summary = data?.routes?.[0]?.summary;
    if (!summary) {
      res.status(502).json({ error: "No route found" });
      return;
    }

    res.json({
      seconds: summary.travelTimeInSeconds,
      trafficDelaySeconds: summary.trafficDelayInSeconds ?? 0,
    });
  } catch (err) {
    console.error("Commute proxy error:", err);
    res.status(500).json({ error: "Commute error" });
  }
});

export default router;
