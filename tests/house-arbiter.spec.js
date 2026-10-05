import { test, expect } from "./fixtures/coverage.js";
import { bootV3 } from "./fixtures/v3boot.js";

/* ═══════════════════════════════════════════════════════════════════════════
   HOUSE-MIND S3 — the arbiter (docs/design/HOUSE-MIND.md §5, js/core/arbiter.js).

   The slice's own test: "two simultaneous authors resolve by POLICY, not by
   call order." So every race below is run in BOTH orders and must end the same
   way, and every one is run with the flag OFF too, where it must end the OLD
   way — that is what proves the flag is the lever and the off state is the
   build that shipped before.

   Speech runs in node against core/tts.js itself, with fetch/Audio/URL faked
   so each utterance's synthesis takes exactly as long as the test says. That is
   the only way two speakers genuinely overlap on demand. The stage runs on a
   real V3 page through the real subjects, doorbell, dinner and briefing.
   ═══════════════════════════════════════════════════════════════════════════ */

/* ── Speech, in node ────────────────────────────────────────────────────── */

const delays = {};
const played = [];
const audios = [];
let tts;
let arbiter;
const saved = {};

function setFlag(on) {
  globalThis.window.CONFIG.features.v3Arbiter = on;
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** The <audio> that is playing `text`, to end it on demand. */
const audioFor = (text) => audios.filter((a) => a.text === text).at(-1);

test.describe("speech — by priority, whichever speaker starts first", () => {
  test.describe.configure({ mode: "serial" });

  test.beforeAll(async () => {
    saved.window = globalThis.window;
    saved.fetch = globalThis.fetch;
    saved.Audio = globalThis.Audio;
    saved.create = URL.createObjectURL;
    saved.revoke = URL.revokeObjectURL;
    globalThis.window = { CONFIG: { features: {} } };
    globalThis.fetch = (_url, opts) => {
      const { text } = JSON.parse(opts.body);
      return new Promise((resolve) =>
        setTimeout(() => resolve({ ok: true, blob: async () => ({ __text: text }) }), delays[text] ?? 0));
    };
    URL.createObjectURL = (blob) => `blob:${blob.__text}`;
    URL.revokeObjectURL = () => {};
    globalThis.Audio = class {
      constructor(src) { this.text = src.slice(5); this.paused = false; audios.push(this); }
      play() { played.push(this.text); return Promise.resolve(); }
      pause() { this.paused = true; }
    };
    tts = await import("../src/js/core/tts.js");
    arbiter = await import("../src/js/core/arbiter.js");
  });

  test.afterAll(() => {
    globalThis.window = saved.window;
    globalThis.fetch = saved.fetch;
    globalThis.Audio = saved.Audio;
    URL.createObjectURL = saved.create;
    URL.revokeObjectURL = saved.revoke;
  });

  test.beforeEach(() => {
    tts.silence();
    arbiter.__resetArbiter();
    played.length = 0;
    audios.length = 0;
    for (const k of Object.keys(delays)) delete delays[k];
  });

  /* The doorbell's synthesis is SLOW and the greeting's FAST, so by call order
     alone the greeting always reaches the speaker first. */
  async function race(first, second) {
    delays["door"] = first === "doorbell" ? 60 : 5;
    delays["hello"] = first === "doorbell" ? 5 : 60;
    const say = (who) => tts.speak(who === "doorbell" ? "door" : "hello", { author: who });
    say(first);
    await wait(10);
    say(second);
    await wait(120);
    return played.slice();
  }

  test("ON: an arrival never cuts the doorbell — door first", async () => {
    setFlag(true);
    expect(await race("doorbell", "arrival")).toEqual(["door"]);
    expect(arbiter.arbiterState().decisions.map((d) => `${d.author}:${d.action}`)).toContain("arrival:dropped");
  });

  test("ON: an arrival never cuts the doorbell — greeting first, overtaken mid-synthesis", async () => {
    setFlag(true);
    expect(await race("arrival", "doorbell")).toEqual(["door"]);
  });

  test("OFF: the same races play BOTH, over each other — the flag is the lever", async () => {
    setFlag(false);
    expect((await race("doorbell", "arrival")).sort()).toEqual(["door", "hello"]);
    tts.silence();
    played.length = 0;
    expect((await race("arrival", "doorbell")).sort()).toEqual(["door", "hello"]);
  });

  test("ON: a barge-in during synthesis stops the reply; OFF it played anyway", async () => {
    setFlag(true);
    delays["reply"] = 60;
    tts.speak("reply", { author: "voice" });
    await wait(10);
    tts.silence();
    await wait(100);
    expect(played).toEqual([]);

    setFlag(false);
    tts.speak("reply", { author: "voice" });
    await wait(10);
    tts.silence();
    await wait(100);
    expect(played).toEqual(["reply"]);
  });

  test("ON: a dropped speaker settles when the air is free, not before", async () => {
    setFlag(true);
    tts.speak("door", { author: "doorbell" });
    await wait(20);
    expect(played).toEqual(["door"]);

    let settled = false;
    tts.speak("hello", { author: "arrival" }).then(() => { settled = true; });
    await wait(30);
    expect(settled).toBe(false);          // the rim must not drop under the door

    audioFor("door").onended();
    await wait(10);
    expect(settled).toBe(true);
    expect(played).toEqual(["door"]);     // and it never spoke
  });

  test("ON: the room's own voice cuts the doorbell (≥ pre-empts)", async () => {
    setFlag(true);
    tts.speak("door", { author: "doorbell" });
    await wait(20);
    tts.speak("answer", { author: "voice" });
    await wait(20);
    expect(played).toEqual(["door", "answer"]);
    expect(audioFor("door").paused).toBe(true);
  });

  test("ON: an unauthored speaker is never arbitrated (the incumbent's path)", async () => {
    setFlag(true);
    tts.speak("door", { author: "doorbell" });
    await wait(20);
    tts.speak("legacy");
    await wait(20);
    expect(played).toEqual(["door", "legacy"]);
  });

  test("ON: a dropped streamed reply is an inert queue whose done still settles", async () => {
    setFlag(true);
    tts.speak("door", { author: "voice" });
    await wait(20);
    const q = tts.createSpeech({ author: "arrival" });
    q.push("stream");
    q.close();
    let done = false;
    q.done.then(() => { done = true; });
    await wait(30);
    expect(played).toEqual(["door"]);
    expect(done).toBe(false);
    audioFor("door").onended();
    await wait(10);
    expect(done).toBe(true);
  });
});

/* ── Stage, on a real V3 page ───────────────────────────────────────────── */

const ROUTES = {
  "/api/calendar/all": [],
  "/api/ai/brief": { summary: "Good morning. This is the fixture briefing." }
};

/* ⚠ MIDDAY, PINNED. The briefing window runs on the REAL clock too: presence
   (forced below) fires briefing-window's own onPresence check, and at
   18:00–18:30 every day that opens the real EVENING briefing — whose `opening`
   latch then makes the spec's own call return null. Caught by the pre-push gate
   at 18:15 on 2026-09-24 and reproduced live at 18:24. Midday is inside no
   briefing window; the briefing test passes its own explicit 05:35. */
const MIDDAY = new Date("2026-07-06T12:00:00");

async function boot(page, on, extra = {}, flags = {}) {
  await page.clock.install({ time: MIDDAY });
  const { pageErrors } = await bootV3(page, { ...extra, ...ROUTES }, { features: { ...flags, v3Arbiter: on } });
  await page.waitForFunction(() => typeof window.__v3Alert === "function" && typeof window.__v3Dinner === "function");
  return pageErrors;
}

const stage = (page) => page.evaluate(() => ({
  subject: window.__v3().subject,
  reason: window.__depth().reason,
  mounted: document.querySelectorAll("#subject-mount > *").length,
  camera: Boolean(document.querySelector("#subject-mount .subject--camera")),
  decisions: (window.__v3().arbiter?.decisions ?? []).map((d) => `${d.cap}:${d.author}:${d.action}`)
}));

test.describe("stage — the door outranks dinner and the briefing", () => {
  for (const on of [true, false]) {
    test(`${on ? "ON" : "OFF"}: with the door up, dinner ${on ? "is refused" : "replaced it (the old way)"}`, async ({ page }) => {
      const pageErrors = await boot(page, on);
      await page.evaluate(() => window.__v3Alert());
      expect((await stage(page)).subject).toBe("show.camera");

      const r = await page.evaluate(() => window.__v3Dinner("Fixture Pie"));
      const s = await stage(page);
      if (on) {
        expect(r.shown).toBe(false);
        expect(s.subject).toBe("show.camera");
        expect(s.reason).toBe("alert:doorbell");
        expect(s.decisions).toContain("stage:dinner:refused");
      } else {
        expect(r.shown).toBe(true);
        expect(s.subject).toBe("show.recipe");
      }
      expect(pageErrors).toEqual([]);
    });

    test(`${on ? "ON" : "OFF"}: a recipe still loading when the door rings ${on ? "is torn down, never mounted" : "lands on the camera (the old way)"}`, async ({ page }) => {
      const pageErrors = await boot(page, on, { "/api/recipe": { __delayMs: 1200, __body: {} } });
      await page.evaluate(() => { window.__slowDinner = window.__v3Dinner("Slow Pie"); });
      /* ⚠ The debug hook WARMS the dish first, through the same slow route, so a
         fixed short wait rings the door before dinner has even asked for the
         stage — which tests the refusal (above), not this race. With the flag
         on, wait for the proof the build is in flight; off, there is no log, so
         wait past the warm. */
      /* ⚠⚠ AND THE DOOR IS RUNG FROM INSIDE THE PAGE, in the same task that sees
         the proof. The build is in flight for 1200 ms after "took"; polling for
         it from node (expect.poll backs off to 1 s between looks) and then
         ringing in a second round-trip spent most of that window before the
         door moved. Under 10 workers it spent all of it, 1 run in 3
         (2026-10-05): dinner had mounted, the door simply replaced it, and the
         log read took/took with no "superseded" — the refusal-free path, not
         this race. */
      if (on) {
        await page.evaluate(async () => {
          const took = () => (window.__v3().arbiter?.decisions ?? [])
            .some((d) => d.cap === "stage" && d.author === "dinner" && d.action === "took");
          const t0 = performance.now();
          while (!took()) {
            if (performance.now() - t0 > 10_000) throw new Error("dinner never took the stage — nothing to race the door against");
            await new Promise((r) => setTimeout(r, 10));
          }
          await window.__v3Alert();
        });
      } else {
        await page.waitForTimeout(1400);
        await page.evaluate(() => window.__v3Alert());
      }
      await page.evaluate(() => window.__slowDinner);   // let it resolve
      const s = await stage(page);
      if (on) {
        expect(s.subject).toBe("show.camera");
        expect(s.reason).toBe("alert:doorbell");
        expect(s.mounted).toBe(1);
        expect(s.camera).toBe(true);
        expect(s.decisions).toContain("stage:dinner:superseded");
      } else {
        expect(s.subject).toBe("show.recipe");
        expect(s.camera).toBe(false);
      }
      expect(pageErrors).toEqual([]);
    });

    test(`${on ? "ON" : "OFF"}: a briefing due while the door is up ${on ? "waits and keeps its window" : "displaced the door (the old way)"}`, async ({ page }) => {
      const pageErrors = await boot(page, on);
      const due = () => page.evaluate(() =>
        window.__v3Briefing({ now: new Date(2026, 7, 10, 5, 35), force: false }));
      await page.evaluate(() => { window.__v3Presence(true); return window.__v3Alert(); });

      const first = await due();
      if (on) {
        expect(first).toBeNull();                       // not fired: the window stays open
        expect((await stage(page)).subject).toBe("show.camera");

        await page.evaluate(() => window.__setDepth(0, "spec:door-gone"));
        const second = await due();
        expect(second?.shown).toBe(true);
        expect((await stage(page)).subject).toBe("show.briefing");
      } else {
        expect(first?.shown).toBe(true);
        expect((await stage(page)).subject).toBe("show.briefing");
      }
      expect(pageErrors).toEqual([]);
    });
  }
});

/* A FORCED briefing is an operator saying "now" (the __v3Briefing hook), not
   the schedule, so it is never arbitrated. Found at the v3Arbiter flip: the
   contrast sweep forces the briefing straight after a voice subject, and the
   scheduled author was refused the stage, blanking 14 of 23 sweeps. */
test("ON: a forced briefing is not the schedule — it mounts over the door", async ({ page }) => {
  const pageErrors = await boot(page, true);
  await page.evaluate(() => window.__v3Alert());
  expect((await stage(page)).subject).toBe("show.camera");

  const r = await page.evaluate(() => window.__v3Briefing({ force: true }));
  expect(r?.shown).toBe(true);
  expect((await stage(page)).subject).toBe("show.briefing");
  expect(pageErrors).toEqual([]);
});

/* ── Doorbell latency, both states ──────────────────────────────────────── */

test("the doorbell reaches the speaker as fast with the arbiter as without", async ({ page, browser }) => {
  /* ONE ring per fresh page: the alert router's per-location cooldown
     (alertRouter.js) rightly silences a second ring on the same page, which
     would read as a missing sample. */
  /* ⚠⚠ WHAT THIS USED TO MEASURE WAS THE MACHINE. Three rings OFF, then three
     ON, medians compared at 50 ms — and ~1500 ms of every sample was
     NAME_WAIT_MS, the doorbell's fixed wait for a recognised face, which the
     arbiter is nowhere near. Measured 2026-10-05 under 10 workers, 3 runs:
     "off 1514 · on 1620" (red), "off 1570 · on 1515" (the arbiter 55 ms FASTER
     than no arbiter — noise, in both directions), and two timeouts at 30 s,
     because six cold boots plus 9 s of name-wait IS the test budget.
     So: the name wait is pinned off (it is not what is under test), the two
     states are INTERLEAVED so drift in the machine's load lands on both, and
     the BEST sample of each is compared — load only ever adds time, so the
     fastest ring is the closest thing to the code's own cost. A real delay in
     the arbiter's path is in every sample, the fastest included. */
  async function ring(on) {
    const ctx = await browser.newContext();
    const p = await ctx.newPage();
    await boot(p, on, {}, { v3DoorbellNameWait: false });
    const t = (await p.evaluate(async () => {
      let hit = null;
      const real = window.fetch;
      window.fetch = (url, opts) => {
        if (String(url).includes("/api/tts/speak") && hit == null) hit = performance.now();
        return real(url, opts);
      };
      const t0 = performance.now();
      await window.__v3Alert();
      /* Wait for the request itself, up to 2 s — a fixed 50 ms here made a ring
         that was merely SLOW read as one that never happened (an injected 100 ms
         delay came back "on: [null,null,null]", red for the wrong reason). */
      while (hit == null && performance.now() - t0 < 2000) await new Promise((r) => setTimeout(r, 10));
      window.fetch = real;
      return hit == null ? null : hit - t0;
    }));
    await ctx.close();
    return t;
  }
  const off = [], on = [];
  for (let i = 0; i < 3; i++) {
    off.push(await ring(false));
    on.push(await ring(true));
  }
  // Every ring reached the speaker in both states — a dropped doorbell line
  // would read as a missing sample, not a fast one. Asserted BEFORE the
  // arithmetic, so a null is reported as what it is.
  expect(off.every((t) => typeof t === "number"), `off: ${JSON.stringify(off)}`).toBe(true);
  expect(on.every((t) => typeof t === "number"), `on: ${JSON.stringify(on)}`).toBe(true);

  const best = (xs) => Math.min(...xs);
  const all = `off ${off.map((t) => t.toFixed(0)).join("/")} · on ${on.map((t) => t.toFixed(0)).join("/")}`;
  test.info().annotations.push({ type: "doorbell-to-tts-ms", description: all });
  console.log(`[arbiter] doorbell → TTS request, ms per ring: ${all}`);
  // The arbiter adds synchronous checks only; 50 ms is far above that and far
  // below anything a person at the door could notice.
  expect(best(on), all).toBeLessThan(best(off) + 50);
  void page;
});
