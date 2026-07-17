console.log(">>> DASHBOARD SERVER LOADED <<<");

import dotenv from "dotenv";
import express from "express";
import { existsSync } from "fs";
import net from "net";
import { createProxyMiddleware } from "http-proxy-middleware";
import path from "path";
import { fileURLToPath } from "url";

import { readHaConfig } from "./server/ha/haConfig.js";
import { getHaWsManager } from "./server/ha/haWs.js";
import { startHealthService } from "./server/services/healthService.js";
import { startRecoveryService } from "./server/services/recoveryService.js";
import { startTtsWarmer } from "./server/services/ttsWarmer.js";
import { normalizeBaseUrl } from "./server/config.js";
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
import routinesRoutes from "./server/routes/routines.js";
import memoriesRoutes from "./server/routes/memories.js";
import immichRoutes from "./server/routes/immich.js";
import delightRoutes from "./server/routes/delight.js";

// Node 20's Happy Eyeballs gives each address-family connect attempt only
// 250ms; distant hosts (e.g. RainViewer in Germany, ~270ms RTT from here)
// can never complete a handshake in that window, so every fetch ETIMEDOUTs.
net.setDefaultAutoSelectFamilyAttemptTimeout(1500);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Try root .env first, then server/.env as fallback (legacy location)
const envPath = existsSync(path.join(__dirname, ".env"))
  ? path.join(__dirname, ".env")
  : path.join(__dirname, "server", ".env");
const dotenvResult = dotenv.config({ path: envPath, quiet: true });
if (dotenvResult.error && dotenvResult.error.code !== "ENOENT") {
  console.warn("Unable to load dashboard .env file:", dotenvResult.error.message);
}

try {
  readHaConfig();
} catch (error) {
  console.error(error.message);
  process.exit(1);
}

const PORT = process.env.PORT || 3000;

const app = express();
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
app.use(routinesRoutes);
app.use(memoriesRoutes);
app.use(immichRoutes);
app.use(delightRoutes);

// Home Assistant image/camera proxy
attachHaProxy(app);

// Built assets (Vite output) — served before static/ so hashed bundles take priority
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

app.get("/", (_req, res) => {
  // The Vite-built app is the only entry point (npm run build every deploy).
  // A missing dist/index.html is a build failure to surface, not to paper over
  // with the retired legacy app (Phase 5 removed static/index.html).
  res.sendFile(path.join(__dirname, "dist", "index.html"));
});

function attachHaProxy(appInstance) {
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
    ws: true,
    on: {
      proxyReq: (proxyReq) => {
        const token = process.env.HA_TOKEN;
        if (token) proxyReq.setHeader("Authorization", `Bearer ${token}`);
        if (HA_PROXY_DEBUG) console.log("[ha-proxy]", proxyReq.path);
      },
      error: (error, req) => {
        console.error("[ha-proxy] Proxy error", {
          route: req?.originalUrl || req?.url,
          code: error?.code,
          message: error?.message
        });
      }
    }
  };

  appInstance.use("/api/image_proxy", createProxyMiddleware(baseProxyOptions));
  appInstance.use("/api/camera_proxy", createProxyMiddleware(baseProxyOptions));
}

app.listen(PORT, () => {
  console.log(`Dashboard listening on http://localhost:${PORT}`);
  // Pre-warm the doorbell/side-gate TTS cache in the background so real rings
  // play instantly instead of waiting on cold Kokoro synthesis.
  startTtsWarmer();
});
