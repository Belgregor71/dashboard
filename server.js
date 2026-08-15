console.log(">>> DASHBOARD SERVER LOADED <<<");

import dotenv from "dotenv";
import express from "express";
import net from "net";
import { createProxyMiddleware } from "http-proxy-middleware";
import path from "path";
import { fileURLToPath } from "url";

import { applySecurity } from "./server/middleware/security.js";
import { readHaConfig } from "./server/ha/haConfig.js";
import { getHaWsManager } from "./server/ha/haWs.js";
import { startHealthService } from "./server/services/healthService.js";
import { startRecoveryService } from "./server/services/recoveryService.js";
import { startTtsWarmer } from "./server/services/ttsWarmer.js";
import { startMemoryConsolidator } from "./server/services/conversationLog.js";
import { normalizeBaseUrl, resolveRootSurface, SURFACE_ENTRY } from "./server/config.js";
import arrRoutes from "./server/routes/arr.js";
import { createHaRouter } from "./server/ha/haRoutes.js";
import haSnapshotRoutes from "./server/routes/haSnapshot.js";
import systemRoutes from "./server/routes/system.js";
import weatherRoutes from "./server/routes/weather.js";
import calendarRoutes from "./server/routes/calendar.js";
import commuteRoutes from "./server/routes/commute.js";
import plexRoutes from "./server/routes/plex.js";
import newsRoutes from "./server/routes/news.js";
import cameraRoutes from "./server/routes/camera.js";
import photosRoutes from "./server/routes/photos.js";
import adminRoutes from "./server/routes/admin.js";
import binsRoutes from "./server/routes/bins.js";
import nrlRoutes from "./server/routes/nrl.js";
import aiRoutes from "./server/routes/ai.js";
import voiceRoutes from "./server/routes/voice.js";
import fuelRoutes from "./server/routes/fuel.js";
import radarRoutes from "./server/routes/radar.js";
import ttsRoutes from "./server/routes/tts.js";
import displayRoutes from "./server/routes/display.js";
import routinesRoutes from "./server/routes/routines.js";
import memoriesRoutes from "./server/routes/memories.js";
import immichRoutes from "./server/routes/immich.js";
import delightRoutes from "./server/routes/delight.js";
import recipeRoutes from "./server/routes/recipe.js";
import vaultRoutes from "./server/routes/vault.js";
import { startVaultIndex } from "./server/services/vaultIndex.js";

// Node 20's Happy Eyeballs gives each address-family connect attempt only
// 250ms; distant hosts (e.g. RainViewer in Germany, ~270ms RTT from here)
// can never complete a handshake in that window, so every fetch ETIMEDOUTs.
net.setDefaultAutoSelectFamilyAttemptTimeout(1500);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// The root .env is the only config location. There used to be a fallback to
// server/.env (the pre-split legacy path), and it did exactly what a silent
// fallback does: this dev machine had no root .env, so it ran for months off a
// stale server/.env while the Pi ran off the root one. The aliases hid it only
// halfway — haConfig accepts HA_URL, but /env.js reads HA_HOST alone, weather.js
// reads WEATHER_LAT alone, and calendar.js wants the three split feed URLs, so
// local dev silently had no calendars and no coordinates. One path, no guessing.
const envPath = path.join(__dirname, ".env");
const dotenvResult = dotenv.config({ path: envPath, quiet: true });
if (dotenvResult.error && dotenvResult.error.code !== "ENOENT") {
  console.warn("Unable to load dashboard .env file:", dotenvResult.error.message);
}

// A bad HA env line used to be fatal here — readHaConfig() threw and the
// process exited, taking weather, calendar, photos, recipes and the clock down
// with it, none of which need HA. The kiosk showed nothing at all. It now
// degrades into the state HA_ENABLED=0 already produces: /api/ha/* answers 503,
// everything else boots (audit 2026-07-26, M1).
const haConfig = readHaConfig({ requireConfig: false });
if (!haConfig.enabled && process.env.HA_ENABLED !== "0") {
  console.warn(
    `[ha] integration disabled: missing ${haConfig.missing.join(", ")}. ` +
      "The dashboard is running without Home Assistant — /api/ha/* will answer 503."
  );
}

const PORT = process.env.PORT || 3000;

// How long the HA image/camera proxy may wait before it answers on its own.
// Declared up here deliberately: attachHaProxy(app) is CALLED further down but
// before its own definition, so a const beside that function is still in its
// temporal dead zone when the call runs and the server dies at boot.
const HA_UPSTREAM_TIMEOUT_MS = 5000;

const app = express();
// Headers, CORS allowlist and the flood ceiling go on before anything parses a
// body, so a rejected request never reaches a route (audit 2026-07-26, S3).
applySecurity(app);
app.use(express.json({ limit: "256kb" }));

// Arr routes (Sonarr/Radarr/qBittorrent)
app.use("/api", arrRoutes);

// Home Assistant: snapshot must come before the HA router because the router
// has a catch-all when HA is disabled that would otherwise swallow this route.
app.use(haSnapshotRoutes);
const haRouteLogger = (req, res, next) => {
  const start = Date.now();
  res.on("finish", () => {
    console.log(`[ha-api] ${req.method} ${req.originalUrl} -> ${res.statusCode} (${Date.now() - start}ms)`);
  });
  next();
};
app.use("/api/ha", haRouteLogger, createHaRouter());

// Watchdog: feed freshness registry + phone push on sustained degradation.
// createHaRouter() has already started the HA WS manager when HA is enabled.
const { enabled: haEnabledForHealth } = readHaConfig({ requireConfig: false });
startHealthService({ manager: haEnabledForHealth ? getHaWsManager() : null });
// Self-heal layer: re-arms detection switches, repairs the eufy push lane.
startRecoveryService({ manager: haEnabledForHealth ? getHaWsManager() : null });

// Feature routes
app.use(systemRoutes);
app.use(weatherRoutes);
app.use(calendarRoutes);
app.use(commuteRoutes);
app.use(plexRoutes);
app.use(newsRoutes);
app.use(cameraRoutes);
app.use(photosRoutes);
app.use(adminRoutes);
app.use(binsRoutes);
app.use(nrlRoutes);
app.use(aiRoutes);
app.use(voiceRoutes);
app.use(fuelRoutes);
app.use(radarRoutes);
app.use(ttsRoutes);
app.use(displayRoutes);
app.use(routinesRoutes);
app.use(memoriesRoutes);
app.use(immichRoutes);
app.use(delightRoutes);
app.use(recipeRoutes);

// House knowledge base (docs/design/VAULT.md). Default-off: with VAULT_ENABLED
// unset the router is never mounted, the index is never built, and the
// concierge's system prompt is byte-identical to before — the lane is inert,
// not merely idle. Unsetting it is the whole rollback path.
const VAULT_ENABLED = process.env.VAULT_ENABLED === "1";
if (VAULT_ENABLED) app.use(vaultRoutes);

// Home Assistant image/camera proxy
attachHaProxy(app);

// ── Which surface the kiosk sees (docs/design/V3-CUTOVER.md §3) ─────────────
// THIS MUST STAY ABOVE express.static(dist). serve-static answers a request for
// "/" with dist/index.html on its own — its `index` option defaults to
// "index.html" — so the `app.get("/")` that used to sit BELOW the static mounts
// was unreachable dead code. Measured 2026-08-09: a handler returning 418 there
// never ran. Editing that line would have flipped nothing while looking exactly
// like a successful deploy.
//
// Flag-gated, default-off. With V3_DEFAULT unset this sends the same
// dist/index.html serve-static was already sending, from the same `send`
// pipeline — same bytes, same headers. `V3_DEFAULT=0` on the Pi forces the
// incumbent back without a deploy; that is the rollback path.
//
// No fallback to a legacy file if the entry is missing: a missing build output
// is a build failure to surface (Phase 5 removed static/index.html), so
// sendFile's ENOENT is allowed to become a 5xx rather than be papered over.
const ROOT_SURFACE = resolveRootSurface(process.env);
console.log(`[surface] / serves the ${ROOT_SURFACE} dashboard (${SURFACE_ENTRY[ROOT_SURFACE]})`);
app.get("/", (_req, res) => {
  res.sendFile(path.join(__dirname, "dist", SURFACE_ENTRY[ROOT_SURFACE]));
});

// Built assets (Vite output) — served before static/ so hashed bundles take
// priority. Its index resolution is what keeps /index.html and /v3/ reachable
// whichever way the flag above points.
app.use(express.static(path.join(__dirname, "dist")));
// Raw static assets that bypass the build step (photos, icons, weather videos, data)
app.use(express.static(path.join(__dirname, "static")));
app.use(
  "/assets",
  express.static(path.join(__dirname, "dist", "assets"), {
    maxAge: "30d",
    immutable: true
  })
);
app.use("/photos", express.static(path.join(__dirname, "static", "photos")));
app.use("/icons", express.static(path.join(__dirname, "static", "icons")));

// MEASURED on the Pi 2026-07-26 (audit S5), because the behaviour is not what
// the mount paths suggest: Express strips the mount prefix before
// http-proxy-middleware v3 reads req.url, and v3 (unlike the legacy factory)
// does not restore it from req.originalUrl. So whatever follows the mount was
// forwarded to HA verbatim, with the bearer token attached —
// `/api/image_proxy/api/states` came back 200 with every entity in the house,
// and `/api/image_proxy/api/config` with the full HA config, to any LAN caller.
// That routes around the SAFE_SERVICES allowlist on /api/ha/services entirely.
//
// The only path the dashboard actually needs is HA's own token-scoped media
// proxy: modules/mediaPanels.js prefixes this mount onto a media_player's
// entity_picture, which HA serves as
// `/api/media_player_proxy/media_player.piano_room?token=…&cache=…` (the live
// shape, confirmed against HA's own /api/states). camera_proxy and image_proxy
// are the same class of token-scoped image endpoint and cost nothing to allow.
// Anchored end-to-end rather than prefix-matched so no `..` segment can ride
// along — HPM's own string filters are a bare indexOf on an unnormalised path.
// ⚠ `proxyTimeout` does NOT cover a connect that never completes, and that is
// the failure that actually happens here. http-proxy implements it as
// `proxyReq.setTimeout(...)`, and Node arms that only "once a socket is assigned
// to this request AND IS CONNECTED" — so a black-holed SYN is never bounded by
// it. Measured on the live kiosk 2026-08-05, with proxyTimeout already set:
// twelve seconds, `status=000`, and not one error event in the journal. The NAS
// answered ping in 1-3ms throughout; only port 8123 was swallowing the SYN.
//
// So bound the INCOMING request instead. This needs no cooperation from the
// proxy library and cannot be defeated by which layer failed to connect: if
// nothing has answered in time, we answer. Guarded on headersSent so a slow but
// successful proxy response is never truncated, and the timer is cleared on
// both finish and close so it cannot fire after the fact.
function answerIfUpstreamStalls(ms) {
  return (req, res, next) => {
    const timer = setTimeout(() => {
      if (res.headersSent || res.writableEnded) return;
      console.error("[ha-proxy] upstream stalled, answering", {
        route: req.originalUrl || req.url,
        ms
      });
      res.status(504).json({ error: "Home Assistant did not respond" });
    }, ms);
    timer.unref?.(); // never hold the process open on a pending image fetch
    const clear = () => clearTimeout(timer);
    res.on("finish", clear);
    res.on("close", clear);
    next();
  };
}

function attachHaProxy(appInstance) {
  const HA_MEDIA_PATH =
    /^\/api\/(media_player_proxy|camera_proxy|image_proxy)\/[a-z0-9_]+\.[a-z0-9_]+$/;

  // GET/HEAD only: these mounts serve images. A POST also used to hang the
  // socket open indefinitely — express.json() drains the body first, so
  // http-proxy forwarded a request whose body never arrived and HA waited on it.
  const haMediaPathFilter = (pathname, req) =>
    (req.method === "GET" || req.method === "HEAD") && HA_MEDIA_PATH.test(pathname);

  const HA_PROXY_DEBUG = process.env.DEBUG_HA_PROXY === "1";
  const haTarget = normalizeBaseUrl(process.env.HA_HOST || process.env.HA_URL);

  if (!haTarget) {
    console.warn("HA_HOST / HA_URL is not configured; skipping Home Assistant proxy.");
    const missingHaHandler = (_req, res) => {
      res.status(503).json({
        error: "Home Assistant proxy unavailable",
        detail:
          "Set HA_HOST (and HA_TOKEN if required) in the dashboard environment to enable /api/image_proxy and /api/camera_proxy."
      });
    };
    appInstance.use("/api/image_proxy", missingHaHandler);
    appInstance.use("/api/camera_proxy", missingHaHandler);
    return;
  }

  const baseProxyOptions = {
    target: haTarget,
    changeOrigin: true,
    pathFilter: haMediaPathFilter,
    // Bounds the wait once a connection EXISTS. It is deliberately not the only
    // guard — see answerIfUpstreamStalls, and the note there for why this one
    // cannot cover the failure that actually happens here.
    proxyTimeout: HA_UPSTREAM_TIMEOUT_MS,
    // ws was on with no consumer: it subscribed a server-wide 'upgrade' handler
    // that proxied matching WebSocket upgrades into HA. Images need no upgrade.
    on: {
      proxyReq: (proxyReq) => {
        const token = process.env.HA_TOKEN;
        if (token) proxyReq.setHeader("Authorization", `Bearer ${token}`);
        if (HA_PROXY_DEBUG) console.log("[ha-proxy]", proxyReq.path);
      },
      error: (error, req, res) => {
        console.error("[ha-proxy] Proxy error", {
          route: req?.originalUrl || req?.url,
          code: error?.code,
          message: error?.message
        });
        // ⚠ Supplying an `error` handler REPLACES http-proxy-middleware's own,
        // and its own is the thing that would otherwise answer the request.
        // Logging and returning leaves the socket open until the client gives
        // up — which on a kiosk that never reloads is effectively forever.
        // That matters more than one stalled image: the browser allows six
        // connections per host, so hung requests accumulate against that pool
        // and eventually starve unrelated fetches on the same origin. HA lives
        // on the NAS here, and a sleeping NAS is a recurring condition, not a
        // hypothetical. Same class as the POST hang the pathFilter note above
        // describes: the bug is always a request nobody ever answers.
        if (res?.headersSent || res?.writableEnded) return;
        if (typeof res?.status === "function") {
          res.status(502).json({
            error: "Home Assistant unreachable",
            code: error?.code ?? null
          });
        } else if (typeof res?.end === "function") {
          res.statusCode = 502;
          res.end();
        }
      }
    }
  };

  const stallGuard = answerIfUpstreamStalls(HA_UPSTREAM_TIMEOUT_MS);
  appInstance.use("/api/image_proxy", stallGuard, createProxyMiddleware(baseProxyOptions));
  appInstance.use("/api/camera_proxy", stallGuard, createProxyMiddleware(baseProxyOptions));
}

app.listen(PORT, () => {
  console.log(`Dashboard listening on http://localhost:${PORT}`);
  // Pre-warm the doorbell/side-gate TTS cache in the background so real rings
  // play instantly instead of waiting on cold Kokoro synthesis.
  startTtsWarmer();
  if (VAULT_ENABLED) {
    startVaultIndex().catch((err) => console.error("[vault] initial index failed:", err.message));
  }
  // Distil yesterday's conversations into vault notes, on a six-hour timer and
  // never inside a turn. Self-gates on VOICE_MEMORY_ENABLED and defers its
  // first pass five minutes — boot is the one moment the box is busy.
  startMemoryConsolidator();
});
