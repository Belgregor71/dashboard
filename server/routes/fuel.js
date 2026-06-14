import express from "express";

const router = express.Router();

// QLD Fuel Prices — fuelpricesqld.com.au (FPDAPI)
// Register at https://www.fuelpricesqld.com.au to obtain a SubscriberToken.
// Set FUEL_API_KEY in .env. Location is read from WEATHER_LAT / WEATHER_LON.

const BASE     = "https://fppdirectapi-prod.fuelpricesqld.com.au";
const CACHE_MS = 2 * 60 * 60 * 1000; // 2 hours — prices don't change often

let cache   = null;
let cacheAt = 0;

function normalisePrice(raw) {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return null;
  // API returns tenths-of-cents (e.g. 1899 → 189.9 c/L)
  return n > 999 ? +(n / 10).toFixed(1) : +n.toFixed(1);
}

async function queryFuelPrices() {
  const key    = process.env.FUEL_API_KEY ?? "";
  const lat    = process.env.WEATHER_LAT ?? process.env.LAT ?? "";
  const lon    = process.env.WEATHER_LON ?? process.env.LON ?? "";
  const radius = process.env.FUEL_RADIUS_KM ?? "5";
  const types  = (process.env.FUEL_TYPES ?? "E10,U91").split(",").map(t => t.trim()).filter(Boolean);

  const results = await Promise.allSettled(
    types.map(type =>
      fetch(
        `${BASE}/Prices/GetSitesByRadius?Latitude=${lat}&Longitude=${lon}&Radius=${radius}&FuelTypeCode=${type}`,
        {
          headers: { Authorization: `FPDAPI SubscriberToken=${key}` },
          signal:  AbortSignal.timeout(10_000),
        }
      ).then(r => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
    )
  );

  const sites = [];
  results.forEach((r, i) => {
    if (r.status !== "fulfilled" || !Array.isArray(r.value?.S)) return;
    const type   = types[i];
    const sorted = [...r.value.S].sort((a, b) => Number(a.P) - Number(b.P));
    const best   = sorted[0];
    if (!best) return;
    const price = normalisePrice(best.P);
    if (price == null) return;
    sites.push({
      type,
      price,
      name:    (best.N ?? "").substring(0, 24).trim() || (best.A ?? "").substring(0, 24).trim(),
      address: (best.A ?? "").trim(),
    });
  });

  return { sites, updated: new Date().toISOString() };
}

router.get("/api/fuel", async (_req, res) => {
  if (!process.env.FUEL_API_KEY) {
    return res.json({ sites: [], configured: false });
  }

  const now = Date.now();
  if (cache && now - cacheAt < CACHE_MS) return res.json(cache);

  try {
    cache   = await queryFuelPrices();
    cacheAt = now;
    res.json(cache);
  } catch (err) {
    console.error("[fuel]", err.message);
    if (cache) return res.json(cache);
    res.status(502).json({ sites: [], error: err.message });
  }
});

export default router;
