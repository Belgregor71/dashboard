/* ═══════════════════════════════════════════════════════════════════════════
   COMMUTE — drive times, with the addresses kept OFF the client.

   ⚠ THE HOUSE'S STREET ADDRESS USED TO BE IN THE BUNDLE. `src/js/config/config.js`
   held COMMUTE_ORIGIN and both destinations as exported constants, and that file
   is tracked in a PUBLIC repository and shipped to the browser — so the origin
   was readable in the repo, in dist/, and in the query string of every
   `/api/commute` request. The route accepted whatever origin it was handed,
   which is exactly what made the client the natural place to keep them.

   The addresses live in the server's `.env` now, and the client never learns
   them: it asks for a LEG BY NAME ("greg", "brett") and gets back a label and a
   number. That is the whole of the change and the reason for the shapes below.

   ⚠ A CLIENT-SUPPLIED `origin` IS IGNORED, DELIBERATELY AND SILENTLY. Honouring
   it "for compatibility" would leave the door open for the address to walk back
   into the bundle the first time someone wrote a caller from memory — and it
   would look like it worked. There is exactly one origin and the server owns it.
   ═══════════════════════════════════════════════════════════════════════════ */

import express from "express";
import { fetchWithTimeout } from "../utils/fetch.js";

const router = express.Router();

const TOMTOM_BASE = "https://api.tomtom.com";

// Addresses are static config values, so geocoding results are cached
// in memory for the life of the process — no need to hit the geocoder
// on every poll.
const geocodeCache = new Map();

/* The Pi's `.env` wraps some values in double quotes (the HA token does, and
   the same hand wrote these), and an address geocodes to nothing with a stray
   quote on it. Stripped here rather than in each reader. */
function envVal(name) {
  const raw = process.env[name];
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim().replace(/^"(.*)"$/s, "$1").trim();
  return trimmed || null;
}

/* The legs this house has. A leg with no destination simply does not exist,
   which is also how a fresh install with an empty .env behaves — no legs, no
   error.

   ⚠ EVERY VARIABLE NAME IS A LITERAL, and this is not style. Building them as
   `COMMUTE_${id.toUpperCase()}_DEST` made `grep COMMUTE_GREG_DEST` over the
   repo find nothing but .env.example, and tests/env-example.spec.js — which
   exists because the 2026-07-26 audit found 49 undocumented variables — could
   not see them either. An env var no scanner can find is an env var that gets
   deleted by the next person tidying up.

   ⚠ READ PER CALL, never at module load: a module-level process.env read is
   evaluated above dotenv's config() and freezes to undefined. Audit item M2
   was exactly that bug. */
function legsFromEnv() {
  return [
    {
      id: "greg",
      label: envVal("COMMUTE_GREG_LABEL") || "Greg",
      destination: envVal("COMMUTE_GREG_DEST")
    },
    {
      id: "brett",
      label: envVal("COMMUTE_BRETT_LABEL") || "Brett",
      destination: envVal("COMMUTE_BRETT_DEST")
    }
  ].filter((leg) => leg.destination);
}

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

/** One drive, origin → destination. Throws; callers decide what a failure means. */
async function driveTime(origin, destination, apiKey) {
  const [from, to] = await Promise.all([
    geocode(origin, apiKey),
    geocode(destination, apiKey)
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
  if (!summary) throw new Error("No route found");

  return {
    seconds: summary.travelTimeInSeconds,
    trafficDelaySeconds: summary.trafficDelayInSeconds ?? 0
  };
}

/**
 * Which legs exist, and what to call them — WITHOUT the addresses.
 *
 * This is what makes the client able to render "Greg" and "Brett" without ever
 * holding a street address. Listed before the parameterised route for
 * readability only; Express matches on the exact path either way.
 */
router.get("/api/commute/legs", (_req, res) => {
  res.json({ legs: legsFromEnv().map(({ id, label }) => ({ id, label })) });
});

/**
 * Every configured leg in one request.
 *
 * ⚠ A FAILED LEG IS `seconds: null`, NOT A FAILED REQUEST. One upstream hiccup
 * must not blank the other person's drive — the panel renders a row per leg and
 * the wall's readout drops the legs it has no number for. "Absent is not empty"
 * in its HTTP form.
 */
router.get("/api/commute/all", async (_req, res) => {
  const apiKey = process.env.TOMTOM_API_KEY;
  const origin = envVal("COMMUTE_ORIGIN");
  const legs = legsFromEnv();

  if (!apiKey) {
    res.status(500).json({ error: "TomTom API key missing" });
    return;
  }
  if (!origin) {
    res.status(500).json({ error: "COMMUTE_ORIGIN is not configured" });
    return;
  }

  const results = await Promise.all(legs.map(async (leg) => {
    try {
      const drive = await driveTime(origin, leg.destination, apiKey);
      return { id: leg.id, label: leg.label, ...drive };
    } catch (err) {
      console.error(`Commute leg "${leg.id}" failed:`, err instanceof Error ? err.message : err);
      return { id: leg.id, label: leg.label, seconds: null, trafficDelaySeconds: null };
    }
  }));

  res.json({ legs: results });
});

/**
 * One drive.
 *
 *   ?leg=greg          a configured leg, both ends resolved server-side
 *   ?destination=<addr> an arbitrary destination FROM HOME — the leave-by path,
 *                       where the destination is a calendar event's location and
 *                       only the origin is private
 *
 * `origin` is accepted in neither form. See the header.
 */
router.get("/api/commute", async (req, res) => {
  const apiKey = process.env.TOMTOM_API_KEY;
  const origin = envVal("COMMUTE_ORIGIN");

  if (!apiKey) {
    res.status(500).json({ error: "TomTom API key missing" });
    return;
  }
  if (!origin) {
    res.status(500).json({ error: "COMMUTE_ORIGIN is not configured" });
    return;
  }

  const legId = typeof req.query.leg === "string" ? req.query.leg : null;
  const leg = legId ? legsFromEnv().find((l) => l.id === legId) : null;
  const destination = leg ? leg.destination
    : (typeof req.query.destination === "string" ? req.query.destination.trim() : "");

  if (legId && !leg) {
    res.status(404).json({ error: `Unknown commute leg "${legId}"` });
    return;
  }
  if (!destination) {
    res.status(400).json({ error: "leg or destination is required" });
    return;
  }

  try {
    const drive = await driveTime(origin, destination, apiKey);
    res.json(leg ? { id: leg.id, label: leg.label, ...drive } : drive);
  } catch (err) {
    console.error("Commute proxy error:", err);
    res.status(500).json({ error: "Commute error" });
  }
});

export default router;
