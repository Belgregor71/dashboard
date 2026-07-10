import express from "express";
import fetch from "node-fetch";

const router = express.Router();

async function fetchQueue(name, baseUrl, apiKey) {
  // A service with no URL/key isn't configured on this host — that's "no
  // downloads", not a server error. Returning empty keeps /arr/summary a clean
  // 200 instead of a 500 the kiosk re-hits every 10s.
  if (!baseUrl || !apiKey) return [];

  const url = new URL("/api/v3/queue", baseUrl);
  url.searchParams.set("page", "1");
  url.searchParams.set("pageSize", "20");
  url.searchParams.set("sortKey", "timeleft");
  url.searchParams.set("sortDirection", "ascending");

  const response = await fetch(url.toString(), {
    headers: { "X-Api-Key": apiKey }
  });

  if (!response.ok) {
    throw new Error(`${name} queue failed (${response.status}): ${await response.text()}`);
  }

  const data = await response.json();
  const records = Array.isArray(data?.records) ? data.records : [];

  return records
    .filter((item) => item?.status === "downloading")
    .map((item) => ({
      title: item?.title || "Unknown title",
      progress: Number(item?.percentOfCompletion) || 0,
      sizeLeft: Number(item?.sizeleft) || 0,
      timeLeft: item?.timeleft || null,
      status: item?.status || "unknown"
    }));
}

router.get("/arr/summary", async (_req, res) => {
  try {
    const [sonarr, radarr, lidarr] = await Promise.all([
      fetchQueue("Sonarr", process.env.SONARR_URL, process.env.SONARR_API_KEY),
      fetchQueue("Radarr", process.env.RADARR_URL, process.env.RADARR_API_KEY),
      fetchQueue("Lidarr", process.env.LIDARR_URL, process.env.LIDARR_API_KEY)
    ]);

    res.json({
      sonarr,
      radarr,
      lidarr,
      active: sonarr.length > 0 || radarr.length > 0 || lidarr.length > 0
    });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

export default router;
