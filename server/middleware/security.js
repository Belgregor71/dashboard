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
// re-opens them (e.g. to read the dashboard from a phone with TTS + AI intact,
// or to talk to the house from it).
export function loopbackOnly(label) {
  return (req, res, next) => {
    if (isLoopback(req) || process.env.ALLOW_LAN_COST_ROUTES === "1") return next();
    res.status(403).json({ error: `${label} is available to the kiosk only` });
  };
}

// --- Cross-origin write guard (S3 cont. / H4) ---------------------------
// CSRF, concretely: a malicious page open on any LAN device makes a write land
// here. It never reads the response — it doesn't need to — and CORS only stops
// the read. One landed POST actuates an allowlisted HA service.
//
// MEASURED 2026-07-26 with a real cross-origin page, because the vector is not
// the one the audit named. Of the shapes an attacker page can fire:
//   - `fetch(..., {mode:'no-cors'})` — Chrome refuses it before the wire when
//     the target is a local address (net::ERR_FAILED, private-network access).
//     Real, but not ours to rely on: another browser may not.
//   - cross-origin `<form method=POST>` — NOT subject to that, and lands. This
//     is the live hole. /api/ha/services acts on `req.body || {}`, so even a
//     body express.json() can't parse still actuates. Now 403s here, verified
//     server-side (origin=http://localhost:9931, sec-fetch-site=cross-site).
//   - cross-origin PUT/DELETE — unreachable either way: illegal in no-cors
//     mode, and in CORS mode the preflight is already refused by corsAllowlist.
//     The guard covers them anyway; it costs nothing to be complete.
//
// No token is issued because there is no session to bind one to. Instead we
// trust the two headers a browser sets itself and page JS cannot forge:
// `Origin` (sent on every unsafe-method request, same-origin included) and
// `Sec-Fetch-Site`. A request carrying NEITHER is not a browser — it is a node
// script, the mic bridge or curl — and a non-browser client is out of CSRF's
// reach by definition, so it passes. That is what keeps the pregenerate script,
// scripts/fault-injection.mjs and the Playwright request fixture working.
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

function isTrustedWriteOrigin(req, allowed) {
  const origin = req.headers.origin;
  if (origin) {
    // Compare against the host the client actually used, so localhost:3000 (the
    // kiosk) and 192.168.x.x:3000 (the LAN portals) both resolve as same-origin
    // with nothing to configure.
    const host = req.headers.host;
    return origin === `http://${host}` || origin === `https://${host}` || allowed.includes(origin);
  }
  const site = req.headers["sec-fetch-site"];
  return !site || site === "same-origin" || site === "none";
}

// Global rather than per-route on purpose: the audit listed 8 mutating routes,
// but the defect class is "someone adds a 9th and forgets the guard".
function blockCrossOriginWrites(allowed) {
  return (req, res, next) => {
    if (SAFE_METHODS.has(req.method)) return next();
    if (isTrustedWriteOrigin(req, allowed)) return next();
    res.status(403).json({ error: "Cross-origin writes are not allowed" });
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

  // Same allowlist: an origin trusted enough to read cross-origin is trusted to
  // write. Mounted before express.json() so a rejected write is never parsed.
  app.use(blockCrossOriginWrites(allowed));

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
