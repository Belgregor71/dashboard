import express from "express";
import { fetchWithTimeout } from "../utils/fetch.js";

const router = express.Router();

router.get("/api/commute", async (req, res) => {
  const { origin, destination } = req.query;
  const googleMapsApiKey = process.env.GOOGLE_MAPS_API_KEY;

  if (!googleMapsApiKey) {
    res.status(500).json({ error: "Google Maps API key missing" });
    return;
  }
  if (!origin || !destination) {
    res.status(400).json({ error: "origin and destination are required" });
    return;
  }

  const url = new URL("https://maps.googleapis.com/maps/api/distancematrix/json");
  url.searchParams.set("origins", origin);
  url.searchParams.set("destinations", destination);
  url.searchParams.set("departure_time", "now");
  url.searchParams.set("traffic_model", "best_guess");
  url.searchParams.set("key", googleMapsApiKey);

  try {
    const r = await fetchWithTimeout(url.toString());
    res.json(await r.json());
  } catch (err) {
    console.error("Commute proxy error:", err);
    res.status(500).json({ error: "Commute error" });
  }
});

router.get("/api/commute_map", async (req, res) => {
  const { origin, destination } = req.query;
  const googleMapsApiKey = process.env.GOOGLE_MAPS_API_KEY;

  if (!googleMapsApiKey) {
    res.status(500).json({ error: "Google Maps API key missing" });
    return;
  }
  if (!origin || !destination) {
    res.status(400).json({ error: "origin and destination are required" });
    return;
  }

  const url = new URL("https://maps.googleapis.com/maps/api/staticmap");
  url.searchParams.set("size", "600x300");
  url.searchParams.set("scale", "2");
  url.searchParams.set("maptype", "roadmap");
  url.searchParams.append("markers", `color:green|label:S|${origin}`);
  url.searchParams.append("markers", `color:red|label:D|${destination}`);
  url.searchParams.append("path", `color:0x1a73e8|weight:5|${origin}|${destination}`);
  url.searchParams.set("key", googleMapsApiKey);

  try {
    const r = await fetchWithTimeout(url.toString());
    const buffer = await r.arrayBuffer();
    const contentType = r.headers.get("content-type") || "image/png";
    res.type(contentType).send(Buffer.from(buffer));
  } catch (err) {
    console.error("Commute map proxy error:", err);
    res.status(500).json({ error: "Commute map error" });
  }
});

export default router;
