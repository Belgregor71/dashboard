import { test, expect } from "@playwright/test";
import { existsSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

/**
 * Design-system rollout WP-C (docs/design/DESIGN_ROLLOUT.md) — the un-chromed hero.
 *
 * With features.bareHero ON, <body> gets .bare-hero: the #focus-hero container box
 * is stripped (no background/border) and the line is fixed-centred; the idle
 * concierge fallback carries a .concierge class so it renders matte (no glyph
 * glow, lower ink). The stack is bottom-anchored. OFF (default) is byte-identical.
 *
 * Driven through the attention hooks (presence + attention on) so we can force a
 * scored hero vs the concierge fallback deterministically.
 */

const distIndex = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "dist", "index.html");

test.beforeAll(() => {
  if (!existsSync(distIndex)) {
    throw new Error("dist/index.html missing — run `npm run build` before `npm test`");
  }
});

const MIDDAY = new Date("2026-07-06T12:00:00");

function enableFlags(bareHero) {
  return (page) =>
    page.route("**/js/config.js", async (route) => {
      const res = await route.fetch();
      const body =
        (await res.text()) +
        "\nwindow.CONFIG.features.presenceRuntime = true;" +
        "\nwindow.CONFIG.features.attentionEngine = true;" +
        `\nwindow.CONFIG.features.bareHero = ${bareHero};` +
        // The temporal spine (default-on since 2026-08-01) replaces this surface —
        // it hides #focus-hero and #focus-stack outright. This spec asserts the
        // hero/stack surface itself, which is now the ROLLBACK path, so it pins the
        // spine off deliberately: this is the state a one-line revert returns the
        // kiosk to, and it has to keep working.
        "\nwindow.CONFIG.features.temporalSpine = false;" +
        /* ⚠⚠ AND THE VOICE LANE, WHICH IS A CROSS-TEST CHANNEL — not a flag
           preference. This was the "populated stack never overlaps the centred
           hero" flake: green in isolation, red in a full parallel run, and the
           spec's own load-margin poll below could not fix it because it was
           never about being slow.

           voiceSession is default-ON, so this page opens
           `new EventSource("/api/voice/stream")` (core/voiceSession.js). That
           stream is fed by `voiceBus`, which is PROCESS-WIDE: a POST to
           /api/voice/transcript is fanned out to EVERY connected page. The
           suite shares one server across workers, and tests/api.spec.js and
           tests/voice-session.spec.js both post transcripts — so a voice spec
           in another worker drives THIS page into submitTranscripts(), which
           does setMode(MODES.VOICE).

           updateAttention() then takes the non-glance/dwell branch: hideHero(),
           and `items = mode === "dwell" ? sel.stack : []` empties the stack. The
           hero's box goes to 0 and never comes back, which is why the failure
           artifact showed an empty <main> with the voice chip lit.

           Reproduced deterministically 2026-08-20 by posting ONE transcript
           mid-test — voice on: {h:0, pres:"voice", items:0}; pinned off:
           {h:200, pres:"dwell", items:2}.

           Flag-off opens no connection at all (see initTranscriptStream), so
           this makes the page unreachable from the bus rather than merely
           ignoring it. Any spec that drives the attention surface on
           /index.html has the same exposure. */
        "\nwindow.CONFIG.features.voiceSession = false;" +
        // Pin the BOM warnings entity to one that never exists: a real live warning
        // (via HA) is an interrupt-band candidate (95) that outranks the forced test
        // candidates and breaks the hero assertions. Must go through __DASH_CONFIG__ —
        // core/config.js builds the module CONFIG from it (bom.js never reads window.CONFIG).
        '\nwindow.__DASH_CONFIG__ = Object.assign({}, window.__DASH_CONFIG__,' +
        ' { weather: { bom: { warningsEntityId: "sensor.__no_live_warnings__" } } });\n';
      await route.fulfill({ response: res, body });
    });
}

test("bare hero on: container stripped, scored glyph glows, concierge goes matte", async ({ page }) => {
  const pageErrors = [];
  page.on("pageerror", (err) => pageErrors.push(err.message));
  await enableFlags(true)(page);
  await page.clock.setFixedTime(MIDDAY);

  await page.goto("/index.html");
  await page.waitForFunction(
    () => typeof window.__attention === "function" && typeof window.__forceCandidate === "function"
  );

  await expect(page.locator("body")).toHaveClass(/bare-hero/);

  // A scored hero: the container box is gone and the glyph carries the glow.
  await page.evaluate(() => {
    window.__forceCandidate([{ id: "t-a", source: "test", score: 80, icon: "🌧️", text: "Rain soon", cooldownMs: 0 }]);
    window.__presence("dwell");
  });
  await expect.poll(() => page.evaluate(() => window.__attention().hero?.id)).toBe("t-a");
  const hero = page.locator("#focus-hero");
  await expect(hero).not.toHaveClass(/is-hidden/);
  await expect(hero).not.toHaveClass(/concierge/);

  const scored = await page.evaluate(() => {
    const h = document.getElementById("focus-hero");
    const cs = getComputedStyle(h);
    const glyph = getComputedStyle(document.getElementById("focus-hero-icon"));
    return { bg: cs.backgroundImage, borderTop: cs.borderTopStyle, position: cs.position, glyphFilter: glyph.filter };
  });
  expect(scored.bg).toBe("none");          // no glass gradient behind the line
  expect(scored.borderTop).toBe("none");   // no container border
  expect(scored.position).toBe("fixed");   // centred, out of flow
  expect(scored.glyphFilter).toContain("drop-shadow"); // borrowed-light glow

  // The matte concierge variant (the AI upstream is stubbed off in tests, so add
  // the class directly and assert the CSS: lower ink + the glyph loses its glow).
  const matte = await page.evaluate(() => {
    const h = document.getElementById("focus-hero");
    h.classList.add("concierge");
    const text = getComputedStyle(document.getElementById("focus-hero-text")).color;
    const glyph = getComputedStyle(document.getElementById("focus-hero-icon")).filter;
    h.classList.remove("concierge");
    return { text, glyph };
  });
  expect(matte.text).toBe("rgba(238, 243, 251, 0.78)"); // matte ink .78
  expect(matte.glyph).toBe("none");                     // no glow on the concierge glyph

  expect(pageErrors, `uncaught page errors:\n${pageErrors.join("\n")}`).toHaveLength(0);
});

test("bare hero off: container intact, no concierge class (byte-identical)", async ({ page }) => {
  const pageErrors = [];
  page.on("pageerror", (err) => pageErrors.push(err.message));
  await enableFlags(false)(page);
  await page.clock.setFixedTime(MIDDAY);

  await page.goto("/index.html");
  await page.waitForFunction(() => typeof window.__forceCandidate === "function");

  await expect(page.locator("body")).not.toHaveClass(/bare-hero/);

  await page.evaluate(() => {
    window.__forceCandidate([{ id: "t-a", source: "test", score: 80, icon: "🌧️", text: "Rain soon", cooldownMs: 0 }]);
    window.__presence("glance");
  });

  const off = await page.evaluate(() => {
    const cs = getComputedStyle(document.getElementById("focus-hero"));
    return { position: cs.position, hasConcierge: document.getElementById("focus-hero").classList.contains("concierge") };
  });
  expect(off.position).not.toBe("fixed"); // still in flow
  expect(off.hasConcierge).toBe(false);   // no concierge class off-flag

  expect(pageErrors, `uncaught page errors:\n${pageErrors.join("\n")}`).toHaveLength(0);
});

test("the attention surface is scoped to home — hidden on the force-only views", async ({ page }) => {
  const pageErrors = [];
  page.on("pageerror", (err) => pageErrors.push(err.message));
  await enableFlags(true)(page);
  await page.clock.setFixedTime(MIDDAY);

  await page.goto("/index.html");
  await page.waitForFunction(() => typeof window.__forceCandidate === "function" && typeof window.__switchView === "function");

  // A hero is up on home.
  await page.evaluate(() => {
    window.__forceCandidate([{ id: "t-a", source: "test", score: 80, icon: "🌧️", text: "Rain soon", cooldownMs: 0 }]);
    window.__presence("dwell");
  });
  await expect.poll(() => page.evaluate(() => window.__attention().hero?.id)).toBe("t-a");
  expect(await page.evaluate(() => getComputedStyle(document.getElementById("focus-hero")).display)).not.toBe("none");

  // Force-navigate to the status view: the hero + stack must not bleed over it.
  await page.evaluate(() => window.__switchView("status", { force: true }));
  await expect.poll(() => page.evaluate(() => document.body.dataset.view)).toBe("status");
  expect(await page.evaluate(() => getComputedStyle(document.getElementById("focus-hero")).display)).toBe("none");
  expect(await page.evaluate(() => getComputedStyle(document.getElementById("focus-stack")).display)).toBe("none");

  expect(pageErrors, `uncaught page errors:\n${pageErrors.join("\n")}`).toHaveLength(0);
});

test("a populated stack never overlaps the centred hero", async ({ page }) => {
  const pageErrors = [];
  page.on("pageerror", (err) => pageErrors.push(err.message));
  await enableFlags(true)(page);
  await page.clock.setFixedTime(MIDDAY);

  await page.goto("/index.html");
  await page.waitForFunction(
    () => typeof window.__attention === "function" && typeof window.__forceCandidate === "function"
  );

  // The shape from the 2026-07-20 kiosk photo: a hero long enough to wrap to two
  // lines, plus two cards and the resting note under it. Unguarded this measured
  // 104px of overlap (hero 522–798 vs stack 694–972 at 1920x1080).
  await page.evaluate(() => {
    window.__forceCandidate([
      { id: "t-hero", source: "test", score: 90, icon: "⚠️", text: "Marine Wind Warning for Queensland", cooldownMs: 0 },
      { id: "t-b", source: "test", score: 80, icon: "🚗", title: "Greg – 11 min · Brett – 17 min", text: "Greg – 11 min · Brett – 17 min", cooldownMs: 0 },
      { id: "t-c", source: "test", score: 70, icon: "🕰️", title: "On this day — Dean and Brett up to no good.", text: "On this day — Dean and Brett up to no good.", cooldownMs: 0 }
    ]);
    window.__presence("dwell");
  });
  await expect.poll(() => page.evaluate(() => window.__attention().hero?.id)).toBe("t-hero");
  await expect.poll(() => page.evaluate(() => document.querySelectorAll("#focus-stack .focus-stack__item").length)).toBe(2);

  /* ⚠ WAIT FOR THE HERO TO BE LAID OUT, not merely for the data to be right.
     Observed failing once in a full-suite run and passing in isolation: the two
     polls above are satisfied by the ENGINE (hero id) and by the STACK (item
     count), and neither says the hero element itself has a box yet. Under load
     the rect came back all zeros, so `heroBottom <= stackTop` passed for the
     worst possible reason and `heroTop >= 180` reported 0. A geometry assertion
     has to wait on geometry. */
  await expect
    .poll(() => page.evaluate(() => document.getElementById("focus-hero").getBoundingClientRect().height))
    .toBeGreaterThan(0);

  const geom = await page.evaluate(() => {
    const h = document.getElementById("focus-hero").getBoundingClientRect();
    const s = document.getElementById("focus-stack").getBoundingClientRect();
    return { heroTop: h.top, heroBottom: h.bottom, stackTop: s.top, lines: h.height };
  });
  expect(geom.heroBottom, `hero bottom ${geom.heroBottom} must clear stack top ${geom.stackTop}`)
    .toBeLessThanOrEqual(geom.stackTop);
  expect(geom.heroTop).toBeGreaterThanOrEqual(180); // never climbs into the top row

  // With no stack the design offset is untouched — the lift resets to 0.
  await page.evaluate(() => {
    window.__forceCandidate([{ id: "t-hero", source: "test", score: 90, icon: "⚠️", text: "Marine Wind Warning for Queensland", cooldownMs: 0 }]);
    window.__presence("glance");
  });
  await expect
    .poll(() => page.evaluate(() => getComputedStyle(document.body).getPropertyValue("--hero-lift").trim()))
    .toBe("0px");

  expect(pageErrors, `uncaught page errors:\n${pageErrors.join("\n")}`).toHaveLength(0);
});
