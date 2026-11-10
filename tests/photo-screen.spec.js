import { test, expect } from "@playwright/test";
import { rmSync } from "fs";
import os from "os";
import path from "path";
import {
  tilePlan, verdictFrom, inWindow, screenAssets, verdictOf, isScreenedOut, flaggedIds, allow, counts,
  enabled, __reset
} from "../server/services/photoScreen.js";
import { usableImage } from "../server/services/immichClient.js";

/* PHOTO SCREEN — the overnight "is anyone undressed in this" pass.
   Node-side, with the model and ffmpeg injected away: what is pinned here is
   the judgement around the model (tiling, reading its answer, failing open,
   the review), not the model. Its recall was measured on the box, once.

   ⚠ The store is a per-worker temp file, never data/photos/screened.json. */
const STORE = path.join(os.tmpdir(), `photo-screen-test-${process.pid}.json`);
test.beforeEach(() => { __reset({ file: STORE }); rmSync(STORE, { force: true }); });
test.afterAll(() => rmSync(STORE, { force: true }));

const A = "00000000-0000-4000-8000-00000000000a";
const B = "00000000-0000-4000-8000-00000000000b";
const C = "00000000-0000-4000-8000-00000000000c";

test.describe("tilePlan", () => {
  test("an ordinary 4:3 or 3:4 frame is asked about whole", () => {
    expect(tilePlan(1920, 1440)).toEqual(["null"]);
    expect(tilePlan(1440, 1920)).toEqual(["null"]);
  });

  // The photograph this exists for: whole, the model said NO.
  test("the 6668x1440 panorama is five squares that reach BOTH ends", () => {
    const plan = tilePlan(6668, 1440);
    expect(plan).toHaveLength(5);
    expect(plan[0]).toBe("crop=1440:1440:0:0");
    expect(plan[4]).toBe(`crop=1440:1440:${6668 - 1440}:0`); // the figure was at the far right
  });

  test("a tall frame tiles down, not across", () => {
    expect(tilePlan(1000, 3000)).toEqual(["crop=1000:1000:0:0", "crop=1000:1000:0:1000", "crop=1000:1000:0:2000"]);
  });

  test("unknown dimensions fall back to the whole frame rather than throwing", () => {
    expect(tilePlan(NaN, 0)).toEqual(["null"]);
  });
});

test.describe("verdictFrom — reading the model", () => {
  test("any YES flags; all NO is ok", () => {
    expect(verdictFrom(["NO", "NO", "YES"])).toBe("flag");
    expect(verdictFrom(["No.", " no"])).toBe("ok");
    expect(verdictFrom(["Yes, a person"])).toBe("flag");
  });

  test("an answer that is neither is NOT a verdict — it must not read as ok or as flag", () => {
    expect(verdictFrom(["NO", "I cannot help with that"])).toBeNull();
    expect(verdictFrom(["Nothing."])).toBeNull();
    expect(verdictFrom([])).toBeNull();
    expect(verdictFrom(null)).toBeNull();
  });
});

test.describe("the store and the review", () => {
  const screen = (answersById) => screenAssets(Object.keys(answersById), {
    screenOne: async (id) => {
      const a = answersById[id];
      if (a instanceof Error) throw a;
      return a;
    }
  });

  test("a flagged photograph is screened out; a clean one is not", async () => {
    const out = await screen({ [A]: ["NO", "YES"], [B]: ["NO"] });
    expect(out).toMatchObject({ screened: 2, flagged: 1, errors: 0 });
    expect(isScreenedOut(A)).toBe(true);
    expect(isScreenedOut(B)).toBe(false);
    expect(verdictOf(B)).toBe("ok");
    expect(flaggedIds()).toEqual([A]);
  });

  test("IT FAILS OPEN: a model error or an unreadable answer hides nothing and records nothing", async () => {
    const out = await screen({ [A]: new Error("model down"), [B]: ["maybe"] });
    expect(out).toMatchObject({ screened: 0, flagged: 0, errors: 2 });
    expect(isScreenedOut(A)).toBe(false);
    expect(isScreenedOut(B)).toBe(false);
    expect(verdictOf(A)).toBeNull(); // so it is asked again next run
    expect(verdictOf(B)).toBeNull();
  });

  test("a photograph is asked about ONCE — a verdict is never re-bought", async () => {
    await screen({ [A]: ["NO"] });
    let asked = 0;
    const out = await screenAssets([A], { screenOne: async () => { asked++; return ["YES"]; } });
    expect(asked).toBe(0);
    expect(out.known).toBe(1);
    expect(isScreenedOut(A)).toBe(false);
  });

  test("allow() is the review: shown again, and never re-screened", async () => {
    await screen({ [A]: ["YES"] });
    expect(allow(A)).toBe(true);
    expect(isScreenedOut(A)).toBe(false);
    expect(counts()).toEqual({ ok: 0, flag: 0, allowed: 1 });
    await screenAssets([A], { screenOne: async () => ["YES"] });
    expect(isScreenedOut(A)).toBe(false);
  });

  test("allow() on something that was never flagged does nothing", async () => {
    await screen({ [B]: ["NO"] });
    expect(allow(B)).toBe(false);
    expect(allow(C)).toBe(false);
    expect(verdictOf(B)).toBe("ok");
    expect(verdictOf(C)).toBeNull();
  });

  test("it stops when the quiet window closes, leaving the rest unscreened", async () => {
    let budget = 1;
    const asked = [];
    await screenAssets([A, B, C], {
      screenOne: async (id) => { asked.push(id); return ["NO"]; },
      keepGoing: () => budget-- > 0
    });
    expect(asked).toEqual([A]);
    expect(verdictOf(B)).toBeNull();
  });

  test("onFlag fires for a flag and only for a flag", async () => {
    const flagged = [];
    await screenAssets([A, B], {
      screenOne: async (id) => (id === A ? ["YES"] : ["NO"]),
      onFlag: (id) => flagged.push(id)
    });
    expect(flagged).toEqual([A]);
  });

  test("verdicts survive a restart", async () => {
    await screen({ [A]: ["YES"], [B]: ["NO"] });
    __reset({ file: STORE }); // drops the in-memory state; the next read is from disk
    expect(isScreenedOut(A)).toBe(true);
    expect(verdictOf(B)).toBe("ok");
    __reset({ file: STORE });
    rmSync(STORE, { force: true });
    expect(isScreenedOut(A)).toBe(false); // an unreadable store hides nothing
  });
});

/* The filter itself, at the choke point every search passes through. Called
   directly: Immich is not configured in the harness, so asserting it through a
   route would pass on an empty list whatever the filter did. */
test.describe("usableImage honours the screen", () => {
  const photo = (id) => ({ id, type: "IMAGE" });

  test("flagged → not usable; allowed → usable again; never-screened → usable", async () => {
    expect(usableImage(photo(A))).toBe(true);           // the baseline is a usable photograph
    await screenAssets([A, B], { screenOne: async (id) => (id === A ? ["YES"] : ["NO"]) });
    expect(usableImage(photo(A))).toBe(false);
    expect(usableImage(photo(B))).toBe(true);
    expect(usableImage(photo(C))).toBe(true);
    allow(A);
    expect(usableImage(photo(A))).toBe(true);
  });
});

test.describe("when it runs", () => {
  test("only in the small hours", () => {
    expect(inWindow(new Date(2026, 10, 12, 0, 30))).toBe(true);
    expect(inWindow(new Date(2026, 10, 12, 4, 59))).toBe(true);
    expect(inWindow(new Date(2026, 10, 12, 5, 0))).toBe(false);
    expect(inWindow(new Date(2026, 10, 12, 19, 0))).toBe(false);
  });

  test("off unless PHOTO_SCREEN=1", () => {
    const before = process.env.PHOTO_SCREEN;
    delete process.env.PHOTO_SCREEN;
    expect(enabled()).toBe(false);
    process.env.PHOTO_SCREEN = "1";
    expect(enabled()).toBe(true);
    if (before === undefined) delete process.env.PHOTO_SCREEN; else process.env.PHOTO_SCREEN = before;
  });
});
