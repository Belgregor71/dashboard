import { test, expect } from "@playwright/test";
import { createCameraDetector, REPEAT_MS, GAP_MS } from "../server/services/cameraPresence.js";

/* ═══════════════════════════════════════════════════════════════════════════
   CAMERA PRESENCE — the webcam as a third presence source (2026-09-26).

   The agent (tools/camera-presence) sends { person, count, score } once a
   second; the server decides; the page hears a rising edge and then at most
   one refresh every 30 s; presence.js counts it as "webcam" when
   features.cameraPresence is on.

   Asserted, and why:
     · one person-frame is not a person; 2 of 3 is      → a lone false frame
                                                          (a coat, a dog mid-leap)
                                                          must never wake the wall
     · rising edge at once, then ≤ 1 per 30 s            → an hour on the couch is
                                                          ~120 events, not 3,600
     · a gap clears the window                           → frames either side of
                                                          22:00 or a restart are
                                                          not "2 of 3"
     · live:false when frames stop                       → "camera dead" must read
                                                          differently from "nobody"
     · the route: loopback-only POST, a strict body      → nothing but a boolean
                                                          gets to claim a person
     · end to end on the page, BOTH flag states          → the relay and the
                                                          consumer are really wired,
                                                          and off is really off
   ═══════════════════════════════════════════════════════════════════════════ */

test.describe("camera presence — the decider", () => {
  test("one person-frame is nothing; the second in three is a person", () => {
    const d = createCameraDetector();
    let t = 1_000_000;
    const push = (person) => d.push({ person, count: person ? 1 : 0, score: person ? 0.8 : 0 }, (t += 1000));
    expect(push(false).emit).toBe(false);
    expect(push(true).emit, "a lone frame").toBe(false);
    expect(push(false).emit).toBe(false);
    expect(push(false).emit).toBe(false);
    // Now two in a row: the second is the rising edge.
    expect(push(true).emit).toBe(false);
    const edge = push(true);
    expect(edge).toMatchObject({ emit: true, rising: true, confirmed: true });
    // And "2 of 3" means across a gap of one, too.
    const d2 = createCameraDetector();
    let u = 5_000_000;
    const push2 = (person) => d2.push({ person }, (u += 1000));
    push2(true); push2(false);
    expect(push2(true)).toMatchObject({ emit: true, rising: true });
  });

  test("while someone stays: at most one refresh every 30 s, and none once they have gone", () => {
    const d = createCameraDetector();
    let t = 2_000_000;
    let emits = 0;
    for (let s = 0; s < 600; s++) {             // ten minutes on the couch
      if (d.push({ person: true }, (t += 1000)).emit) emits += 1;
    }
    // One rising edge + one per REPEAT_MS after it.
    expect(emits).toBe(1 + Math.floor((600 - 2) * 1000 / REPEAT_MS));
    // They leave: no event says so (absence is the page's linger).
    for (let s = 0; s < 120; s++) expect(d.push({ person: false }, (t += 1000)).emit).toBe(false);
    expect(d.state(t).confirmed).toBe(false);
  });

  test("a gap clears the window; live says whether frames are arriving", () => {
    const d = createCameraDetector();
    let t = 3_000_000;
    expect(d.state(t)).toMatchObject({ live: false, frames: 0, lastFrameAgoMs: null });
    d.push({ person: true }, (t += 1000));
    expect(d.state(t).live).toBe(true);
    // 22:00 comes, the camera closes, 07:00 it opens: one frame each side is not two in three.
    t += GAP_MS + 1;
    expect(d.state(t).live, "frames stopped").toBe(false);
    expect(d.push({ person: true }, t)).toMatchObject({ emit: false, confirmed: false });
    expect(d.push({ person: true }, (t += 1000))).toMatchObject({ emit: true, rising: true });
  });
});

test.describe("camera presence — the route", () => {
  test("POST /api/voice/camera takes a strict body; GET reports counters, no image", async ({ request }) => {
    for (const bad of [{}, { person: "yes" }, { person: 1 }, { count: 2 }]) {
      const r = await request.post("/api/voice/camera", { data: bad });
      expect(r.status(), JSON.stringify(bad)).toBe(400);
    }
    // person:false only here — a true pair would emit onto the process-wide bus.
    expect((await request.post("/api/voice/camera", { data: { person: false, count: 0, score: 0 } })).status()).toBe(204);
    const r = await request.get("/api/voice/camera");
    expect(r.status()).toBe(200);
    const body = await r.json();
    expect(Object.keys(body).sort()).toEqual(["confirmed", "emits", "frames", "lastFrameAgoMs", "lastPersonAgoMs", "live", "personFrames"]);
    expect(body.frames).toBeGreaterThan(0);
    expect(body.live).toBe(true);
  });
});

/* ── End to end on the page ──────────────────────────────────────────────── */

const MIDDAY = new Date("2026-09-11T12:00:00");

async function boot(page, on) {
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.route("**/js/config.js", async (route) => {
    const res = await route.fetch();
    await route.fulfill({ response: res, body: `${await res.text()}\nwindow.CONFIG.features.cameraPresence = ${on};\nwindow.CONFIG.features.soundPresence = false;\n` });
  });
  await page.clock.setFixedTime(MIDDAY);
  await page.goto("/v3/");
  await page.waitForFunction(() => typeof window.__v3Presence === "function" && window.__presenceLight?.().streamOpen === true, null, { timeout: 10_000 });
  return errors;
}

/* A person arrives, through the real route: three empty frames first so the
   server's window is clear whatever ran before, then two with a person — the
   second is the rising edge, which the SSE carries to the page. */
async function personArrives(request) {
  for (const person of [false, false, false, true, true]) {
    expect((await request.post("/api/voice/camera", { data: { person, count: person ? 1 : 0, score: person ? 0.8 : 0 } })).status()).toBe(204);
  }
}

test.describe.serial("camera presence — on the page", () => {
  test("flag on: a person on camera makes the room present, and says it was the webcam", async ({ page, request }) => {
    const errors = await boot(page, true);
    expect(await page.evaluate(() => window.__v3Presence())).toMatchObject({ present: false, cameraEnabled: true });
    await personArrives(request);
    await page.waitForFunction(() => window.__v3Presence().present === true, null, { timeout: 5_000 });
    expect(await page.evaluate(() => window.__v3Presence().lastReason)).toBe("webcam");
    expect(errors).toEqual([]);
  });

  test("flag off: the same arrival changes nothing", async ({ page, request }) => {
    const errors = await boot(page, false);
    // Positive control: a listener of the test's own on the SAME stream counts
    // the camera events that reach this page. Without it, "nothing changed"
    // passes just as well when the event never arrived at all.
    await page.evaluate(() => new Promise((ok) => {
      window.__camHeard = 0;
      const es = new EventSource("/api/voice/stream");
      es.addEventListener("voice_camera_presence", () => { window.__camHeard += 1; });
      es.onopen = () => ok();
    }));
    await personArrives(request);
    await page.waitForFunction(() => window.__camHeard >= 1, null, { timeout: 5_000 });
    await page.waitForTimeout(500);
    expect(await page.evaluate(() => window.__v3Presence())).toMatchObject({ present: false, cameraEnabled: false });
    expect(errors).toEqual([]);
  });
});
