import { test, expect } from "./fixtures/coverage.js";
import { stage, guard, bootFault, bootReport, __resetBoot } from "../src/v3/core/boot.js";
import { worstFault } from "../src/v3/core/health.js";

/* ═══════════════════════════════════════════════════════════════════════════
   BOOT ISOLATION — cutover §4 (docs/design/V3-CUTOVER.md).

   `boot()` is the densest node in the graph: 44 edges, every subsystem
   initialising through one flat sequence. A throw at line nine used to cost
   the substrate, the timers, the depth machinery and every debug handle below
   it — and while V3 was secondary, that degraded a page nobody was watching.
   Once `/` serves V3 it is a black wall with nothing behind it.

   ⚠ ISOLATION CANNOT BE VERIFIED BY READING THE CODE. The property is "the
   wall still works when a subsystem is dead", and the only way to check it is
   to kill one. Hence `?__boom=<stage>`, which works over CDP on the kiosk for
   the same reason it works here.

   Each assertion names ONE cause, and each was proven red by mutation before
   it was kept:

     stage() without its try/catch          → 1, 2, "does not black out the wall"
     handles moved back to the end of boot() → "the handles come first"
     worstFault() not consulting bootFault() → 4, "reaches the room", "names which part"
     poll() early-returning when unread      → "survives an unreadable server"
     TICK_FAULT_AFTER = 1                    → "once is a blip"
   ═══════════════════════════════════════════════════════════════════════════ */

test.describe("the isolator", () => {
  test.beforeEach(() => __resetBoot());

  test("a stage that throws does not take the next one with it", () => {
    const ran = [];
    stage("first", () => { ran.push("first"); throw new Error("boom"); });
    const value = stage("second", () => { ran.push("second"); return "alive"; });

    expect(ran, "the stage after a throwing one never ran").toEqual(["first", "second"]);
    // The value still comes back, so a caller can keep assigning from a stage.
    expect(value).toBe("alive");
    expect(bootReport().failed).toEqual(["first"]);
  });

  test("⚠ ONE CAUSE, NOT THREE SYMPTOMS — the first failure is the cause", () => {
    /* health.js's rule, applied to a sequence instead of to feeds. Boot is
       ordered, so a later stage failing is usually a consequence: the
       attention queue cannot be blamed for a feed that never registered. The
       earliest failure is the only one that cannot have been caused by
       something else on the list. */
    stage("ha-feed", () => { throw new Error("no socket"); });
    stage("attention", () => { throw new Error("nothing to rank"); });
    stage("alerts", () => { throw new Error("no queue"); });

    const fault = bootFault();
    expect(fault.cause).toBe("ha-feed");
    // The rest are still recorded — for the readout, which is asked for
    // deliberately and can afford the detail.
    expect(fault.detail).toContain("attention");
    expect(fault.detail).toContain("alerts");
    // But the sentence for the room names no internals at all.
    expect(fault.text).toBe("Part of the screen didn't start.");
  });

  test("a clean boot names no fault, and does not shout over a real one", () => {
    stage("depth", () => true);
    stage("ground", () => true);
    expect(bootFault()).toBeNull();
    // The feeds still get their turn — a false positive here would silence the
    // entire watchdog behind a permanently-broken-looking surface.
    const fault = worstFault({ feeds: [{ id: "wan", label: "Internet", level: "error", detail: "down" }] });
    expect(fault.id).toBe("wan");
  });

  test("⚠ the surface's own boot OUTRANKS every feed", () => {
    /* One level above PRIORITY's argument about which upstream broke the
       others. The feeds describe what the surface is reporting ON; this
       describes whether the thing doing the reporting came up whole. A
       half-booted wall telling you the calendar is late is answering the
       wrong question with whichever subsystems happen to still be alive. */
    stage("substrate", () => { throw new Error("no canvas"); });

    const fault = worstFault({
      feeds: [
        { id: "wan", label: "Internet", level: "error", detail: "internet is down" },
        { id: "ha", label: "Home Assistant", level: "error", detail: "not answering" }
      ]
    });
    expect(fault.id).toBe("surface");
    expect(fault.cause).toBe("substrate");
  });

  test("⚠ a guarded callback throwing ONCE is a blip; three times is a fault", () => {
    /* setInterval keeps firing after its callback throws, so a broken
       pushCauses is not a stopped clock — it is an uncaught error every sixty
       seconds for weeks. But one throw is a null from a feed or a resize
       mid-frame, and a wall that announces blips teaches the room to ignore it
       before anything is actually broken. */
    const tick = guard("causes", () => { throw new Error("no weather"); });

    tick();
    expect(bootFault(), "one throw is not a fault").toBeNull();
    tick();
    expect(bootFault(), "two throws inside one bad minute is not a fault either").toBeNull();
    tick();

    const fault = bootFault();
    expect(fault, "a subsystem failing three times running is not a blip").toBeTruthy();
    expect(fault.detail).toContain("causes keeps failing");
    expect(bootReport().ticks[0].failures).toBe(3);
  });

  test("a guarded callback still returns its value, and keeps running", () => {
    let n = 0;
    const tick = guard("hour", () => { n += 1; if (n === 2) throw new Error("skip"); return n; });
    expect(tick()).toBe(1);
    expect(tick()).toBeUndefined();
    // The throw must not have disarmed the callback — the whole point of
    // guarding rather than clearing the interval.
    expect(tick()).toBe(3);
  });

  test("⚠ a repeating throw is logged ONCE, then counted", () => {
    /* A callback that throws every minute on a page that runs for weeks writes
       forty thousand identical lines a month into a console someone will
       eventually need to read one useful line out of. */
    const original = console.error;
    const lines = [];
    console.error = (...args) => lines.push(args[0]);
    try {
      const tick = guard("rail", () => { throw new Error("no phrase"); });
      for (let i = 0; i < 50; i += 1) tick();
    } finally {
      console.error = original;
    }
    expect(lines).toHaveLength(1);
    expect(bootReport().ticks[0].failures).toBe(50);
  });
});

/* ── On the glass ───────────────────────────────────────────────────────────
   Every /api/** is answered here: a spec about a broken boot cannot share a
   house with the developer's living room.
─────────────────────────────────────────────────────────────────────────── */

const HEALTHY = {
  overall: "ok",
  updatedAt: Date.now(),
  feeds: [
    { id: "ha", label: "Home Assistant", level: "ok", detail: null },
    { id: "wan", label: "Internet", level: "ok", detail: null }
  ],
  recoveries: []
};

/* ⚠ THE LIVE SHAPE, and it is nine feeds — the G11's watchdog reports a
   `motionCoverage` feed the older fixtures in v3-health.spec.js do not carry.
   Nine feeds plus the box line is ten rows, which is exactly the panel's
   ceiling, which is why the surface row is the one that overflows it. A
   fixture with eight feeds cannot produce this defect. */
const NINE_FEEDS = {
  overall: "ok",
  updatedAt: Date.now(),
  recoveries: [],
  feeds: [
    ["ha", "Home Assistant"], ["wan", "Internet"], ["motion", "Motion events"],
    ["motionCoverage", "Motion coverage"], ["weather", "Weather"], ["calendar", "Calendar"],
    ["cameras", "Camera snapshots"], ["ai", "AI briefings"], ["tts", "Text-to-speech"]
  ].map(([id, label]) => ({ id, label, level: "ok", detail: null }))
};

const METRICS = { cpuLoadPercent: 7, cpuCount: 8, uptimeSeconds: 706_000, tempC: 49, hostname: "g11" };

async function bootV3(page, { boom = null, health = HEALTHY } = {}) {
  const pageErrors = [];
  page.on("pageerror", (err) => pageErrors.push(err.message));

  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    const json = (body) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });

    if (url.pathname.startsWith("/api/system/health")) {
      return health === null
        ? route.fulfill({ status: 503, contentType: "application/json", body: "{}" })
        : json(health);
    }
    if (url.pathname.startsWith("/api/system/metrics")) return json(METRICS);
    if (/\/(thumb|snapshot|live|image|basemap|overlay)/.test(url.pathname)) {
      return route.fulfill({
        status: 200,
        contentType: "image/gif",
        body: Buffer.from("R0lGODlhAQABAAAAACw=", "base64")
      });
    }
    return route.fulfill({ status: 503, contentType: "application/json", body: "{}" });
  });

  await page.goto(boom ? `/v3/?__boom=${boom}` : "/v3/");
  await page.waitForFunction(() => typeof window.__v3Boot === "function");
  return { pageErrors };
}

test.describe("a dead subsystem on a real page", () => {
  test("the wall still paints when a subsystem is dead", async ({ page }) => {
    /* The whole property, and the only way to see it is to break something.
       Before §4 this sequence was flat: a throw in the ground took the hour,
       the substrate, the timers, the depth machinery and every handle with
       it — a black screen, and no way to ask it why. */
    const { pageErrors } = await bootV3(page, { boom: "ground" });

    const got = await page.evaluate(() => ({
      boot: window.__v3Boot(),
      hour: document.getElementById("hour")?.textContent ?? "",
      depth: window.__depth?.().depth ?? null,
      substrate: Boolean(window.__substrate?.())
    }));

    expect(got.boot.failed, "the injected fault did not land, or took others with it").toEqual(["ground"]);
    // Everything downstream of the dead stage still came up.
    expect(got.hour, "the hour never painted — the sequence still aborts").toMatch(/^\d{1,2}:\d{2}$/);
    expect(got.depth, "the field is the floor and must be reached regardless").toBe(0);
    expect(got.substrate).toBe(true);
    // And a caught stage is not an uncaught page error — the bug class the
    // whole suite exists to catch.
    expect(pageErrors).toEqual([]);
  });

  test("⚠ the handles come FIRST, before anything that can break", async ({ page }) => {
    /* A source-order guard, and it is not redundant with the isolation: with
       stages continuing, the handles register at the end too. It is the
       CATASTROPHIC boot this protects — a throw outside any stage, a module
       that fails to evaluate — where the difference is between a wall you can
       interrogate over CDP and one you can only look at. */
    await bootV3(page);
    const first = await page.evaluate(() => window.__v3Boot().stages[0].name);
    expect(first, "something is registered before the debug handles").toBe("handles");
  });

  test("⚠ a healthy wall fails NO stage — the report is empty", async ({ page }) => {
    /* The regression guard that matters most in production. Isolation is the
       thing that would hide a stage which quietly started throwing: the wall
       looks nearly right, and nothing goes red. This is the assertion that
       does. */
    await bootV3(page);
    const boot = await page.evaluate(() => window.__v3Boot());

    expect(
      boot.failed,
      `these boot stages threw on a healthy page:\n` +
        boot.stages.filter((s) => !s.ok).map((s) => `  ${s.name}: ${s.error}`).join("\n")
    ).toEqual([]);
    expect(boot.fault).toBeNull();
    expect(boot.stages.length).toBeGreaterThan(10);
  });
});

test.describe("saying so", () => {
  test("a boot failure reaches the room, not just the console", async ({ page }) => {
    /* §4's second half. A console line nobody reads is the same as no report,
       and V3 already has the two surfaces for this — the one-line notice into
       the attention queue, and the readout. Neither is a new writer of a cell. */
    await bootV3(page, { boom: "ground" });

    const got = await page.evaluate(async () => {
      await window.__v3Health();
      return { health: window.__v3().health, announced: window.__v3().announced };
    });

    expect(got.health.fault, "a healthy server silenced a broken surface").toBe("surface");
    const entry = got.announced.find((c) => c.source === "health");
    expect(entry, "the boot failure never reached the queue").toBeTruthy();
    // The room hears a sentence, not a stage name. (announcements() reports the
    // queue's bookkeeping only, so the words are read off the verdict.)
    expect(got.health.text).toContain("didn't start");
    expect(got.health.text).not.toContain("ground");
    // Which part is still recorded — for the readout, and for whoever is
    // reading this over CDP at the time.
    expect(got.health.detail).toContain("ground");
    // High band, presence-gated: a house alone at 3am is not told about itself.
    expect(entry.score).toBe(72);
  });

  test("⚠ and it survives an unreadable server", async ({ page }) => {
    /* The server being dark is not a fault to announce — this page is served
       BY it. But the surface's own boot is known LOCALLY, so reporting it is
       not inventing it. Without this the one moment a half-booted wall most
       needs to speak — a deploy that broke both — is the one moment it is
       silent. */
    await bootV3(page, { boom: "ground", health: null });

    const got = await page.evaluate(async () => {
      await window.__v3Health();
      return { health: window.__v3().health, announced: window.__v3().announced };
    });

    expect(got.health?.fault).toBe("surface");
    expect(got.announced.filter((c) => c.source === "health")).toHaveLength(1);
  });

  test("an unreadable server on a HEALTHY wall still invents nothing", async ({ page }) => {
    // The guard on the clause above: it must add the local fault, not open a
    // door for the fault that was always forbidden.
    await bootV3(page, { health: null });
    const got = await page.evaluate(async () => {
      await window.__v3Health();
      return { health: window.__v3().health, announced: window.__v3().announced };
    });
    expect(got.announced.filter((c) => c.source === "health")).toEqual([]);
    expect(got.health).toBeNull();
  });

  test("the readout names which part, and only there", async ({ page }) => {
    await bootV3(page, { boom: "ground" });
    const got = await page.evaluate(async () => {
      const shown = await window.__v3Subject("show.status");
      const mount = document.getElementById("subject-mount");
      return { speech: shown && shown.speech, text: mount.textContent, rows: mount.querySelectorAll(".subject__row").length };
    });

    expect(got.text).toContain("Surface");
    // The stage name belongs here — a readout you asked for out loud can
    // afford the detail the one-line notice cannot.
    expect(got.text).toContain("ground");
    expect(got.speech).toBe("Part of the screen didn't start.");
    // Two feeds, the box line, and the surface row on top of them.
    expect(got.rows).toBe(4);
  });

  test("⚠ SEEN ON THE GLASS: the surface row does not push a row off the bottom", async ({ page }) => {
    /* The regression this actually caused, caught by a screenshot of the live
       wall and by nothing else. The live house reports NINE feeds, which with
       the box line is ten rows — and ten is the panel's real ceiling (measured:
       last baseline 980 against a content box ending at 984). §4's surface row
       made eleven, and `overflow: hidden` took the box line clean off the
       bottom. Every textContent assertion stayed green.

       ⚠ MEASURE THE CELLS, NOT THE ROWS. `.subject__row` is `display: contents`
       — it generates no box at all, so its getBoundingClientRect() is always
       zero and a check written against it passes for every layout, including
       the broken one. */
    await bootV3(page, { boom: "ground", health: NINE_FEEDS });

    const got = await page.evaluate(async () => {
      await window.__v3Subject("show.status");
      window.__setDepth(3, "spec");
      const frame = document.querySelector(".subject--status");
      const cells = [...document.querySelectorAll(".subject--status .subject__text")];
      const bottom = frame.getBoundingClientRect().bottom - parseFloat(getComputedStyle(frame).paddingBottom);
      return {
        rows: cells.length,
        zeroBoxes: cells.filter((c) => c.getBoundingClientRect().height === 0).length,
        clipped: cells.filter((c) => c.getBoundingClientRect().bottom > bottom + 1).map((c) => c.parentElement.textContent),
        first: cells[0].parentElement.textContent
      };
    });

    // The fixture must be able to produce the defect: real boxes, and enough of
    // them that an uncapped list would overflow.
    expect(got.zeroBoxes, "measuring display:contents rows — this check cannot fail").toBe(0);
    expect(got.rows).toBe(10);
    expect(got.clipped, "a row is painted past the bottom of the frame, where nothing can scroll it back").toEqual([]);
    // And the row that survives the squeeze is the one that matters.
    expect(got.first).toContain("Surface");
  });
});
