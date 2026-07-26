import helmet from "helmet";
import rateLimit from "express-rate-limit";

// Security posture for a LAN-only kiosk server (audit 2026-07-26, S1/S2/S3).
//
// Threat model: the dashboard listens on the whole LAN, so any device on it —
// including a compromised IoT box — can reach every route. The kiosk itself is
// NOT on the LAN side of that boundary: chromium runs on the Pi against
// http://localhost:3000, so every legitimate caller of a billable route is
// loopback. That asymmetry is what `loopbackOnly` below trades on.

// --- Loopback guard (S1/S2) ---------------------------------------------
// Same test /api/voice/transcript has always used, lifted here so the cost
// routes share one definition.
export function isLoopback(req) {
  const ip = req.socket?.remoteAddress ?? "";
  return ip === "127.0.0.1" || ip === "::1" || ip === "::ffff:127.0.0.1";
}

// Gate a route to on-Pi callers. The kiosk page, the mic bridge and the
// pregenerate script are all loopback; a LAN device is not. ALLOW_LAN_COST_ROUTES=1
// re-opens them (e.g. to read the dashboard from a phone with TTS + AI intact).
export function loopbackOnly(label) {
  return (req, res, next) => {
    if (isLoopback(req) || process.env.ALLOW_LAN_COST_ROUTES === "1") return next();
    res.status(403).json({ error: `${label} is available to the kiosk only` });
  };
}

// --- CSP ----------------------------------------------------------------
// Everything the page talks to, enumerated: same-origin (HA, go2rtc, Immich and
// the camera streams are all server-proxied), Google Fonts, and Open-Meteo
// (the only upstream the browser calls directly — services/weather).
// blob: covers TTS WAVs and lottie/canvas captures; data: covers inline icons.
// upgrade-insecure-requests must stay OFF — this server is plain HTTP on a LAN.
const CSP_DIRECTIVES = {
  "default-src": ["'self'"],
  "base-uri": ["'self'"],
  "object-src": ["'none'"],
  "frame-ancestors": ["'none'"],
  "script-src": ["'self'"],
  "style-src": ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
  "font-src": ["'self'", "data:", "https://fonts.gstatic.com"],
  "img-src": ["'self'", "data:", "blob:"],
  "media-src": ["'self'", "data:", "blob:"],
  "worker-src": ["'self'", "blob:"],
  "connect-src": [
    "'self'",
    "https://api.open-meteo.com",
    "https://air-quality-api.open-meteo.com"
  ],
  "upgrade-insecure-requests": null
};

// --- CORS allowlist (S3) ------------------------------------------------
// Express sends no Access-Control-Allow-Origin by default, which is already the
// safe answer; this makes that policy explicit and rejects cross-origin
// preflights outright instead of letting them 404 into a route.
function corsAllowlist(allowed) {
  return (req, res, next) => {
    const origin = req.headers.origin;
    if (!origin) return next(); // same-origin navigations and non-browser clients

    if (allowed.includes(origin)) {
      res.set("Access-Control-Allow-Origin", origin);
      res.set("Vary", "Origin");
      if (req.method === "OPTIONS") {
        res.set("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS");
        res.set("Access-Control-Allow-Headers", "Content-Type");
        return res.status(204).end();
      }
      return next();
    }

    if (req.method === "OPTIONS") return res.status(403).end();
    next(); // no ACAO header, so the browser blocks the response read
  };
}

// Mount helmet, the CORS allowlist and the global /api rate limiter.
// Call after dotenv.config() — every env read here happens at call time.
export function applySecurity(app) {
  // No reverse proxy in front of this server; say so explicitly so
  // express-rate-limit keys on the real socket address.
  app.set("trust proxy", false);

  // CSP ships report-only until a live Pi pass confirms zero violations
  // (CSP_ENFORCE=1 flips it). Known pending violation: the /admin/photos page
  // is built with an inline <script> and an onclick handler.
  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: true,
        directives: CSP_DIRECTIVES,
        reportOnly: process.env.CSP_ENFORCE !== "1"
      }
    })
  );

  const allowed = (process.env.CORS_ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  app.use(corsAllowlist(allowed));

  // LAN clients only. On-Pi callers are exempt because a single loopback IP is
  // legitimately bursty: the full test suite peaks at ~2,700 req/min and a cold
  // kiosk page load fans out across ~54 routes before the pollers even start.
  // A ceiling low enough to matter would throttle the glass, and a 429 to the
  // kiosk fails silently — measured, not assumed (an earlier 2000/min ceiling
  // did exactly that, killing the mic-bridge SSE mid-suite).
  app.use(
    "/api",
    rateLimit({
      windowMs: 60_000,
      limit: Number(process.env.API_RATE_LIMIT ?? 600),
      skip: isLoopback,
      standardHeaders: "draft-8",
      legacyHeaders: false,
      message: { error: "Too many requests" }
    })
  );
}
