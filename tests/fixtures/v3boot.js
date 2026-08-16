/* Boot V3 with every /api/** answered by the spec.

   Lifted out of v3-subjects.spec.js on 2026-08-16, when a second file needed
   the same thing. The rule it encodes is the one tests/v3-spread.spec.js paid
   for on its first run: what a subject shows is a function of the house's real
   state, so a spec about subjects cannot share one with the house. Every route
   is stubbed, and anything unmatched is a 503 rather than a passthrough — a
   spec that quietly reaches the developer's living room is a spec that passes
   for the wrong reason.

   @param {import("@playwright/test").Page} page
   @param {Record<string, any>} routes  pathname prefix → JSON body, a function
          of the URL, or `null` for a 503. Longest-registered wins by insertion
          order, so register the specific prefix before the general one.
   @param {object} [opts]
   @param {Record<string, boolean>} [opts.features]  window.CONFIG.features
          overrides, applied BEFORE the page's own scripts run. Needed for any
          flag-gated path: the flags default off, and matchIntent will not even
          claim a gated sentence until its feature is on.
   @returns {Promise<{pageErrors: string[]}>}
*/
export async function bootV3(page, routes = {}, { features = null } = {}) {
  const pageErrors = [];
  page.on("pageerror", (err) => pageErrors.push(err.message));

  /* ⚠⚠ A PLAIN ASSIGNMENT HERE DOES NOTHING, and it fails silently — the flag
     reads as off, the sentence is not claimed, and the spec looks like a broken
     feature rather than a broken fixture. `/js/config.js` is a separate <script>
     that runs after every init script and assigns `window.CONFIG` WHOLESALE, so
     an object written beforehand is simply replaced.

     So the override is installed as a SETTER that re-applies itself to whatever
     is assigned. config.js writes its own config; this merges the overrides back
     over the top on the way in, before anything reads it. addInitScript rather
     than an evaluate after goto because the boot stages read their flags once,
     during boot — a flag flipped after load arrives too late for the stage that
     wanted it. */
  if (features) {
    await page.addInitScript((f) => {
      let real;
      Object.defineProperty(window, "CONFIG", {
        configurable: true,
        get() { return real; },
        set(value) {
          real = value ?? {};
          real.features = { ...(real.features ?? {}), ...f };
        }
      });
      window.CONFIG = {};   // so the overrides exist even if nothing assigns
    }, features);
  }

  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    const key = Object.keys(routes).find((k) => url.pathname.startsWith(k));
    if (key) {
      const body = routes[key];
      if (body === null) return route.fulfill({ status: 503, contentType: "application/json", body: "{}" });
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(typeof body === "function" ? body(url) : body)
      });
    }
    // Images are answered as images so a subject's <img> resolves rather than
    // hanging: a pending request is not the same as a failed one and the
    // teardown assertions want a settled DOM.
    if (/\/(thumb|snapshot|live|image|basemap|overlay)/.test(url.pathname)) {
      return route.fulfill({
        status: 200,
        contentType: "image/gif",
        body: Buffer.from("R0lGODlhAQABAAAAACw=", "base64")
      });
    }
    return route.fulfill({ status: 503, contentType: "application/json", body: "{}" });
  });

  await page.goto("/v3/");
  await page.waitForFunction(() => typeof window.__v3 === "function");
  return { pageErrors };
}
