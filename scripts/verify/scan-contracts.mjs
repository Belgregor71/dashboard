#!/usr/bin/env node
/**
 * Cross-layer contract scanner — whole tree, not the diff.
 *
 * Two invariants that no unit test can hold, because both halves are always
 * individually valid:
 *
 *   1. ROUTE CONTRACT  — every `/api/...` the frontend fetches must be a route
 *      the server actually declares. Breaking this is silent: the caller gets a
 *      404, lands in its own catch, and renders a fallback. `/api/ai/route` was
 *      called from two live paths for months while `tests/api.spec.js` carried a
 *      `test.fixme` naming it (2026-07 audit). A test that is skipped is not a gate.
 *
 *   2. EVENT CONTRACT  — every eventBus subscription must have an emitter.
 *      `core/eventBus.js` `emit()` early-returns when nobody listens, so a
 *      renamed or removed emitter leaves the handler wired, reachable, and
 *      permanently unreachable at the same time. The 2026-07 audit found 8 of
 *      these (the calendar voice-command handlers).
 *
 * Deliberately a WHOLE-TREE scan, unlike scan-patterns.mjs. Both halves of a
 * contract rarely move in the same commit — deleting a route in one file breaks
 * a caller in another that the diff never touches. Cost is ~1s; scanning the
 * diff would miss the exact case the gate exists for.
 *
 * Usage: node scripts/verify/scan-contracts.mjs [--verbose]
 */

import { readFileSync, readdirSync, statSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const VERBOSE = process.argv.includes("--verbose");

/* ------------------------------------------------------------------ *
 * BASELINE — findings that exist today and are accepted for now.
 *
 * Every entry is a real defect, not a false positive. They are listed here so
 * the gate goes green on the current tree and any NEW breakage fails loudly.
 * Deleting an entry is the fix landing. This list should only ever shrink.
 * ------------------------------------------------------------------ */
const BASELINE = {
  // Audit H1. Called from modules/systemStatus.js + services/homeAssistant/events.js.
  // The server never defined it. Closing move: delete both call sites (the AI
  // voice-routing feature was never finished) or implement the endpoint.
  routes: ["/api/ai/route"],

  // Audit M8. The calendar was once driven by voice/keyboard commands that
  // emitted these; the emitters went, the handlers stayed. Closing move: delete
  // the handlers in modules/calendar.js:423-427 and the three strays, or re-wire
  // the commands that fed them.
  listeners: [
    "calendar:next-month",
    "calendar:previous-month",
    "calendar:go-today",
    "calendar:show-details",
    "calendar:close-details",
    "calendar:weekRendered",  // services/weather/renderer.js:1007
    "ha:message",             // modules/systemStatus.js:408
    "voice:state"             // core/voiceOverlay.js:78 — the voice overlay never gets its state
  ]
};

/* ------------------------------------------------------------------ *
 * File walking
 * ------------------------------------------------------------------ */

function walk(dir, test, out = []) {
  let entries;
  try {
    entries = readdirSync(path.join(ROOT, dir), { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const rel = `${dir}/${e.name}`;
    if (e.isDirectory()) {
      if (e.name === "node_modules" || e.name.startsWith(".")) continue;
      walk(rel, test, out);
    } else if (test(e.name)) {
      out.push(rel);
    }
  }
  return out;
}

const isJs = (n) => /\.(js|mjs)$/.test(n);
const read = (f) => {
  try {
    return readFileSync(path.join(ROOT, f), "utf8");
  } catch {
    return "";
  }
};

/* ------------------------------------------------------------------ *
 * 1. ROUTE CONTRACT
 * ------------------------------------------------------------------ */

/**
 * Mount prefixes, read from server.js rather than hardcoded — `app.use("/api", arrRoutes)`
 * and `app.use("/api/ha", …, createHaRouter())` shift every route inside those
 * modules, and a hardcoded table silently rots the day a mount moves.
 */
function readMounts() {
  const src = read("server.js");
  const mounts = new Map(); // importedName -> prefix
  const files = new Map();  // importedName -> file path

  for (const m of src.matchAll(/import\s+(?:\{\s*(\w+)\s*\}|(\w+))\s+from\s+["']\.\/(server\/[^"']+)["']/g)) {
    files.set(m[1] || m[2], m[3]);
  }
  // app.use("/prefix", …, thing)  |  app.use(thing)
  for (const m of src.matchAll(/app\.use\(\s*(?:["']([^"']+)["']\s*,\s*)?([\s\S]{0,120}?)\)\s*;/g)) {
    const prefix = m[1] || "";
    for (const id of m[2].matchAll(/\b(\w+)\b/g)) {
      if (files.has(id[1])) mounts.set(files.get(id[1]), prefix);
    }
  }
  // createHaRouter() is called inline, not passed by name.
  if (/app\.use\(\s*["']\/api\/ha["']/.test(src)) mounts.set("server/ha/haRoutes.js", "/api/ha");
  return mounts;
}

/** Proxy mounts declared with createProxyMiddleware, not a router. */
function readProxyPrefixes() {
  const src = read("server.js");
  const out = [];
  for (const m of src.matchAll(/\.use\(\s*["'](\/api\/[^"']+)["']\s*,\s*(?:createProxyMiddleware|missingHaHandler)/g)) {
    out.push(m[1]);
  }
  return [...new Set(out)];
}

function declaredRoutes() {
  const mounts = readMounts();
  const routes = [];
  for (const file of walk("server", isJs)) {
    const prefix = mounts.get(file) ?? "";
    for (const m of read(file).matchAll(/router\.(get|post|put|patch|delete)\(\s*["']([^"']+)["']/g)) {
      routes.push({ method: m[1].toUpperCase(), pattern: prefix + m[2], file });
    }
  }
  return routes;
}

/** A path becomes an array of segments; params and template holes become null (wildcard). */
function segments(p) {
  return p
    .replace(/\?.*$/, "")
    .replace(/\/+$/, "")
    .split("/")
    .filter(Boolean)
    .map((s) => {
      if (s.startsWith(":")) return null;          // express :param (with or without a (regex) suffix)
      if (s.includes("${") || s.includes("+")) return null; // template literal / concatenated value
      return s;
    });
}

function matches(callSegs, routeSegs) {
  if (callSegs.length !== routeSegs.length) return false;
  return callSegs.every((c, i) => c === null || routeSegs[i] === null || c === routeSegs[i]);
}

function frontendApiCalls() {
  const calls = [];
  for (const file of walk("src/js", isJs)) {
    const src = read(file);
    src.split("\n").forEach((line, i) => {
      if (/^\s*(\/\/|\*)/.test(line)) return; // comment
      for (const m of line.matchAll(/fetch\(\s*[`"']([^`"']*)/g)) {
        const url = m[1];
        if (!url.startsWith("/api/")) continue; // only the contract we own
        calls.push({ url, file, line: i + 1 });
      }
    });
  }
  return calls;
}

function checkRoutes() {
  const routes = declaredRoutes();
  const proxies = readProxyPrefixes();
  const routeSegs = routes.map((r) => ({ ...r, segs: segments(r.pattern) }));
  const proxySegs = proxies.map((p) => segments(p));

  const hits = [];
  const seen = new Set();
  for (const call of frontendApiCalls()) {
    const segs = segments(call.url);
    if (routeSegs.some((r) => matches(segs, r.segs))) continue;
    // A proxy mount owns everything beneath it.
    if (proxySegs.some((p) => p.every((s, i) => s === segs[i]))) continue;

    const key = `${call.url}@${call.file}:${call.line}`;
    if (seen.has(key)) continue;
    seen.add(key);
    hits.push(call);
  }
  return { hits, routeCount: routes.length };
}

/* ------------------------------------------------------------------ *
 * 2. EVENT CONTRACT
 * ------------------------------------------------------------------ */

function eventSites() {
  const emits = new Map();     // name -> [where]
  const listens = new Map();   // name -> [where]
  for (const file of walk("src/js", isJs)) {
    const src = read(file);
    // Only files that actually pull the bus in — otherwise a stray `.on(` or a
    // DOM helper named on() would poison the census.
    if (!/from\s+["'][^"']*eventBus\.js["']/.test(src)) continue;
    src.split("\n").forEach((line, i) => {
      if (/^\s*(\/\/|\*)/.test(line)) return;
      for (const m of line.matchAll(/(?<![.\w])emit\(\s*["']([^"']+)["']/g)) {
        (emits.get(m[1]) ?? emits.set(m[1], []).get(m[1])).push(`${file}:${i + 1}`);
      }
      for (const m of line.matchAll(/(?<![.\w])on\(\s*["']([^"']+)["']/g)) {
        (listens.get(m[1]) ?? listens.set(m[1], []).get(m[1])).push(`${file}:${i + 1}`);
      }
    });
  }
  return { emits, listens };
}

function checkEvents() {
  const { emits, listens } = eventSites();
  const orphanListeners = [];
  const orphanEmits = [];
  for (const [name, where] of listens) {
    if (!emits.has(name)) orphanListeners.push({ name, where });
  }
  for (const [name, where] of emits) {
    if (!listens.has(name)) orphanEmits.push({ name, where });
  }
  return { orphanListeners, orphanEmits, total: emits.size + listens.size };
}

/* ------------------------------------------------------------------ *
 * Report
 * ------------------------------------------------------------------ */

function main() {
  let failed = 0;

  // --- routes ---
  const { hits, routeCount } = checkRoutes();
  const newRouteHits = hits.filter((h) => !BASELINE.routes.includes(h.url));
  const baselinedRoutes = hits.filter((h) => BASELINE.routes.includes(h.url));

  console.log(`[contracts] ${routeCount} server routes declared`);
  if (newRouteHits.length) {
    failed = 1;
    console.error(`\n[contracts] FAIL — ${newRouteHits.length} frontend fetch(es) with no server route:\n`);
    for (const h of newRouteHits) console.error(`    ${h.file}:${h.line} — fetch("${h.url}")`);
    console.error(
      `\n    fix: add the route, correct the path, or delete the caller. A missing\n` +
      `         /api route does not throw — the caller 404s into its own catch and\n` +
      `         renders a fallback forever.\n`
    );
  } else {
    console.log(`[contracts] routes pass${baselinedRoutes.length ? ` (${baselinedRoutes.length} baselined)` : ""}`);
  }

  // --- events ---
  const { orphanListeners, orphanEmits } = checkEvents();
  const newOrphans = orphanListeners.filter((o) => !BASELINE.listeners.includes(o.name));
  const baselinedListeners = orphanListeners.filter((o) => BASELINE.listeners.includes(o.name));

  if (newOrphans.length) {
    failed = 1;
    console.error(`\n[contracts] FAIL — ${newOrphans.length} eventBus subscription(s) with no emitter:\n`);
    for (const o of newOrphans) console.error(`    ${o.name}\n      ${o.where.join("\n      ")}`);
    console.error(
      `\n    fix: restore the emitter or delete the handler. emit() early-returns when\n` +
      `         nobody listens, so a renamed event leaves the handler wired and dead\n` +
      `         at the same time — it will never throw and never run.\n`
    );
  } else {
    console.log(`[contracts] events pass${baselinedListeners.length ? ` (${baselinedListeners.length} baselined)` : ""}`);
  }

  // Emitted-with-no-listener is a smell, not a defect — emit() is a no-op, so
  // nothing breaks. Reported, never fatal.
  if (orphanEmits.length) {
    console.log(`[contracts] note — ${orphanEmits.length} event(s) emitted with no subscriber (harmless):`);
    for (const o of orphanEmits) console.log(`    ${o.name}  (${o.where.join(", ")})`);
  }

  if (VERBOSE && (baselinedRoutes.length || baselinedListeners.length)) {
    console.log(`\n[contracts] baselined (known defects, see BASELINE in this file):`);
    for (const h of baselinedRoutes) console.log(`    route  ${h.url}  ${h.file}:${h.line}`);
    for (const o of baselinedListeners) console.log(`    event  ${o.name}  ${o.where.join(", ")}`);
  }

  // A baseline entry that no longer fires is a fix that landed — say so, so the
  // list gets cleaned up instead of quietly protecting nothing.
  const staleRoutes = BASELINE.routes.filter((r) => !hits.some((h) => h.url === r));
  const staleListeners = BASELINE.listeners.filter((l) => !orphanListeners.some((o) => o.name === l));
  if (staleRoutes.length || staleListeners.length) {
    console.log(`\n[contracts] baseline is stale — these no longer fire, delete them from BASELINE:`);
    for (const r of staleRoutes) console.log(`    routes:    "${r}"`);
    for (const l of staleListeners) console.log(`    listeners: "${l}"`);
  }

  if (!failed) console.log("[contracts] pass");
  return failed;
}

process.exit(main());
