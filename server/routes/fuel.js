import express from "express";

const router = express.Router();

const BASE         = "https://fppdirectapi-prod.fuelpricesqld.com.au";
const CACHE_MS     = 2 * 60 * 60 * 1000;
const COUNTRY_ID   = 21;
const REGION_LEVEL = 2;
const REGION_ID    = 1; // Brisbane
const FUEL_ID      = 2; // Unleaded (ULP)
const TOP_N        = 3;

let cache   = null;
let cacheAt = 0;

function haversineKm(lat1, lon1, lat2, lon2) {
  const R    = 6371;
  const dLat = (lat2 - lat1) * (Math.PI / 180);
  const dLon = (lon2 - lon1) * (Math.PI / 180);
  const a    = Math.sin(dLat / 2) ** 2
             + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180)
             * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

async function queryFuelPrices() {
  const key      = process.env.FUEL_API_KEY ?? "";
  const lat      = parseFloat(process.env.WEATHER_LAT ?? process.env.LAT ?? "-27.3691");
  const lon      = parseFloat(process.env.WEATHER_LON ?? process.env.LON ?? "153.0847");
  const radiusKm = parseFloat(process.env.FUEL_RADIUS_KM ?? "10");

  const headers = {
    Authorization:  `FPDAPI SubscriberToken=${key}`,
    "Content-Type": "application/json",
  };
  const qs = `countryId=${COUNTRY_ID}&geoRegionLevel=${REGION_LEVEL}&geoRegionId=${REGION_ID}`;

  const [priceRes, siteRes] = await Promise.all([
    fetch(`${BASE}/Price/GetSitesPrices?${qs}`,           { headers, signal: AbortSignal.timeout(15_000) }),
    fetch(`${BASE}/Subscriber/GetFullSiteDetails?${qs}`,  { headers, signal: AbortSignal.timeout(15_000) }),
  ]);

  if (!priceRes.ok) throw new Error(`Prices HTTP ${priceRes.status}`);
  if (!siteRes.ok)  throw new Error(`Sites HTTP ${siteRes.status}`);

  const [{ SitePrices = [] }, { S: siteList = [] }] = await Promise.all([
    priceRes.json(),
    siteRes.json(),
  ]);

  const siteMap = new Map(siteList.map(s => [s.S, s]));

  // Sort cheapest first, then walk until we have TOP_N within radius
  const ulpPrices = SitePrices
    .filter(p => p.FuelId === FUEL_ID)
    .sort((a, b) => a.Price - b.Price);

  const results = [];
  for (const p of ulpPrices) {
    if (results.length >= TOP_N) break;
    const site = siteMap.get(p.SiteId);
    if (!site?.Lat || !site?.Lng) continue;
    const dist = haversineKm(lat, lon, site.Lat, site.Lng);
    if (dist > radiusKm) continue;
    results.push({
      price:      +(p.Price / 10).toFixed(1),
      name:       (site.N ?? "").trim(),
      address:    (site.A ?? "").trim(),
      distanceKm: +dist.toFixed(1),
    });
  }

  return { sites: results, updated: new Date().toISOString() };
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
