import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { normalizeReport } from "../server/routes/cspReport.js";
import { renderPhotosPage } from "../server/routes/admin.js";

/* Audit 2026-09-10 S1: the CSP shipped report-only with no report-uri, so there
   was no way to confirm zero violations before enforcing it, and the one known
   blocker was the /admin/photos page's inline <script> + onclick. These specs
   hold both halves:
     - the report pipeline: header → POST → tally (contract + normalizer)
     - the admin page: no inline script or handler, AND its external script still
       works under an ENFORCING policy in a real browser. */

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const PAGE_SCRIPT = readFileSync(join(root, "server", "admin", "photos.client.js"), "utf8");

// A unique page path per run, so parallel workers and reruns against a
// reused server never read each other's rows.
const uniq = () => `/csp-spec-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

async function tally(request) {
  const res = await request.get("/api/csp-report");
  expect(res.status()).toBe(200);
  return res.json();
}

// Order matters and is kept by fullyParallel: false: the refusal test reads rows
// the legacy/batch tests above it wrote. Not "serial" mode, which would skip
// every later test after one failure and hide the rest of an injection run.
test.describe("CSP report pipeline", () => {
  test("the policy names its report endpoint", async ({ request }) => {
    const res = await request.get("/api/config");
    const csp = res.headers()["content-security-policy-report-only"];
    expect(csp).toBeTruthy();
    expect(csp).toContain("report-uri /api/csp-report");
  });

  test("GET returns the tally shape", async ({ request }) => {
    const body = await tally(request);
    expect(typeof body.since).toBe("string");
    expect(typeof body.total).toBe("number");
    expect(typeof body.dropped).toBe("number");
    expect(Array.isArray(body.violations)).toBe(true);
  });

  test("a legacy report-uri POST lands in the tally, and repeats count up", async ({ request }) => {
    const page = uniq();
    const report = {
      "csp-report": {
        "document-uri": `http://localhost:3000${page}?x=1`,
        "violated-directive": "script-src-elem",
        "effective-directive": "script-src-elem",
        "blocked-uri": "inline",
        "source-file": `http://localhost:3000${page}`,
        "line-number": 12,
        disposition: "report"
      }
    };
    const send = () =>
      request.post("/api/csp-report", {
        headers: { "Content-Type": "application/csp-report" },
        data: JSON.stringify(report)
      });

    expect((await send()).status()).toBe(204);
    let row = (await tally(request)).violations.find((v) => v.page === page);
    expect(row, "the report never reached the tally").toBeTruthy();
    expect(row.directive).toBe("script-src-elem");
    expect(row.blocked).toBe("inline");
    expect(row.disposition).toBe("report");
    expect(row.count).toBe(1);

    expect((await send()).status()).toBe(204);
    row = (await tally(request)).violations.find((v) => v.page === page);
    expect(row.count).toBe(2);
  });

  test("a Reporting API batch lands too, with the URL cut to its origin", async ({ request }) => {
    const page = uniq();
    const res = await request.post("/api/csp-report", {
      headers: { "Content-Type": "application/reports+json" },
      data: JSON.stringify([
        {
          type: "csp-violation",
          url: `http://localhost:3000${page}`,
          body: {
            documentURL: `http://localhost:3000${page}`,
            effectiveDirective: "img-src",
            blockedURL: "https://art.example.com/cover/123.jpg?token=secret",
            disposition: "enforce"
          }
        }
      ])
    });
    expect(res.status()).toBe(204);
    const row = (await tally(request)).violations.find((v) => v.page === page);
    expect(row, "the batch entry never reached the tally").toBeTruthy();
    expect(row.directive).toBe("img-src");
    expect(row.blocked).toBe("https://art.example.com");
    expect(row.disposition).toBe("enforce");
  });

  /* A near miss, not junk: real report fields WITHOUT the "csp-report" wrapper,
     under a unique page. A normalizer that accepted any object with the right
     keys would record it, so an absent row here is a real refusal. Totals can't
     be compared, because other browser specs load the app under the report-only
     header and their violations land here concurrently. */
  test("a body that is not a CSP report is accepted and recorded as nothing", async ({ request }) => {
    const page = uniq();
    const res = await request.post("/api/csp-report", {
      headers: { "Content-Type": "application/csp-report" },
      data: JSON.stringify({
        "document-uri": `http://localhost:3000${page}`,
        "violated-directive": "img-src",
        "blocked-uri": "inline"
      })
    });
    expect(res.status()).toBe(204);
    const { violations } = await tally(request);
    expect(violations.length, "the tally must not be empty, or this proves nothing").toBeGreaterThan(0);
    expect(violations.some((v) => v.page === page)).toBe(false);
  });

  test("normalizeReport keeps keywords and strips URLs to an origin", () => {
    const legacy = (blocked) =>
      normalizeReport({ "csp-report": { "document-uri": "http://h/x", "violated-directive": "img-src", "blocked-uri": blocked } });
    expect(legacy("inline").blocked).toBe("inline");
    expect(legacy("eval").blocked).toBe("eval");
    expect(legacy("data:image/png;base64,AAAA").blocked).toBe("data");
    expect(legacy("http://192.168.0.179:8123/api/image?token=abc").blocked).toBe("http://192.168.0.179:8123");
    expect(legacy("").blocked).toBe("(none)");
    expect(normalizeReport({ nope: 1 })).toBeNull();
    expect(normalizeReport(null)).toBeNull();
    expect(normalizeReport({ type: "deprecation", body: {} })).toBeNull();
  });
});

test.describe("/admin/photos under a CSP", () => {
  test("the page carries no inline script and no on*= handler", () => {
    const html = renderPhotosPage(["a.jpg", 'we"ird<name>.png']);
    // Assert the page is the page before asserting what it lacks.
    expect(html).toContain('id="upload-btn"');
    expect(html).toContain('<script src="/admin/photos.js"></script>');
    expect(html).toContain("we&quot;ird&lt;name&gt;.png");

    const scriptTags = [...html.matchAll(/<script\b[^>]*>/gi)].map((m) => m[0]);
    expect(scriptTags).toEqual(['<script src="/admin/photos.js">']);
    expect(html).not.toMatch(/\son[a-z]+\s*=/i);
  });

  test("every element the script reaches for exists in the page", () => {
    const html = renderPhotosPage([]);
    const ids = [...PAGE_SCRIPT.matchAll(/getElementById\("([^"]+)"\)/g)].map((m) => m[1]);
    expect(ids.length).toBeGreaterThanOrEqual(5);
    for (const id of ids) expect(html, `#${id} is missing from the page`).toContain(`id="${id}"`);
  });

  test("the script route fails closed without credentials", async ({ request }) => {
    const res = await request.get("/admin/photos.js");
    // 403 when ADMIN_PASSWORD is unset (the test server), 401 when it is set.
    expect([401, 403]).toContain(res.status());
    expect(await res.text()).not.toContain("addEventListener");
  });

  /* The half no string check can prove: under an ENFORCING policy the external
     script must actually run and the button must actually be wired. Put the
     onclick back instead and this goes red, because the enforcing policy
     refuses the inline handler. */
  test("upload is wired and runs under an enforcing script-src 'self'", async ({ page }) => {
    const ENFORCE = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:";
    await page.route("**/admin/photos", (route) =>
      route.fulfill({
        status: 200,
        headers: { "content-type": "text/html", "content-security-policy": ENFORCE },
        body: renderPhotosPage([])
      })
    );
    await page.route("**/admin/photos.js", (route) =>
      route.fulfill({ status: 200, headers: { "content-type": "application/javascript" }, body: PAGE_SCRIPT })
    );

    const violations = [];
    await page.exposeFunction("__cspViolation", (v) => violations.push(v));
    await page.addInitScript(() => {
      document.addEventListener("securitypolicyviolation", (e) =>
        window.__cspViolation(`${e.effectiveDirective} ${e.blockedURI}`)
      );
    });

    await page.goto("/admin/photos");
    await expect(page.locator("#upload-btn")).toBeVisible();
    await page.locator("#upload-btn").click();
    await expect(page.locator("#status")).toHaveText("Choose at least one file.");
    await expect(page.locator("#status")).toHaveClass("err");
    expect(violations).toEqual([]);
  });
});
