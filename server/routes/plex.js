import express from "express";
import https from "https";
import { fetchWithTimeout } from "../utils/fetch.js";

const router = express.Router();

function normalizePlexBaseUrl(baseUrl) {
  if (!baseUrl) return baseUrl;
  const trimmed = baseUrl.trim().replace(/[<>]/g, "");
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `http://${trimmed}`;
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
    const title =
      attributes.title || attributes.grandparentTitle || attributes.parentTitle || "Plex Stream";
    const thumbPath =
      attributes.thumb || attributes.parentThumb || attributes.grandparentThumb || attributes.art;
    if (!thumbPath) continue;
    sessions.push({
      title,
      grandparentTitle: attributes.grandparentTitle || null,
      parentTitle: attributes.parentTitle || null,
      type: attributes.type,
      thumb: attributes.thumb || null,
      parentThumb: attributes.parentThumb || null,
      grandparentThumb: attributes.grandparentThumb || null,
      art: attributes.art || null,
      sessionKey: attributes.sessionKey
    });
  }
  return sessions;
}

router.get("/api/plex/sessions", async (_req, res) => {
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
    const plexResponse = await fetchWithTimeout(url.toString(), { agent });
    if (!plexResponse.ok) {
      const errorBody = await plexResponse.text();
      res.status(plexResponse.status).json({
        error: `Plex HTTP ${plexResponse.status}`,
        detail: errorBody || null
      });
      return;
    }
    const xmlText = await plexResponse.text();
    res.json({ sessions: parsePlexSessions(xmlText) });
  } catch (err) {
    console.error("Plex proxy error:", err);
    res.status(500).json({ error: "Plex error", detail: err instanceof Error ? err.message : err });
  }
});

router.get("/api/plex/image", async (req, res) => {
  const plexBaseUrl = normalizePlexBaseUrl(process.env.PLEX_BASE_URL);
  const plexToken = process.env.PLEX_TOKEN;
  const imagePath = req.query.path;

  if (!plexBaseUrl || !plexToken || !imagePath) {
    res.status(400).json({ error: "Missing Plex configuration" });
    return;
  }

  try {
    const builtUrl = buildPlexUrl(plexBaseUrl, imagePath);
    if (!builtUrl) {
      res.status(400).json({ error: "Invalid Plex image path" });
      return;
    }
    const url = new URL(builtUrl);
    const plexHost = new URL(plexBaseUrl).host;
    if (url.host !== plexHost) {
      res.status(400).json({ error: "Disallowed Plex image host" });
      return;
    }
    url.searchParams.set("X-Plex-Token", plexToken);
    const agent = getPlexAgent(plexBaseUrl);
    const imageResponse = await fetchWithTimeout(url.toString(), { agent });
    if (!imageResponse.ok) {
      res.status(imageResponse.status).json({ error: `Plex image HTTP ${imageResponse.status}` });
      return;
    }
    const buffer = await imageResponse.arrayBuffer();
    const contentType = imageResponse.headers.get("content-type") || "image/jpeg";
    res.type(contentType).send(Buffer.from(buffer));
  } catch (err) {
    console.error("Plex image proxy error:", err);
    res
      .status(500)
      .json({ error: "Plex image error", detail: err instanceof Error ? err.message : err });
  }
});

export default router;
