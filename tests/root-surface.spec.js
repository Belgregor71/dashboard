import { test, expect } from "@playwright/test";
import { readFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

import { resolveRootSurface, SURFACE_ENTRY, DEFAULT_ROOT_SURFACE } from "../server/config.js";

/**
 * The V3 cutover contract (docs/design/V3-CUTOVER.md §3).
 *
 * The kiosk opens a bare `http://localhost:3000`, so whatever `/` serves is
 * what is on the wall. This spec pins three things that the flip must never
 * break:
 *
 *   1. both surfaces stay reachable at fixed, flag-independent URLs, so the one
 *      that loses `/` is never stranded;
 *   2. `/` serves exactly the surface the flag names — byte-for-byte the same
 *      document, so the off state is not merely "similar" to before;
 *   3. the root route stays ABOVE the dist static mount in server.js.
 *
 * (3) is the one that has actually bitten. serve-static answers `/` with
 * dist/index.html by itself (`index` defaults to "index.html"), so a root
 * handler mounted after it is dead code — which is what server.js:167 was
 * until 2026-08-09. That failure is invisible at runtime while the flag is
 * off: `/` keeps serving the incumbent, correctly, for the wrong reason. Only
 * a source-order assertion can see it from the off state, so both a runtime
 * contract and a source guard are kept here deliberately.
 */

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

// What the running test server resolved. playwright.config.js spreads
// process.env into the webServer, and deliberately does NOT pin V3_DEFAULT, so
// the suite exercises the committed default — and `V3_DEFAULT=1 npm test`
// exercises the flipped state end to end, with this file tracking it rather
// than needing an edit.
const EXPECTED_SURFACE = resolveRootSurface(process.env);

/** Markers that only ever appear in one of the two built documents. */
const SIGNATURE = {
  incumbent: /<body[^>]*data-view="home"/i,
  v3: /<title>\s*V3\s*<\/title>/i
};

const URL_FOR = {
  incumbent: "/index.html",
  v3: "/v3/"
};

test.describe("root surface", () => {
  test("both surfaces are reachable at their own fixed URLs", async ({ request }) => {
    for (const surface of ["incumbent", "v3"]) {
      const res = await request.get(URL_FOR[surface]);
      expect(res.status(), `${URL_FOR[surface]} must always serve the ${surface} build`).toBe(200);
      const html = await res.text();
      expect(html, `${URL_FOR[surface]} did not look like the ${surface} document`).toMatch(
        SIGNATURE[surface]
      );
      // …and is unmistakably NOT the other one.
      const other = surface === "incumbent" ? "v3" : "incumbent";
      expect(html).not.toMatch(SIGNATURE[other]);
    }
  });

  test(`/ serves the ${EXPECTED_SURFACE} surface, byte-for-byte`, async ({ request }) => {
    const rootRes = await request.get("/");
    expect(rootRes.status()).toBe(200);
    expect(rootRes.headers()["content-type"] || "").toContain("text/html");

    const rootHtml = await rootRes.text();
    const namedHtml = await (await request.get(URL_FOR[EXPECTED_SURFACE])).text();

    // Byte identity, not "contains the right marker": the off state has to be
    // the same document the kiosk was already being served, not a lookalike.
    expect(rootHtml).toBe(namedHtml);

    const other = EXPECTED_SURFACE === "incumbent" ? "v3" : "incumbent";
    expect(rootHtml, "/ is serving the surface the flag did NOT name").not.toMatch(SIGNATURE[other]);
  });

  test("the root route is registered above the dist static mount", () => {
    const source = readFileSync(path.join(ROOT, "server.js"), "utf8");

    const rootRoute = source.indexOf('app.get("/",');
    const distMount = source.indexOf('express.static(path.join(__dirname, "dist"))');

    expect(rootRoute, 'no app.get("/") handler found in server.js').toBeGreaterThan(-1);
    expect(distMount, "no express.static(dist) mount found in server.js").toBeGreaterThan(-1);
    expect(
      rootRoute,
      "app.get(\"/\") sits below express.static(dist), which answers `/` itself — " +
        "the handler is dead and the V3 flag cannot take effect"
    ).toBeLessThan(distMount);
  });

  test("the committed default is off until V3 has been seen on the kiosk", () => {
    // Project rule: ship flag-gated and default-off, flip only after live
    // verification. When that flip happens this expectation is the thing to
    // change — deliberately, in the same commit, not as a surprise.
    expect(["incumbent", "v3"]).toContain(DEFAULT_ROOT_SURFACE);
    expect(SURFACE_ENTRY[DEFAULT_ROOT_SURFACE]).toBeTruthy();
  });
});

test.describe("root surface flag resolution", () => {
  // A pure unit check of the override, so both directions are covered without
  // needing two server boots.
  test("V3_DEFAULT overrides the committed default in both directions", () => {
    expect(resolveRootSurface({ V3_DEFAULT: "1" })).toBe("v3");
    expect(resolveRootSurface({ V3_DEFAULT: "true" })).toBe("v3");
    expect(resolveRootSurface({ V3_DEFAULT: "0" })).toBe("incumbent");
    expect(resolveRootSurface({ V3_DEFAULT: "false" })).toBe("incumbent");
  });

  test("an absent or unparseable value falls through to the committed default", () => {
    expect(resolveRootSurface({})).toBe(DEFAULT_ROOT_SURFACE);
    expect(resolveRootSurface({ V3_DEFAULT: "" })).toBe(DEFAULT_ROOT_SURFACE);
    expect(resolveRootSurface({ V3_DEFAULT: "yes" })).toBe(DEFAULT_ROOT_SURFACE);
    expect(resolveRootSurface(undefined)).toBe(DEFAULT_ROOT_SURFACE);
  });
});
