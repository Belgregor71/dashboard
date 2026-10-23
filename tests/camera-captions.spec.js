import { test, expect } from "@playwright/test";
import http from "node:http";
import { EventEmitter } from "node:events";
import {
  cameraForEntity, createCaptionLane, captionImage, prune, startCameraCaptions, captionStatus, spawnArgs,
  PROMPT, RETENTION_MS, MAX_ROWS
} from "../server/services/cameraCaptions.js";

/* ═══════════════════════════════════════════════════════════════════════════
   CAMERA CAPTIONS — field-scan #3 Phase 1, shadow (services/cameraCaptions.js).

   "It worked when": an edge captions the camera's NEXT image and never the one
   already showing (the event image lags the edge); edges inside the burst gap
   share a burst; a backlog is dropped, not buffered; rows older than 7 days are
   gone; the request switches thinking off; and with CAMERA_CAPTIONS unset an
   edge touches nothing.
   ═══════════════════════════════════════════════════════════════════════════ */

const IDS = new Set(["doorbell", "driveway", "side_gate"]);
const img = (s) => Buffer.from(`jpeg:${s}`);

/** A lane whose camera shows `frames` in order, one per fetch, then holds the last.
    ⚠ The lane's clock is FAKE and each fetch moves it on by one poll, so a watch
    window is a fixed number of fetches. On wall time a 15 ms window held one
    fetch or three depending on the OS timer tick (~15.6 ms on Windows), and the
    burst test went red 3 times in 30 with no defect in the code. */
function lane(frames, opts = {}) {
  const rows = [];
  const fetched = [];
  const captioned = [];
  const clock = { t: 1_000_000 };
  let i = 0;
  const l = createCaptionLane({
    cameraIds: IDS,
    now: () => clock.t,
    fetchImage: async (id) => {
      fetched.push(id);
      clock.t += 5;
      return img(frames[Math.min(i++, frames.length - 1)]);
    },
    caption: opts.caption || (async (buf) => { captioned.push(buf.toString()); return `saw ${buf.toString()}`; }),
    write: async (row) => { rows.push(row); },
    pollMs: 5,
    watchMs: opts.watchMs ?? 60,
    burstGapMs: opts.burstGapMs ?? 1000,
    maxQueue: opts.maxQueue ?? 12,
    log: () => {}
  });
  return { l, rows, fetched, captioned, clock };
}

const settled = (l) => expect.poll(() => l.idle(), { timeout: 3000, intervals: [10] }).toBe(true);

test.describe("cameraForEntity", () => {
  test("maps motion, person and ring edges to cameras it knows, and nothing else", () => {
    expect(cameraForEntity("binary_sensor.side_gate_motion_detected", IDS)).toBe("side_gate");
    expect(cameraForEntity("binary_sensor.driveway_person_detected", IDS)).toBe("driveway");
    expect(cameraForEntity("binary_sensor.doorbell_ringing", IDS)).toBe("doorbell");
    expect(cameraForEntity("binary_sensor.tilt_pan_motion_detected", IDS)).toBeNull();
    expect(cameraForEntity("binary_sensor.driveway_open", IDS)).toBeNull();
    expect(cameraForEntity(undefined, IDS)).toBeNull();
  });
});

test.describe("the lane", () => {
  test("captions the NEXT image after an edge, never the one already showing", async () => {
    // "old" is the previous event's image, still up when the edge arrives.
    const { l, rows, captioned } = lane(["old", "old", "old", "new", "new"]);
    expect(l.noteEdge("binary_sensor.driveway_motion_detected")).toBe("driveway");
    await settled(l);
    expect(captioned).toEqual(["jpeg:new"]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ camera: "driveway", caption: "saw jpeg:new" });
    expect(Object.keys(rows[0]).sort()).toEqual(["at", "burst", "camera", "caption", "ms"]);
  });

  test("an image that never changes is never captioned", async () => {
    const { l, rows, fetched } = lane(["same"]);
    l.noteEdge("binary_sensor.driveway_motion_detected");
    await settled(l);
    expect(fetched.length).toBeGreaterThan(1);
    expect(rows).toEqual([]);
  });

  test("an edge for a camera it does not know fetches nothing", async () => {
    const { l, fetched } = lane(["a", "b"]);
    expect(l.noteEdge("binary_sensor.tilt_pan_motion_detected")).toBeNull();
    await settled(l);
    expect(fetched).toEqual([]);
    expect(l.status().edges).toBe(0);
  });

  test("edges inside the gap share a burst; after the gap a new one opens", async () => {
    const frames = Array.from({ length: 200 }, (_, i) => `f${i}`); // a new image on every fetch
    const { l, rows, clock } = lane(frames, { watchMs: 15, burstGapMs: 150 });
    const t0 = clock.t;
    l.noteEdge("binary_sensor.driveway_motion_detected", t0);
    await settled(l);
    const first = rows.length;
    l.noteEdge("binary_sensor.driveway_person_detected", t0 + 50);  // inside the gap
    await settled(l);
    const second = rows.length;
    l.noteEdge("binary_sensor.driveway_motion_detected", t0 + 400); // gap passed
    await settled(l);
    expect(first).toBeGreaterThan(0);
    expect(second).toBeGreaterThan(first);
    expect(rows.length).toBeGreaterThan(second);
    expect(new Set(rows.slice(0, second).map((r) => r.burst))).toEqual(new Set([t0]));
    expect(new Set(rows.slice(second).map((r) => r.burst))).toEqual(new Set([t0 + 400]));
  });

  test("a backlog beyond the cap is dropped, not buffered", async () => {
    let release;
    const gate = new Promise((r) => { release = r; });
    const { l, rows } = lane(["0", "1", "2", "3", "4", "5", "6", "7"], {
      maxQueue: 2, watchMs: 80,
      caption: async (buf) => { await gate; return buf.toString(); }
    });
    l.noteEdge("binary_sensor.driveway_motion_detected");
    // Release only once the watch has closed: a frame that lands after the
    // queue drains is rightly captioned, and made this 3-or-4 by timing.
    await expect.poll(() => l.status().watching.length, { timeout: 3000 }).toBe(0);
    expect(l.status().dropped).toBeGreaterThan(0);
    release();
    await settled(l);
    // One in flight + two queued; everything after that was dropped.
    expect(rows.length).toBe(3);
    expect(l.status().dropped).toBe(l.status().images - 3);
  });

  test("a caption that fails writes no row and is counted", async () => {
    const { l, rows } = lane(["a", "b"], { caption: async () => { throw new Error("model down"); } });
    l.noteEdge("binary_sensor.driveway_motion_detected");
    await settled(l);
    expect(rows).toEqual([]);
    expect(l.status()).toMatchObject({ errors: 1, lastError: "model down" });
  });
});

test.describe("spawnArgs", () => {
  test("the model server runs at the voice units' priority, nice 10, and the lane's exact flags", () => {
    const [cmd, args] = spawnArgs({ bin: "/x/llama-server", model: "/m.gguf", mmproj: "/p.gguf", port: 8099 });
    expect(cmd).toBe("nice");
    expect(args.slice(0, 3)).toEqual(["-n", "10", "/x/llama-server"]);
    // -c 2048: the default context cost 2 GB more (measured 2026-10-22).
    expect(args.slice(3)).toEqual([
      "-m", "/m.gguf", "--mmproj", "/p.gguf", "--jinja",
      "-t", "4", "-c", "2048", "-np", "1", "--host", "127.0.0.1", "--port", "8099"
    ]);
  });
});

test.describe("prune", () => {
  test("keeps 7 days and no more", () => {
    const now = Date.UTC(2026, 9, 22, 12);
    const rows = [
      { at: now - RETENTION_MS - 1 },
      { at: now - RETENTION_MS },
      { at: now - 1000 }
    ];
    expect(prune(rows, now).map((r) => r.at)).toEqual([now - RETENTION_MS, now - 1000]);
  });

  test("caps the row count, keeping the newest", () => {
    const now = Date.now();
    const rows = Array.from({ length: MAX_ROWS + 5 }, (_, i) => ({ at: now - (MAX_ROWS + 5 - i) }));
    const kept = prune(rows, now);
    expect(kept).toHaveLength(MAX_ROWS);
    expect(kept[0].at).toBe(rows[5].at);
  });
});

test.describe("captionImage", () => {
  let server, base, seen, reply;
  test.beforeAll(async () => {
    server = http.createServer((req, res) => {
      let body = "";
      req.on("data", (c) => { body += c; });
      req.on("end", () => {
        seen = JSON.parse(body);
        res.writeHead(reply.status, { "content-type": "application/json" });
        res.end(JSON.stringify(reply.body));
      });
    });
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    base = `http://127.0.0.1:${server.address().port}`;
  });
  test.afterAll(() => new Promise((r) => server.close(r)));

  test("sends the image with thinking off and returns one tidy line", async () => {
    reply = { status: 200, body: { choices: [{ message: { content: "  A van is\n parked.  " } }] } };
    const text = await captionImage(base, img("x"));
    expect(text).toBe("A van is parked.");
    expect(seen.chat_template_kwargs).toEqual({ enable_thinking: false });
    expect(seen.reasoning_effort).toBe("none");
    expect(seen.temperature).toBe(0);
    const [image, prompt] = seen.messages[0].content;
    expect(image.image_url.url).toBe(`data:image/jpeg;base64,${img("x").toString("base64")}`);
    expect(prompt.text).toBe(PROMPT);
  });

  test("an error status or an empty reply throws instead of writing nothing as a caption", async () => {
    reply = { status: 500, body: { error: "boom" } };
    await expect(captionImage(base, img("x"))).rejects.toThrow(/HTTP 500/);
    reply = { status: 200, body: { choices: [{ message: { content: "   " } }] } };
    await expect(captionImage(base, img("x"))).rejects.toThrow(/no text/);
  });
});

test.describe("startCameraCaptions", () => {
  test("inert while CAMERA_CAPTIONS is unset; an edge fetches once it is 1", async () => {
    const saved = process.env.CAMERA_CAPTIONS;
    const manager = new EventEmitter();
    const fetched = [];
    const edge = (state, old = "off") => manager.emit("event", {
      eventType: "state_changed",
      data: { old_state: { state: old }, new_state: { entity_id: "binary_sensor.driveway_motion_detected", state } }
    });
    try {
      delete process.env.CAMERA_CAPTIONS;
      startCameraCaptions({
        manager, cameraIds: ["driveway"],
        fetchImage: async (id) => { fetched.push(id); return img("same"); },
        timing: { pollMs: 5, watchMs: 20 }
      });
      edge("on");
      await new Promise((r) => setTimeout(r, 50));
      expect(fetched).toEqual([]);
      expect(captionStatus().enabled).toBe(false);

      process.env.CAMERA_CAPTIONS = "1";
      edge("off", "on");          // an off edge is not motion
      edge("on", "on");           // nor is an attribute change while on
      await new Promise((r) => setTimeout(r, 50));
      expect(fetched).toEqual([]);
      edge("on");
      await expect.poll(() => fetched.length, { timeout: 2000 }).toBeGreaterThan(0);
      expect(fetched[0]).toBe("driveway");
      expect(captionStatus()).toMatchObject({ enabled: true, edges: 1 });
    } finally {
      if (saved === undefined) delete process.env.CAMERA_CAPTIONS;
      else process.env.CAMERA_CAPTIONS = saved;
    }
  });
});
