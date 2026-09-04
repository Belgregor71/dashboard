import { test, expect } from "./fixtures/coverage.js";
import { worstFault } from "../src/v3/core/health.js";
import { __resetBoot } from "../src/v3/core/boot.js";

/* Phase 6 — the invisible layer.

   ⚠ THE THING THIS PHASE MOSTLY PROVED IS THAT IT WAS ALREADY DONE. The
   watchdog (server/services/healthService.js) and the self-heal
   (recoveryService.js) are SERVER-side, started from app.listen and driven by
   the Home Assistant manager. They do not know which URL Chromium is showing,
   so they have been running on V3 since the day V3 existed. There is nothing
   to port and no test here asserts otherwise.

   What V3 lacked was any way to tell the ROOM. These are the tests for that:
   which fault gets named, and the readout you can ask for. */

/* ── Which fault gets named ─────────────────────────────────────────────────
   Pure, so it runs without a browser — the same reason the fast lane's tests do.
─────────────────────────────────────────────────────────────────────────── */

/* ⚠ THE LABELS ARE THE SERVER'S REAL ONES, and that is load-bearing rather
   than decorative. A first draft used the feed id as the label, so every
   fixture label was one short word — and the "no label wraps" assertion below
   passed happily while the live wall was wrapping four of nine labels onto a
   second line. A fixture that cannot produce the defect cannot catch it.
   Mirrors the FEEDS map in server/services/healthService.js. */
const LABELS = {
  ha: "Home Assistant",
  wan: "Internet",
  motion: "Motion events",
  weather: "Weather",
  calendar: "Calendar",
  cameras: "Camera snapshots",
  ai: "AI briefings",
  tts: "Text-to-speech"
};

const feed = (id, level, detail = null) => ({ id, label: LABELS[id] ?? id, level, detail });

test.describe("the fault worth naming", () => {
  /* ⚠ worstFault's FIRST act is `bootFault()` — the surface's own boot outranks
     every feed (cutover §4) — so a test about feeds has an unstated precondition
     that boot is clean. It is not clean by default: `boot.js` keeps its stages
     and ticks at module level and every node-side spec in a worker shares one
     instance, so v3-boot.spec.js's deliberately-broken "rail" tick reached here
     and made "a healthy house" name a fault. That file now cleans up after
     itself; this makes the precondition this file depends on explicit rather
     than inherited. */
  test.beforeEach(() => __resetBoot());

  test("a healthy house names nothing", () => {
    expect(worstFault({ feeds: [feed("ha", "ok"), feed("wan", "ok")] })).toBeNull();
  });

  test("⚠ a WARN is not worth the wall", () => {
    /* Weather at 46 minutes is late, not broken. A surface that reports
       lateness teaches the room to ignore it by the time something is actually
       wrong, which is the failure mode this whole phase exists to avoid. */
    expect(worstFault({ feeds: [feed("weather", "warn", "no success for 46m")] })).toBeNull();
  });

  test("⚠ ONE CAUSE, NOT THREE SYMPTOMS — the internet outranks what it broke", () => {
    /* healthService's own comment: "when the internet is down, weather + AI +
       news all fail SEPARATELY and the chip reads like three unrelated
       faults." The wall has room for one sentence, so it must be the upstream
       one. This is the assertion that keeps that ordering honest. */
    const fault = worstFault({
      feeds: [
        feed("weather", "error", "no success for 2h"),
        feed("ai", "error", "2 consecutive failures"),
        feed("wan", "error", "internet is down"),
        feed("calendar", "error", "no success for 4h")
      ]
    });
    expect(fault.id).toBe("wan");
    expect(fault.text).toBe("The internet's down.");
  });

  test("a feed this module has never heard of is still named", () => {
    // A feed the server grows later must not become invisible precisely
    // because it is new.
    const fault = worstFault({ feeds: [{ id: "sonarr", label: "Sonarr", level: "error", detail: "down" }] });
    expect(fault.id).toBe("sonarr");
    expect(fault.text).toContain("Sonarr");
  });

  test("⚠ NOT LOADED IS NOT EMPTY — an unreadable health is not a healthy house", () => {
    // The bug class this codebase has produced four times. None of these may
    // be read as "everything is fine".
    expect(worstFault(null)).toBeNull();
    expect(worstFault(undefined)).toBeNull();
    expect(worstFault({})).toBeNull();
    expect(worstFault({ feeds: "not an array" })).toBeNull();
  });
});

/* ── The surface ────────────────────────────────────────────────────────────
   Every /api/** is answered here. A spec about the readout cannot share a
   house with the developer's living room — the trap tests/v3-spread.spec.js
   paid for on its first run.
─────────────────────────────────────────────────────────────────────────── */

const HEALTHY = {
  overall: "ok",
  updatedAt: Date.now(),
  feeds: [feed("ha", "ok"), feed("wan", "ok"), feed("motion", "ok"), feed("weather", "ok")],
  recoveries: []
};

const BROKEN = {
  overall: "error",
  updatedAt: Date.now(),
  feeds: [feed("wan", "error", "internet is down"), feed("weather", "error", "no success for 2h")],
  recoveries: [{ at: Date.now(), kind: "detection-switch", action: "re-armed switch.kitchen_motion_detection", ok: true }]
};

/* The whole board, which is what the wall actually renders — including the four
   labels long enough to wrap ("Home Assistant", "Motion events", "Camera
   snapshots", "Text-to-speech"). The geometry assertions use this one. */
const FULL = {
  overall: "error",
  updatedAt: Date.now(),
  feeds: [
    feed("ha", "ok"),
    feed("wan", "error", "internet is down"),
    feed("motion", "warn", "no success for 26h"),
    feed("weather", "error", "no success for 2h"),
    feed("calendar", "ok"),
    feed("cameras", "ok"),
    feed("ai", "error", "2 consecutive failures"),
    feed("tts", "ok")
  ],
  recoveries: []
};

const METRICS = { cpuLoadPercent: 7, cpuCount: 8, uptimeSeconds: 90_000, tempC: 41.2, hostname: "g11" };

async function bootV3(page, { health = HEALTHY, metrics = METRICS } = {}) {
  const pageErrors = [];
  page.on("pageerror", (err) => pageErrors.push(err.message));

  /* ⚠⚠ `v3ArchivePlane` IS PINNED OFF, and it is load-bearing rather than
     tidy-mindedness. The one-plane archive puts the DAY at the top-left corner
     and steps the fault pill down to y168 to make room for it, so the pill's
     `top: 96` assertion below is an assertion about WHICH COMPOSITION IS UP —
     not about the pill. Measured by flipping the flag on before it shipped:
     this file went red at "the pill is MEASURED and sits on the floor", 96
     against 168, which is the exact shape of the ambientSubstrate lesson (a
     flag flip breaking specs that assumed the old default).

     Pinned rather than made tolerant, because "the pill sits at the safe inset
     with nothing above it" is a true and worth-keeping fact about the surface
     that is on the wall. The plane's own stepped geometry — and that the card
     clears the pill's furthest reach — is measured in tests/v3-archive.spec.js,
     against the real painted boxes. */
  await page.route("**/js/config.js", async (route) => {
    const res = await route.fetch();
    await route.fulfill({
      response: res,
      body: `${await res.text()}\nwindow.CONFIG.features.v3ArchivePlane = false;\n`
    });
  });

  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    const json = (body) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });

    if (url.pathname.startsWith("/api/system/health")) {
      return health === null
        ? route.fulfill({ status: 503, contentType: "application/json", body: "{}" })
        : json(health);
    }
    if (url.pathname.startsWith("/api/system/metrics")) {
      return metrics === null
        ? route.fulfill({ status: 503, contentType: "application/json", body: "{}" })
        : json(metrics);
    }
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

/** Mount the readout and read back what actually landed in the DOM. */
async function showStatus(page) {
  return page.evaluate(async () => {
    const shown = await window.__v3Subject("show.status");
    const mount = document.getElementById("subject-mount");
    return {
      shown: Boolean(shown),
      speech: shown && shown.speech ? shown.speech : null,
      children: mount.childElementCount,
      cell: mount.firstElementChild?.dataset.cell ?? null,
      rows: mount.querySelectorAll(".subject__row").length,
      text: mount.textContent
    };
  });
}

test.describe("the status readout", () => {
  test("a healthy house reads as healthy, and says so in one sentence", async ({ page }) => {
    const { pageErrors } = await bootV3(page);
    const got = await showStatus(page);

    expect(got.shown).toBe(true);
    expect(got.cell).toBe("status");
    // Four feeds plus the box line.
    expect(got.rows).toBe(5);
    expect(got.text).toContain("g11");
    expect(got.text).toContain("41°C");
    expect(got.speech).toBe("Everything's healthy.");
    expect(pageErrors).toEqual([]);
  });

  test("a broken house names the upstream cause, and shows the repair", async ({ page }) => {
    await bootV3(page, { health: BROKEN });
    const got = await showStatus(page);

    expect(got.speech).toBe("The internet's down.");
    // The server's own detail strings are reused rather than re-worded.
    expect(got.text).toContain("internet is down");
    // A self-heal that keeps firing is a fault that keeps happening, and it is
    // invisible in the feed levels precisely because the repair worked.
    expect(got.text).toContain("re-armed switch.kitchen_motion_detection");
  });

  test("⚠ an unreadable health mounts NOTHING rather than an empty confident panel", async ({ page }) => {
    await bootV3(page, { health: null });
    const got = await showStatus(page);
    expect(got.shown).toBe(false);
    expect(got.children).toBe(0);
  });

  test("⚠ a 200 with NO feeds is silence, not a clean bill of health", async ({ page }) => {
    /* The nastier half of not-loaded-is-not-empty, and the one a null check
       does not catch: a watchdog that has started but evaluated nothing answers
       200 with an empty array. Without the length clause this mounts a titled
       panel with no rows and says "Everything's healthy" — a confident empty
       panel, which is worse than no panel at all. */
    await bootV3(page, { health: { overall: "ok", updatedAt: Date.now(), feeds: [], recoveries: [] } });
    const got = await showStatus(page);
    expect(got.shown).toBe(false);
    expect(got.children).toBe(0);
  });

  test("the box's own line is optional — a missing sensor is not a missing readout", async ({ page }) => {
    /* The G11 has no vcgencmd and no /sys/class/thermal. A subject that refused
       to render because it could not read a CPU temperature would be answering
       a question about health by being unhealthy. */
    await bootV3(page, { metrics: null });
    const got = await showStatus(page);
    expect(got.shown).toBe(true);
    expect(got.rows).toBe(4);
  });

  test("⚠ SEEN ON THE GLASS: the values line up, and stay in the measured register", async ({ page }) => {
    /* Both halves of this were invisible to every textContent read and obvious
       in one screenshot — the lesson that has now cost this project eight
       defects. The guard asserts BOUNDING BOXES and computed type, not text.

       1. The shared column() helper aligns its lead for free only because every
          other subject's leads are times, all the same width. Feed names run
          from "Box" to "Camera snapshots", and the values came down the screen
          in a staircase.
       2. column() sets its value half in the SAID voice at 96px, so "fine",
          eight times over, was the largest thing on a diagnostic panel. */
    await bootV3(page, { health: FULL });
    const got = await page.evaluate(async () => {
      await window.__v3Subject("show.status");
      window.__setDepth(3, "spec");
      const values = [...document.querySelectorAll(".subject--status .subject__text")];
      const labels = [...document.querySelectorAll(".subject--status .subject__lead")];
      const xs = values.map((v) => Math.round(v.getBoundingClientRect().x));
      const heights = labels.map((l) => Math.round(l.getBoundingClientRect().height));
      return {
        distinctValueX: [...new Set(xs)].length,
        distinctLabelHeight: [...new Set(heights)].length,
        valueFont: getComputedStyle(values[0]).fontFamily,
        labelFont: getComputedStyle(labels[0]).fontFamily,
        valuePx: getComputedStyle(values[0]).fontSize,
        rows: values.length
      };
    });

    expect(got.rows).toBeGreaterThan(1);
    /* ⚠ And no label wraps. A first pass sized this column with a `ch` guess
       and three of nine labels went to two lines, which is the same ragged
       column in a different hat — `ch` is the advance of "0" and says almost
       nothing about proportional lowercase. */
    expect(got.distinctLabelHeight, "a feed label wrapped — the column is too narrow").toBe(1);
    // One column, one x. A staircase reads as every value at its own indent.
    expect(got.distinctValueX, "the value column is ragged — a staircase, not a readout").toBe(1);
    // Measured, not said: the house is not telling you this, you asked it.
    expect(got.valueFont).toBe(got.labelFont);
    expect(got.valuePx).toBe("48px");
  });

  test("leaving takes the whole readout with it", async ({ page }) => {
    // Depth 3 is the one genuinely per-event path in V3, and per-event paths
    // are where this house has leaked before.
    await bootV3(page);
    const after = await page.evaluate(async () => {
      const mount = document.getElementById("subject-mount");
      // Ten mount/remount cycles: showSubject() clears whatever is there first,
      // so a teardown that leaked would show as a rising child count.
      for (let i = 0; i < 10; i += 1) await window.__v3Subject("show.status");
      const whileMounted = mount.childElementCount;

      // And leaving depth 3 must empty it entirely — that is the path the wall
      // actually takes when a subject's hold expires.
      window.__setDepth(3, "spec");
      await window.__v3Subject("show.status");
      window.__setDepth(1, "spec");
      return { whileMounted, afterLeaving: mount.childElementCount };
    });
    expect(after.whileMounted).toBe(1);
    expect(after.afterLeaving).toBe(0);
  });
});

/* ── The pill ───────────────────────────────────────────────────────────────
   ⚠ THIS BLOCK USED TO BE "the one-line notice" AND IT ASSERTED THE OPPOSITE
   MECHANISM. A fault rode in through announce() as a score-72 candidate and won
   depth 1, setting itself in 132px Fraunces over whatever the room had come to
   see. Owner's verdict on the glass 2026-09-01: "the big text error messages
   take away from the dashboard itself." The fault is a pill now, and the tests
   that pinned the announce are exactly the tests that would have stopped this
   fix — so they are replaced rather than kept alongside it.

   ⚠ THE LOAD-BEARING ASSERTIONS ARE THE NEGATIVE ONES. "A pill appeared" is
   true of any implementation that also still shouts; only "#glance-said is
   empty and the depth never left 0" proves the glance was actually given back.
─────────────────────────────────────────────────────────────────────────── */

/** What is actually on the glass: the pill, and the two things it must not
 *  have taken. */
async function pill(page) {
  return page.evaluate(() => {
    const node = document.getElementById("fault");
    const label = document.getElementById("fault-label");
    return {
      hidden: node.hidden,
      shown: node.checkVisibility({ opacityProperty: true, visibilityProperty: true }),
      id: node.dataset.fault ?? null,
      words: (label.textContent ?? "").trim(),
      glance: (document.getElementById("glance-said").textContent ?? "").trim(),
      depth: document.documentElement.dataset.depth,
      announced: window.__v3().announced.filter((c) => c.source === "health").length
    };
  });
}

test.describe("the fault pill", () => {
  test("⚠ a broken feed reaches the room WITHOUT taking the glance", async ({ page }) => {
    await bootV3(page, { health: BROKEN });
    await page.evaluate(() => window.__v3Health());
    const got = await pill(page);

    expect(got.hidden).toBe(false);
    expect(got.shown, "the pill reports a rect but paints nothing").toBe(true);
    // wan outranks weather — the healthService's own reasoning about which
    // upstream broke the others, unchanged by the change of register.
    expect(got.id).toBe("wan");
    expect(got.words).toBe("Internet down");

    /* ⚠ THE WHOLE POINT. The old lane put "The internet's down." into
       #glance-said at --t-said-1 and pushed the wall to depth 1. Both must now
       be untouched by a fault — and the announce lane has to be GONE, not
       merely outranked, or a quiet morning still hands it the cell. */
    expect(got.glance, "a fault is still writing the glance cell").toBe("");
    expect(got.depth, "a fault still deepened the wall").toBe("0");
    expect(got.announced, "health is still announcing into the attention queue").toBe(0);
  });

  test("⚠ the pill is MEASURED and sits on the floor — not a said-voice headline", async ({ page }) => {
    /* The register is the fix, so the register is the assertion. A pill that
       said the right words in the serif at 132px would satisfy every textContent
       check in this file and still be the exact defect the owner reported. */
    await bootV3(page, { health: BROKEN });
    const type = await page.evaluate(async () => {
      await window.__v3Health();
      const label = document.getElementById("fault-label");
      const said = getComputedStyle(document.getElementById("glance-said"));
      const s = getComputedStyle(label);
      const box = document.getElementById("fault").getBoundingClientRect();
      return {
        family: s.fontFamily,
        size: s.fontSize,
        transform: s.textTransform,
        saidFamily: said.fontFamily,
        top: Math.round(box.top),
        left: Math.round(box.left),
        height: Math.round(box.height)
      };
    });

    expect(type.family).toContain("Roboto Flex");
    expect(type.family).not.toBe(type.saidFamily);
    // --t-rail, the floor of the whole system. Not below it, and not above it.
    expect(type.size).toBe("32px");
    expect(type.transform).toBe("uppercase");
    // Top-left at the safe inset: the corner a subject's title owns at depth 3
    // and nothing owns at 0-2.
    expect(type.top).toBe(96);
    expect(type.left).toBe(96);
    // One line. A wrapped pill has stopped being a pill — 32px of text plus
    // 12px padding either side plus the hairline is 58.
    expect(type.height).toBeLessThan(70);
  });

  test("a healthy house shows no pill at all", async ({ page }) => {
    await bootV3(page);
    await page.evaluate(() => window.__v3Health());
    const got = await pill(page);
    expect(got.hidden).toBe(true);
    expect(got.words).toBe("");
    expect(got.id).toBeNull();
  });

  test("⚠ a fault that CLEARS takes the pill down with it", async ({ page }) => {
    /* The half the announce lane got for free and this one has to do on
       purpose: `announce()` had no retraction, so recovery was a 90 s decay.
       Holding the state means clearing it is this module's job now, and a pill
       left up after the internet came back is the wall lying with confidence —
       worse than the fault it reports, because nobody can tell the two apart. */
    /* ⚠ REGISTERED AFTER bootV3, AND THAT ORDER IS THE TEST WORKING AT ALL.
       Playwright matches the LAST-registered route first, so a mutable handler
       installed before bootV3s own catch-all never runs, and the second
       poll reads the same BROKEN fixture as the first — a green test against a
       pill that never came down. */
    await bootV3(page, { health: BROKEN });
    let health = BROKEN;
    await page.route("**/api/system/health*", (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(health) }));

    await page.evaluate(() => window.__v3Health());
    expect((await pill(page)).hidden).toBe(false);

    health = HEALTHY;
    await page.evaluate(() => window.__v3Health());
    const after = await pill(page);
    expect(after.hidden, "the pill outlived the fault").toBe(true);
    expect(after.words).toBe("");
  });

  test("⚠ an unreachable server does not INVENT a fault — and does not KEEP one", async ({ page }) => {
    /* This page is served BY the server it is polling, so a failed poll means a
       restart in progress or a page about to stop working anyway. Raising from
       a reading we could not take would be making one up.

       The second clause is the one the announce lane never had to answer. A
       HELD state has to come down on an unread poll too: not being able to read
       the server is not evidence of a fault, but it is not evidence that the
       fault currently on the glass is still true either. */
    // Registered AFTER bootV3 — last route wins, see the note above.
    await bootV3(page, { health: BROKEN });
    let health = BROKEN;
    await page.route("**/api/system/health*", (route) =>
      health === null
        ? route.fulfill({ status: 503, contentType: "application/json", body: "{}" })
        : route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(health) }));

    await page.evaluate(() => window.__v3Health());
    expect((await pill(page)).id).toBe("wan");

    health = null;
    const got = await page.evaluate(async () => {
      await window.__v3Health();
      return { hidden: document.getElementById("fault").hidden, health: window.__v3().health };
    });
    expect(got.hidden, "a dark server held a stale fault on the glass").toBe(true);
    // And it did not write a verdict it never took: `last` still reads the real
    // one from the poll before.
    expect(got.health.fault).toBe("wan");
  });

  test("⚠ it stands down at depth 3, where a subject's title owns the corner", async ({ page }) => {
    /* The corner rule (index.html): hour BL, rail BR, title TL, transcript TR.
       Nothing is lost by yielding — depth 3 is where "show me the status" puts
       the full readout, so the one depth that hides the pill is the depth that
       answers it properly. */
    await bootV3(page, { health: BROKEN });
    const got = await page.evaluate(async () => {
      await window.__v3Health();
      document.documentElement.style.setProperty("--m-calm", "0ms");
      const node = document.getElementById("fault");
      const at = (d) => {
        window.__setDepth(d, "spec");
        return node.checkVisibility({ opacityProperty: true, visibilityProperty: true });
      };
      return { d0: at(0), d1: at(1), d2: at(2), d3: at(3) };
    });
    expect(got).toEqual({ d0: true, d1: true, d2: true, d3: false });
  });

  test("a feed this module has never heard of still gets plain words", async ({ page }) => {
    /* The fallback both registers share. A fault class that is invisible
       precisely because it is new is the one worth guarding against. */
    await bootV3(page, {
      health: { overall: "error", updatedAt: Date.now(), feeds: [feed("sonarr", "error", "down")], recoveries: [] }
    });
    await page.evaluate(() => window.__v3Health());
    const got = await pill(page);
    expect(got.id).toBe("sonarr");
    expect(got.words).toBe("sonarr down");
  });
});

/* ── The clock ──────────────────────────────────────────────────────────────
   ⚠ NOT A HEALTH TEST, AND IT LIVES HERE ANYWAY. It is the second half of the
   same sitting's verdict: depth 1 was taking two things it should not have, and
   the fix for both is that the glance stops being a wall the rest of the
   surface has to leave. Kept beside the pill so an edit that puts either back
   finds both reasons in one place.
─────────────────────────────────────────────────────────────────────────── */
test.describe("the hour survives the glance", () => {
  test("⚠ the clock does NOT disappear when something earns depth 1", async ({ page }) => {
    /* SEEN ON THE GLASS 2026-09-01, on the morning commute. #hour lived inside
       .depth--field; depth layers exchange by OPACITY; so the wall answered
       "twenty-two minutes to work" by hiding the one number that tells you
       whether that is a problem. Owner: "the clock disappears even though this
       is important to see so you can work out if you are running late."

       ⚠ checkVisibility({ opacityProperty: true }), never getComputedStyle on
       the node alone — an ANCESTOR layer was what took it away, and the hour
       sets its own opacity. A computed read of the element reports it visible
       at every depth and is simply wrong, which is the note compose.css already
       carries for .now-playing. */
    await bootV3(page);
    const got = await page.evaluate(() => {
      /* ⚠ THE EXCHANGE IS A 350ms OPACITY TRANSITION, so a read taken in the
         same turn as the depth change sees the OUTGOING value and every depth
         reports visible. Zeroing --m-calm before the first change is what makes
         this a state assertion rather than a race — Playwrights reducedMotion
         does nothing on this surface (it is a token, not a media query the
         stylesheet branches on for these rules). */
      document.documentElement.style.setProperty("--m-calm", "0ms");
      const hour = document.getElementById("hour");
      const at = (d) => {
        window.__setDepth(d, "spec");
        return hour.checkVisibility({ opacityProperty: true, visibilityProperty: true });
      };
      return { d0: at(0), d1: at(1), d2: at(2), d3: at(3) };
    });

    expect(got.d0, "the field lost its clock").toBe(true);
    expect(got.d1, "the clock still vanishes at the glance — the reported defect").toBe(true);
    // Depth 2's `.cell--wide` OWNS bottom-left (cols 1-8, rows 6-7) and depth 3
    // is full bleed. Staying would be a corner collision, not a fix.
    expect(got.d2).toBe(false);
    expect(got.d3).toBe(false);
  });

  test("⚠ and it STEPS DOWN, so depth 1 is still one thing at editorial scale", async ({ page }) => {
    /* The guard on the fix. Left at --t-hour, a 168px clock is the largest
       thing on a screen that is about something else — the glance line beside
       it is 132px. It renders at --t-measured-1 instead: a supporting readout,
       which is what it is at that depth.

       ⚠ MEASURED FROM THE PAINTED BOX, NOT THE FONT-SIZE. The step-down is a
       transform (animating font-size would reflow the line on every frame of
       the exchange), so a computed `font-size` read reports 168px at BOTH
       depths and would pass against the defect. */
    await bootV3(page);
    const got = await page.evaluate(() => {
      // Same reason as above: the step-down is a transitioned transform.
      document.documentElement.style.setProperty("--m-calm", "0ms");
      const hour = document.getElementById("hour");
      const box = () => {
        const r = hour.getBoundingClientRect();
        return { h: r.height, left: Math.round(r.left), bottom: Math.round(r.bottom) };
      };
      window.__setDepth(0, "spec");
      const field = box();
      window.__setDepth(1, "spec");
      return { field, glance: box(), size: getComputedStyle(hour).fontSize };
    });

    expect(got.size, "--t-hour drifted from the token").toBe("168px");
    // 72/168 — the ratio rather than a pixel height, so the assertion survives
    // a font swap that changes the line box.
    expect(got.glance.h / got.field.h).toBeCloseTo(72 / 168, 2);
    /* ⚠ transform-origin is `left bottom` — the two edges var(--safe) pins — so
       the clock SHRINKS IN PLACE. A step-down that also slid the corner would
       be a second motion for a cause the room cannot see. */
    expect(got.glance.left).toBe(got.field.left);
    expect(got.glance.bottom).toBe(got.field.bottom);
  });
});
