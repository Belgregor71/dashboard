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

/* ⚠ SEEN ON THE GLASS, 2026-08-13: the ambient band read `X-Men &#39;97`.
   These are XML attribute values and the entities in them are ENCODING, not
   content — an apostrophe in a show title arrives as `&#39;`, an ampersand as
   `&amp;`. Nothing decoded them, and every consumer renders with textContent
   (correctly — this is data), so the raw entity went straight to the wall.

   Decoded here, at the parse boundary, rather than in each reader: `thumb` is a
   URL whose query string arrives with `&amp;` separators and must be decoded to
   be usable, and a title is a title. The named set plus numeric escapes covers
   what XML actually permits unescaped. */
function decodeEntities(value) {
  return value
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    /* LAST, always. `&amp;lt;` is a literal "&lt;" and decoding the ampersand
       first would turn it into a "<" that was never there. */
    .replace(/&amp;/g, "&");
}

function tagAttributes(tag) {
  const attributes = {};
  for (const [, key, value] of tag.matchAll(/(\w+)="([^"]*)"/g)) {
    attributes[key] = decodeEntities(value);
  }
  return attributes;
}

/* WHERE it is playing — the answer the wall was missing.
   `<Player>` is a CHILD of `<Video>`, so the opening-tag scan below could never
   see it: `session.title` said "Colin from Accounts" and nothing anywhere said
   "on the lounge room TV". Each media element's own slice of the document is
   taken (from its opening tag to the next one) so a Player can only ever be
   attributed to the session it is nested in.

   `title` is what Plex shows the user for that client ("Lounge Room TV");
   `device`/`product` are the fallbacks when a client reports no friendly name. */
function playerIn(chunk) {
  const tag = chunk.match(/<Player\b[^>]*>/);
  if (!tag) return null;
  return tagAttributes(tag[0]);
}

/* ── The client → room map ─────────────────────────────────────────────────
   Owner's call, 2026-08-23: the wall names ROOMS, never devices. The Piano Room
   webplayer reported itself as "Edge" and the lounge Apple TV as "Apple TV",
   and neither is where anything is playing.

   ⚠ THE MAP LIVES IN THE ENVIRONMENT, NOT IN config.js, and that is deliberate.
   `src/js/config.js` is tracked AND shipped in the public bundle (CLAUDE.md,
   "Feature Flags"), and a machineIdentifier is a stable per-device identifier
   for a machine in this house. Resolving the room HERE means the identifiers
   never leave the server and the browser is handed only a room name.

   Format — entries separated by `|`, each `key=Room Name`:

     PLEX_ROOM_MAP=14AC104F-…=Lounge Room|v3y8sn…=Piano Room|Plex Web/Windows=Piano Room

   A key is either a `machineIdentifier` (exact, checked first) or a
   `product/device` pair (the fallback). Both are needed: Plex Web stores its
   identifier IN THE BROWSER, so clearing site data mints a new one — and
   because an unmapped client is hidden rather than guessed at, the room would
   silently stop appearing. The product/device rule survives that reset.
─────────────────────────────────────────────────────────────────────────── */
export function parseRoomMap(raw) {
  const byId = new Map();
  const byProduct = new Map();
  for (const entry of String(raw ?? "").split("|")) {
    const at = entry.indexOf("=");
    if (at < 1) continue;
    const key = entry.slice(0, at).trim();
    const room = entry.slice(at + 1).trim();
    if (!key || !room) continue;
    // A "/" marks the product/device fallback form; anything else is an id.
    if (key.includes("/")) byProduct.set(key.toLowerCase(), room);
    else byId.set(key, room);
  }
  return { byId, byProduct };
}

/**
 * @returns {string|null} the room this client is in, or null when the map does
 *          not know it. Null is a real answer: the wall hides unmapped clients
 *          rather than naming a device, so a stream on a phone at work never
 *          claims to be a room in this house.
 */
export function roomForPlayer(player, map) {
  if (!player || !map) return null;
  const byId = map.byId?.get(player.machineIdentifier);
  if (byId) return byId;
  const pair = `${player.product ?? ""}/${player.device ?? ""}`.toLowerCase();
  return map.byProduct?.get(pair) ?? null;
}

/** A Plex duration is milliseconds; the wall works in seconds. Null rather than
 *  0 for an absent value — 0 is a legitimate position at the start of a film,
 *  and a reader cannot tell "at the beginning" from "not reported" otherwise. */
function seconds(value) {
  const ms = Number(value);
  return Number.isFinite(ms) && ms >= 0 ? ms / 1000 : null;
}

export function parsePlexSessions(xmlText, map = null) {
  const sessions = [];
  const mediaTags = [...(xmlText ?? "").matchAll(/<(Video|Track|Photo)\b[^>]*>/g)];

  for (const [i, match] of mediaTags.entries()) {
    const tag = match[0];
    const chunk = xmlText.slice(match.index, mediaTags[i + 1]?.index ?? xmlText.length);
    const attributes = tagAttributes(tag);
    const title =
      attributes.title || attributes.grandparentTitle || attributes.parentTitle || "Plex Stream";
    const thumbPath =
      attributes.thumb || attributes.parentThumb || attributes.grandparentThumb || attributes.art;
    if (!thumbPath) continue;
    const player = playerIn(chunk);
    sessions.push({
      title,
      grandparentTitle: attributes.grandparentTitle || null,
      parentTitle: attributes.parentTitle || null,
      type: attributes.type,
      thumb: attributes.thumb || null,
      parentThumb: attributes.parentThumb || null,
      grandparentThumb: attributes.grandparentThumb || null,
      art: attributes.art || null,
      /* The device name. KEPT, because the contract test asserts it and because
         it is the only thing to fall back on when diagnosing an unmapped
         client — but `room` is what the wall renders. */
      player: player?.title || player?.device || player?.product || null,
      /* WHERE, resolved server-side. See parseRoomMap: the identifiers this is
         matched on never reach the browser. */
      room: roomForPlayer(player, map),
      /* ⚠ PARSED AWAY UNTIL 2026-08-23. Both were sitting in the payload and
         dropped on the floor, so no Plex stream on this wall could ever show
         how far through it was. `index`/`parentIndex` are the episode and
         season, which is the meta line for a show. */
      position: seconds(attributes.viewOffset),
      duration: seconds(attributes.duration),
      index: attributes.index ? Number(attributes.index) : null,
      parentIndex: attributes.parentIndex ? Number(attributes.parentIndex) : null,
      year: attributes.year ? Number(attributes.year) : null,
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
    /* Read per-request, not at module load: the kiosk's `.env` is edited and
       the service restarted, and a map frozen at import would need a deploy to
       change a room name. Parsing it is a handful of string splits. */
    res.json({ sessions: parsePlexSessions(xmlText, parseRoomMap(process.env.PLEX_ROOM_MAP)) });
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
