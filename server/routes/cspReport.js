import express from "express";
import { loopbackOnly } from "../middleware/security.js";

/* ═══ CSP VIOLATION TALLY (audit 2026-09-10, S1) ═══════════════════════════════
   The CSP shipped report-only for six weeks with nowhere to report TO. A
   report-only policy with no `report-uri` still logs violations, but only to
   the kiosk's DevTools console, which nobody reads on a wall. So "confirm zero
   violations before CSP_ENFORCE=1" had no instrument, and flipping it would have
   been a guess.

   The policy's `report-uri` points here now (middleware/security.js). The browser
   POSTs each violation, and this keeps a bounded in-memory tally keyed by
   directive, blocked origin and page:

     GET /api/csp-report   → { since, total, dropped, violations: [...] }

   Loopback only, because a blocked URI can name a LAN host.

   ⚠ In memory on purpose: a restart (every deploy) empties it. The FIRST sighting
   of each key is also written to the journal, so a soak that spans a restart
   can still be read with `journalctl -u dashboard.service | grep "\[CSP\]"`.

   Two report shapes arrive, and both are handled:
     legacy  report-uri        → { "csp-report": { "violated-directive", "blocked-uri", … } }
     modern  Reporting API     → [ { type: "csp-violation", body: { effectiveDirective, blockedURL, … } } ]
   ═══════════════════════════════════════════════════════════════════════════ */

const router = express.Router();

const MAX_KEYS = 100;
const MAX_FIELD = 200;

const since = new Date().toISOString();
let total = 0;
let dropped = 0; // reports that arrived after MAX_KEYS distinct keys were held
const tally = new Map();

function clip(v) {
  return typeof v === "string" ? v.slice(0, MAX_FIELD) : v == null ? "" : String(v).slice(0, MAX_FIELD);
}

/** "inline", "eval", "data" stay as keywords; a URL collapses to its origin. */
function blockedOrigin(raw) {
  const s = clip(raw);
  if (!s) return "(none)";
  try {
    const u = new URL(s);
    return u.protocol === "data:" || u.protocol === "blob:" ? u.protocol.slice(0, -1) : u.origin;
  } catch {
    return s;
  }
}

function pagePath(raw) {
  try {
    return new URL(clip(raw)).pathname;
  } catch {
    return clip(raw) || "(unknown)";
  }
}

/** One normalized violation, or null for anything that is not a CSP report. */
export function normalizeReport(entry) {
  if (!entry || typeof entry !== "object") return null;

  const legacy = entry["csp-report"];
  if (legacy && typeof legacy === "object") {
    return {
      directive: clip(legacy["effective-directive"] || legacy["violated-directive"]).split(" ")[0],
      blocked: blockedOrigin(legacy["blocked-uri"]),
      page: pagePath(legacy["document-uri"]),
      source: clip(legacy["source-file"]) + (legacy["line-number"] ? `:${legacy["line-number"]}` : ""),
      disposition: clip(legacy.disposition) || "unknown"
    };
  }

  if (entry.type === "csp-violation" && entry.body && typeof entry.body === "object") {
    const b = entry.body;
    return {
      directive: clip(b.effectiveDirective).split(" ")[0],
      blocked: blockedOrigin(b.blockedURL),
      page: pagePath(b.documentURL || entry.url),
      source: clip(b.sourceFile) + (b.lineNumber ? `:${b.lineNumber}` : ""),
      disposition: clip(b.disposition) || "unknown"
    };
  }

  return null;
}

function record(v) {
  if (!v || !v.directive) return;
  total += 1;
  const key = `${v.directive} ${v.blocked} ${v.page}`;
  const now = new Date().toISOString();
  const held = tally.get(key);
  if (held) {
    held.count += 1;
    held.lastAt = now;
    return;
  }
  if (tally.size >= MAX_KEYS) {
    dropped += 1;
    return;
  }
  tally.set(key, { ...v, count: 1, firstAt: now, lastAt: now });
  console.warn(`[CSP] new violation (${v.disposition}): ${v.directive} blocked ${v.blocked} on ${v.page}${v.source ? ` from ${v.source}` : ""}`);
}

// express.json() upstream only parses application/json; browsers send these types.
const reportBody = express.json({
  type: ["application/csp-report", "application/reports+json", "application/json"],
  limit: "32kb"
});

router.post("/api/csp-report", reportBody, (req, res) => {
  const body = req.body;
  const entries = Array.isArray(body) ? body : [body];
  for (const entry of entries.slice(0, 50)) record(normalizeReport(entry));
  res.status(204).end();
});

router.get("/api/csp-report", loopbackOnly("The CSP report tally"), (_req, res) => {
  const violations = [...tally.values()].sort((a, b) => b.count - a.count);
  res.json({ since, total, dropped, violations });
});

export default router;
