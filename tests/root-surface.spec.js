import { test, expect } from "@playwright/test";
import { readFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

import { ROOT_ENTRY, staleSurfaceWarning } from "../server/config.js";

/**
 * What `/` serves — the one surface (V3) since the incumbent was retired on
 * 2026-10-03 (docs/audit/INCUMBENT-RETIREMENT-2026-10-03.md).
 *
 * The kiosk opens a bare `http://localhost:3000`, so whatever `/` serves is
 * what is on the wall. Pinned here:
 *
 *   1. `/` and `/v3/` are the same V3 document, byte for byte;
 *   2. `/index.html`, the incumbent's old address, redirects to `/` instead of
 *      404ing a bookmark or a stale kiosk URL;
 *   3. the root route stays ABOVE the dist static mount in server.js.
 *
 * (3) has bitten before: serve-static answers `/` with dist/index.html by
 * itself (`index` defaults to "index.html"), so a root handler mounted after it
 * was dead code until 2026-08-09. With no dist/index.html any more, a sunk
 * route would now 404 the wall — the source guard sees it before a deploy does.
 */

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

const V3_SIGNATURE = /<title>\s*V3\s*<\/title>/i;
// The incumbent's body tag. Nothing on the wall may carry it again.
const INCUMBENT_SIGNATURE = /<body[^>]*data-view="home"/i;

test.describe("root surface", () => {
  test("/ serves V3, byte-for-byte the document at /v3/", async ({ request }) => {
    const rootRes = await request.get("/");
    expect(rootRes.status()).toBe(200);
    expect(rootRes.headers()["content-type"] || "").toContain("text/html");
    const rootHtml = await rootRes.text();
    expect(rootHtml).toMatch(V3_SIGNATURE);
    expect(rootHtml).not.toMatch(INCUMBENT_SIGNATURE);

    const v3Res = await request.get("/v3/");
    expect(v3Res.status()).toBe(200);
    expect(rootHtml).toBe(await v3Res.text());
  });

  test("the incumbent's old address redirects to / rather than 404ing", async ({ request }) => {
    const res = await request.get("/index.html", { maxRedirects: 0 });
    expect(res.status()).toBe(302);
    expect(res.headers().location).toBe("/");
    // Followed, it lands on the wall.
    const followed = await request.get("/index.html");
    expect(followed.status()).toBe(200);
    expect(await followed.text()).toMatch(V3_SIGNATURE);
  });

  test("the root route is registered above the dist static mount", () => {
    const source = readFileSync(path.join(ROOT, "server.js"), "utf8");
    const rootRoute = source.indexOf('app.get("/",');
    const distMount = source.indexOf('express.static(path.join(__dirname, "dist"))');
    expect(rootRoute, 'no app.get("/") handler found in server.js').toBeGreaterThan(-1);
    expect(distMount, "no express.static(dist) mount found in server.js").toBeGreaterThan(-1);
    expect(
      rootRoute,
      "app.get(\"/\") sits below express.static(dist), which answers `/` itself"
    ).toBeLessThan(distMount);
  });

  test("the root entry is the V3 build", () => {
    expect(ROOT_ENTRY).toBe("v3/index.html");
  });
});

test.describe("a stale V3_DEFAULT", () => {
  // It used to be the surface rollback. A line someone still believes is a
  // lever must be reported, not silently ignored.
  test("is warned about whatever its value", () => {
    for (const v of ["0", "1", "false", "true"]) {
      const w = staleSurfaceWarning({ V3_DEFAULT: v });
      expect(w, `V3_DEFAULT=${v} produced no warning`).toContain(`V3_DEFAULT=${v}`);
      expect(w).toContain("no longer does anything");
    }
  });

  test("absent or blank says nothing", () => {
    expect(staleSurfaceWarning({})).toBeNull();
    expect(staleSurfaceWarning({ V3_DEFAULT: "  " })).toBeNull();
    expect(staleSurfaceWarning(undefined)).toBeNull();
  });
});
