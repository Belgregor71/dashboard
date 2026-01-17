console.log(">>> DASHBOARD SERVER LOADED <<<");

import dotenv from "dotenv";
import express from "express";
import https from "https";
import path from "path";
import { fileURLToPath } from "url";
import fetch from "node-fetch";
import serveIndex from "serve-index";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

/* ============================================================================
   STATIC FILES
============================================================================ */

app.use(express.static(path.join(__dirname, "static")));
app.use("/photos", serveIndex(path.join(__dirname, "static", "photos"), { icons: true }));
app.use("/photos", express.static(path.join(__dirname, "static", "photos")));
app.use("/icons", express.static(path.join(__dirname, "static", "icons")));

/* ============================================================================
   ROOT → index.html
============================================================================ */

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "static", "index.html"));
});

/* ============================================================================
   CALENDAR PROXY — MERGED FEED (STRICT MATCH)
============================================================================ */

app.get("/api/calendar/all", async (req, res) => {
  try {
    const CAL_SVC = process.env.CALENDAR_SERVICE_URL || "http://localhost:5000";
    const r = await fetch(`${CAL_SVC}/calendar/all`);
    const data = await r.json();
    res.json(data);
  } catch (err) {
    console.error("Calendar ALL proxy error:", err);
    res.status(500).json({ error: "Calendar all error" });
  }
});

/* ============================================================================
   CALENDAR PROXY — INDIVIDUAL SOURCES (REGEX-PROTECTED)
============================================================================ */

const CALENDAR_ENDPOINTS = {
  google: "http://localhost:5000/calendar/google",
  apple: "http://localhost:5000/calendar/apple",
  tripit: "http://localhost:5000/calendar/tripit"
};

// IMPORTANT: prevent ":source" from matching "all"
app.get("/api/calendar/:source(google|apple|tripit)", async (req, res) => {
  const src = req.params.source;
  const url = CALENDAR_ENDPOINTS[src];

  try {
    const r = await fetch(url);
    const data = await r.json();
    res.json(data);
  } catch (err) {
    console.error("Calendar proxy error:", err);
    res.status(500).json({ error: "Calendar error" });
  }
});

/* ============================================================================
   COMMUTE PROXY
============================================================================ */

app.get("/api/commute", async (req, res) => {
  const origin = req.query.origin;
  const destination = req.query.destination;

  const url =
    `http://localhost:5000/commute?origin=${encodeURIComponent(origin)}` +
    `&destination=${encodeURIComponent(destination)}`;

  try {
    const r = await fetch(url);
    const data = await r.json();
    res.json(data);
  } catch (err) {
    console.error("Commute proxy error:", err);
    res.status(500).json({ error: "Commute error" });
  }
});

app.get("/api/commute_map", async (req, res) => {
  const origin = req.query.origin;
  const destination = req.query.destination;

  const url =
    `http://localhost:5000/commute_map?origin=${encodeURIComponent(origin)}` +
    `&destination=${encodeURIComponent(destination)}`;

  try {
    const r = await fetch(url);
    const buffer = await r.arrayBuffer();
    res.type("image/png").send(Buffer.from(buffer));
  } catch (err) {
    console.error("Commute map proxy error:", err);
    res.status(500).json({ error: "Commute map error" });
  }
});

/* ============================================================================
   PLEX SESSIONS PROXY
============================================================================ */

function normalizePlexBaseUrl(baseUrl) {
  if (!baseUrl) return baseUrl;
  if (/^https?:\/\//i.test(baseUrl)) return baseUrl;
  return `http://${baseUrl}`;
}

function getPlexAgent(baseUrl) {
  const allowInsecure = process.env.PLEX_ALLOW_INSECURE === "true";
  if (!allowInsecure) return undefined;
  if (!baseUrl?.startsWith("https://")) return undefined;
  return new https.Agent({ rejectUnauthorized: false });
}

function buildPlexUrl(baseUrl, pathValue) {
  if (!pathValue) return null;
  if (pathValue.startsWith("http")) return pathValue;
  const normalizedBase = normalizePlexBaseUrl(baseUrl);
  const trimmedBase = normalizedBase?.replace(/\/$/, "");
  const normalizedPath = pathValue.startsWith("/") ? pathValue : `/${pathValue}`;
  return `${trimmedBase}${normalizedPath}`;
}

function parsePlexSessions(xmlText) {
  const sessions = [];
  const mediaTags = xmlText.match(/<(Video|Track|Photo)\b[^>]*>/g) || [];

  for (const tag of mediaTags) {
    const attributes = {};
    for (const [, key, value] of tag.matchAll(/(\w+)="([^"]*)"/g)) {
      attributes[key] = value;
    }

    const thumbPath =
      attributes.thumb ||
      attributes.parentThumb ||
      attributes.grandparentThumb ||
      attributes.art;

    const title =
      attributes.title ||
      attributes.grandparentTitle ||
      attributes.parentTitle ||
      "Plex Stream";

    if (!thumbPath) continue;

    sessions.push({
      title,
      thumb: thumbPath,
      sessionKey: attributes.sessionKey
    });
  }

  return sessions;
}

app.get("/api/plex/sessions", async (req, res) => {
  const plexBaseUrl = normalizePlexBaseUrl(process.env.PLEX_BASE_URL);
  const plexToken = process.env.PLEX_TOKEN;

  if (!plexBaseUrl || !plexToken) {
    res.json({ sessions: [], configMissing: true });
    return;
  }

  try {
    const url = new URL("/status/sessions", plexBaseUrl);
    url.searchParams.set("X-Plex-Token", plexToken);
    const agent = getPlexAgent(plexBaseUrl);

    const plexResponse = await fetch(url.toString(), { agent });
    if (!plexResponse.ok) {
      const errorBody = await plexResponse.text();
      res
        .status(plexResponse.status)
        .json({
          error: `Plex HTTP ${plexResponse.status}`,
          detail: errorBody || null
        });
      return;
    }

    const xmlText = await plexResponse.text();
    const sessions = parsePlexSessions(xmlText);
    res.json({ sessions });
  } catch (err) {
    console.error("Plex proxy error:", err);
    res
      .status(500)
      .json({ error: "Plex error", detail: err instanceof Error ? err.message : err });
  }
});

app.get("/api/plex/image", async (req, res) => {
  const plexBaseUrl = normalizePlexBaseUrl(process.env.PLEX_BASE_URL);
  const plexToken = process.env.PLEX_TOKEN;
  const imagePath = req.query.path;

  if (!plexBaseUrl || !plexToken || !imagePath) {
    res.status(400).json({ error: "Missing Plex configuration" });
    return;
  }

  try {
    const url = new URL(buildPlexUrl(plexBaseUrl, imagePath));
    url.searchParams.set("X-Plex-Token", plexToken);
    const agent = getPlexAgent(plexBaseUrl);

    const imageResponse = await fetch(url.toString(), { agent });
    if (!imageResponse.ok) {
      res
        .status(imageResponse.status)
        .json({ error: `Plex image HTTP ${imageResponse.status}` });
      return;
    }

    const buffer = await imageResponse.arrayBuffer();
    const contentType = imageResponse.headers.get("content-type") || "image/jpeg";
    res.type(contentType).send(Buffer.from(buffer));
  } catch (err) {
    console.error("Plex image proxy error:", err);
    res.status(500).json({
      error: "Plex image error",
      detail: err instanceof Error ? err.message : err
    });
  }
});

/* ============================================================================
   START SERVER
============================================================================ */

app.listen(PORT, () => {
  console.log(`Dashboard listening on http://localhost:${PORT}`);
});
