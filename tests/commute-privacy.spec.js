import { test, expect } from "@playwright/test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, extname } from "node:path";

/* ═══════════════════════════════════════════════════════════════════════════
   THE COMMUTE ADDRESSES MUST NOT COME BACK.

   `src/js/config/config.js` held COMMUTE_ORIGIN — this house's street address —
   as an exported constant. That file is tracked in a PUBLIC repository AND
   bundled to the browser, so the address was readable in the repo, in dist/,
   and in the query string of every /api/commute request the wall made.

   It is a `.env` value on the server now. The value of fixing that is entirely
   in it STAYING fixed, and the failure mode is quiet: a caller written from
   memory would pass `origin=` again, the route would ignore it, and everything
   would keep working while the address sat in the bundle. So this file guards
   the SHAPE rather than the behaviour — you cannot leak an address you have no
   way to name.
   ═══════════════════════════════════════════════════════════════════════════ */

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

test("no client file names a commute address, or exports one", () => {
  /* The import side. A constant nothing imports is still in the bundle and
     still in the public repo, so this looks for the DECLARATION, not the use. */
  const offenders = [];
  for (const file of jsFilesUnder(join(root, "src"))) {
    const src = readFileSync(file, "utf8");
    for (const m of src.matchAll(/^\s*export\s+const\s+(COMMUTE_[A-Z0-9_]*(?:ORIGIN|DEST)[A-Z0-9_]*)/gm)) {
      offenders.push(`${file.slice(root.length + 1)} exports ${m[1]}`);
    }
  }
  expect(offenders, `commute addresses belong in the server's .env, not the bundle:\n${offenders.join("\n")}`)
    .toEqual([]);
});

test("no client file puts an origin in a commute URL", () => {
  /* The wire side. Even with the constants gone, a caller that built
     `/api/commute?origin=...` from anywhere would put an address in the query
     string of a request the browser makes — and the route ignores it, so it
     would look like it worked. */
  /* ⚠ COMMENTS ARE STRIPPED, and testing the line's first characters is not
     enough to do it. This repo writes block comments whose continuation lines
     carry no marker at all — the two files that used to build this URL now
     quote it inside one, explaining why it went. A guard that cannot tell a
     warning from the thing it warns about would force that explanation to be
     deleted, which is the opposite of what is wanted. A comment makes no
     requests; only code does. */
  const stripComments = (src) =>
    src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[^\n]*?\/\/[^\n]*$/gm, "");

  const offenders = [];
  for (const file of jsFilesUnder(join(root, "src"))) {
    const code = stripComments(readFileSync(file, "utf8"));
    for (const line of code.split("\n")) {
      if (line.includes("/api/commute") && /origin=/.test(line)) {
        offenders.push(`${file.slice(root.length + 1)}: ${line.trim()}`);
      }
    }
  }
  expect(offenders, `the route routes FROM HOME by definition — drop the origin:\n${offenders.join("\n")}`)
    .toEqual([]);
});

/* ── The route's own contract ─────────────────────────────────────────────────
   Upstreams may be down and TOMTOM_API_KEY may be absent on any machine, so
   nothing here asserts a drive time. What is asserted is the shape, and that
   the two ways of asking are the only two there are.
─────────────────────────────────────────────────────────────────────────── */

test("GET /api/commute/legs names the legs and NEVER their addresses", async ({ request }) => {
  const res = await request.get("/api/commute/legs");
  expect(res.status()).toBe(200);
  const body = await res.json();

  expect(Array.isArray(body.legs)).toBe(true);
  for (const leg of body.legs) {
    expect(typeof leg.id).toBe("string");
    expect(typeof leg.label).toBe("string");
    /* The whole point of this endpoint. An address field here would put the
       addresses back on the client by a different door. */
    expect(Object.keys(leg).sort()).toEqual(["id", "label"]);
  }
});

test("GET /api/commute/all is per-leg — one dead leg is null, not a dead request", async ({ request }) => {
  const res = await request.get("/api/commute/all");
  // 500 is legitimate here: no TomTom key, or no COMMUTE_ORIGIN configured.
  expect([200, 500]).toContain(res.status());
  if (res.status() !== 200) return;

  const body = await res.json();
  expect(Array.isArray(body.legs)).toBe(true);
  for (const leg of body.legs) {
    expect(typeof leg.label).toBe("string");
    expect(leg.seconds === null || typeof leg.seconds === "number").toBe(true);
    expect(Object.keys(leg)).not.toContain("destination");
  }
});

test("an origin handed in by a caller is not a way to ask", async ({ request }) => {
  /* THE GUARD THAT MATTERS. If the route still honoured `origin`, this would
     route from the caller's address and answer 200 — and the old client code
     would keep working, which is exactly how the address would come back. */
  const res = await request.get("/api/commute?origin=1%20Somewhere%20St%2C%20Nowhere");
  expect([400, 500]).toContain(res.status());
  if (res.status() === 400) {
    expect((await res.json()).error).toContain("leg or destination");
  }
});

test("an unknown leg is a 404, not a silent fallback to some other drive", async ({ request }) => {
  const res = await request.get("/api/commute?leg=nobody");
  expect([404, 500]).toContain(res.status());
});
