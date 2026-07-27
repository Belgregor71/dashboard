import { test, expect } from "@playwright/test";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, extname } from "node:path";

// Audit 2026-07-26 H5/§11: ".env.example documents 5 variables, the code reads 50.
// A rebuild from this repository is impossible without reading the source."
//
// The count was wrong (31 documented, 79 read at the time) but the substance held:
// 49 variables were undocumented. The value of fixing it is entirely in it STAYING
// fixed, so this walks the same ground the audit did and fails when a new
// process.env read lands without a line in .env.example.
//
// "Documented" deliberately includes commented-out mentions: the legacy aliases
// (HA_URL, LAT, LON) and the script-only knobs are described in .env.example but
// must NOT ship as live keys — copying the example must not point a fresh install
// at the wrong HA host or set PI_SSH.

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function jsFilesUnder(dir) {
  const out = [];
  const walk = (d) => {
    for (const name of readdirSync(d)) {
      if (name === "node_modules" || name.startsWith(".")) continue;
      const full = join(d, name);
      if (statSync(full).isDirectory()) walk(full);
      else if ([".js", ".mjs", ".cjs"].includes(extname(name))) out.push(full);
    }
  };
  walk(dir);
  return out;
}

function envVarsReadByCode() {
  const files = [
    ...jsFilesUnder(join(root, "server")),
    ...jsFilesUnder(join(root, "scripts")),
    join(root, "server.js")
  ];
  const found = new Set();
  for (const file of files) {
    const src = readFileSync(file, "utf8");
    // Direct reads: process.env.FOO
    for (const m of src.matchAll(/process\.env\.([A-Z0-9_]+)/g)) found.add(m[1]);
    // Indirect: the envVal("FOO") helper in immichClient.js / dailyMemories.js,
    // which exists to strip the double quotes the Pi's .env wraps values in.
    for (const m of src.matchAll(/envVal\(\s*["']([A-Z0-9_]+)["']\s*\)/g)) found.add(m[1]);
  }
  return found;
}

test(".env.example documents every env var the server code reads", () => {
  const example = readFileSync(join(root, ".env.example"), "utf8");
  const missing = [...envVarsReadByCode()]
    .filter((name) => !example.includes(name))
    .sort();

  expect(
    missing,
    `These env vars are read by code but absent from .env.example:\n  ${missing.join("\n  ")}`
  ).toEqual([]);
});

test(".env.example does not document keys nothing reads", () => {
  const example = readFileSync(join(root, ".env.example"), "utf8");
  const read = envVarsReadByCode();

  // Live keys only (uncommented `NAME=`). Commented mentions are prose.
  const documented = [...example.matchAll(/^([A-Z0-9_]+)=/gm)].map((m) => m[1]);
  const dead = documented.filter((name) => !read.has(name)).sort();

  // FUEL_TYPES was exactly this: documented for a long time, read by nothing,
  // because fuel.js hardcodes FUEL_ID = 2.
  expect(
    dead,
    `These keys are in .env.example but no code reads them:\n  ${dead.join("\n  ")}`
  ).toEqual([]);
});

// Audit 2026-07-26 S12: "server/.env.example and root .env.example both exist; the
// dual-path dotenv fallback means a stale server/.env can silently shadow intent."
// It was not hypothetical — this dev machine had no root .env and had been running
// off a stale server/.env, which is why local dev had no calendars (calendar.js
// reads the three split feed URLs; the legacy file had the combined list that
// nothing reads) and no coordinates (weather.js reads WEATHER_LAT, not LAT).
// Both halves have to stay dead: one example file, one load path.

test("there is exactly one .env.example, at the repo root", () => {
  expect(existsSync(join(root, ".env.example"))).toBe(true);
  expect(
    existsSync(join(root, "server", ".env.example")),
    "server/.env.example is back. A second example file drifts from the real one — " +
      "the deleted copy still advertised PORT=3001 and two keys no code reads."
  ).toBe(false);
});

test("server.js loads exactly one .env path — no legacy fallback", () => {
  const src = readFileSync(join(root, "server.js"), "utf8");
  const loads = [...src.matchAll(/dotenv\.config\(/g)];

  expect(loads.length, "server.js should call dotenv.config() exactly once").toBe(1);
  expect(
    /path\.join\(\s*__dirname\s*,\s*["']server["']\s*,\s*["']\.env["']\s*\)/.test(src),
    "server.js references server/.env again — the silent-shadow fallback is back."
  ).toBe(false);
});
