import { test as base, expect } from "@playwright/test";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

/* Opt-in runtime coverage for the V3 browser specs (V3-CUTOVER.md §5).
 *
 * The graph's "17 of 29 V3 files have no spec" is structurally wrong — Playwright
 * drives a browser and never imports the modules, so no STATIC edge can exist.
 * The only honest answer is a runtime one, and the only place it can be taken is
 * inside the page while the specs are driving it.
 *
 * ⚠ WITH `V3_COVERAGE` UNSET THIS EXPORTS `base` ITSELF — not a no-op extension
 * of it. `test.extend()` builds a new test type with its own fixture chain even
 * when every override is a pass-through, and the everyday suite (and the pre-push
 * gate) must not pay for, or be perturbed by, a measurement lane. Off is the same
 * object the specs imported before this file existed.
 *
 *   V3_COVERAGE=1 npx playwright test tests/v3-*.spec.js
 *   node scripts/verify/v3-coverage.mjs
 *
 * Raw V8 output only — no interpretation here. The `source` field is dropped
 * (it is the whole ~110 kB bundle, per entry, per test); the aggregator reads
 * the bundle from dist/ instead, which is the same text by construction.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RAW_DIR = process.env.V3_COVERAGE_DIR
  || path.resolve(__dirname, "../../coverage/raw-browser");

let seq = 0;

export const test = process.env.V3_COVERAGE
  ? base.extend({
      page: async ({ page }, use, testInfo) => {
        /* resetOnNavigation MUST be false: every V3 spec starts coverage before
           its page.goto("/v3/"), and the default would throw away everything up
           to and including the navigation that loads the bundle. */
        await page.coverage.startJSCoverage({ resetOnNavigation: false });

        let entries = [];
        try {
          await use(page);
        } finally {
          /* A failing test still measured something, and a spec that closes its
             own page leaves nothing to stop — neither is a reason to lose the
             run, so this never throws out of the fixture. */
          try {
            entries = await page.coverage.stopJSCoverage();
          } catch {
            entries = [];
          }
        }

        const kept = entries
          .filter((e) => e.url && e.url.includes("/assets/") && e.url.endsWith(".js"))
          .map((e) => ({ url: e.url, functions: e.functions }));
        if (!kept.length) return;

        fs.mkdirSync(RAW_DIR, { recursive: true });
        const slug = `${path.basename(testInfo.file)}-${testInfo.title}`
          .replace(/[^a-z0-9]+/gi, "-")
          .slice(0, 90);
        fs.writeFileSync(
          path.join(RAW_DIR, `${String(seq++).padStart(4, "0")}-${slug}.json`),
          JSON.stringify(kept)
        );
      }
    })
  : base;

export { expect };
