import express from "express";
import { fetchWithTimeout } from "../utils/fetch.js";

const router = express.Router();

const DEFAULT_ABC_RSS = "https://www.abc.net.au/news/feed/51120/rss.xml";

function parseHeadlines(xml) {
  const headlines = [];
  const items = xml.match(/<item[\s\S]*?<\/item>/gi) || [];
  for (const item of items) {
    const cdata = item.match(/<title><!\[CDATA\[([\s\S]*?)\]\]><\/title>/i);
    const plain = item.match(/<title>([\s\S]*?)<\/title>/i);
    const title = ((cdata?.[1] ?? plain?.[1]) || "").replace(/&amp;/g, "&").trim();
    if (title) headlines.push(title);
  }
  return headlines;
}

router.get("/api/news", async (_req, res) => {
  const rssUrl = process.env.NEWS_RSS_URL || DEFAULT_ABC_RSS;
  const source = process.env.NEWS_SOURCE || "NEWS";
  try {
    const response = await fetchWithTimeout(rssUrl, {
      headers: { "User-Agent": "FamilyDashboard/1.0" }
    });
    if (!response.ok) {
      res.status(502).json({ error: `RSS fetch failed: HTTP ${response.status}` });
      return;
    }
    const xml = await response.text();
    res.json({ headlines: parseHeadlines(xml), source });
  } catch (err) {
    res.status(500).json({ error: "News unavailable", detail: err instanceof Error ? err.message : String(err) });
  }
});

export default router;
