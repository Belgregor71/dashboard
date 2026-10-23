import { test, expect } from "@playwright/test";
import {
  birthdaysOn,
  weightPool,
  withOccasions,
  labelOccasions
} from "../server/services/photoOccasions.js";

/* A birthday on the ambient ground (server/services/photoOccasions.js).

   Node-side unit tests. The route end is unreachable here, as it is for
   photo-trips.spec.js: Immich is unconfigured in the suite, so
   /api/immich/on-this-day answers { assets: [] } before any of this runs. The
   two Immich calls are injected through withOccasions' `deps` seam. Live proof
   is owed on the wall, with a pinned date (see the session's memory entry). */

const BDAY = new Date(2026, 4, 20, 9, 0);   // 20 May 2026, local
const MELANIE = { id: "p-mel", name: "Melanie Smith", birthDate: "1990-05-20" };
const GREG = { id: "p-greg", name: "Greg Dee", birthDate: "1971-05-20" };
const KELLY = { id: "p-kel", name: "Kelly Rose", birthDate: "1985-11-02" };

const photo = (id, localDateTime, people = []) => ({ id, localDateTime, people, city: null });

let saved;
test.beforeEach(() => {
  saved = { on: process.env.IMMICH_OCCASIONS, skip: process.env.IMMICH_OCCASION_SKIP };
  process.env.IMMICH_OCCASIONS = "1";
  delete process.env.IMMICH_OCCASION_SKIP;
});
test.afterEach(() => {
  for (const [k, v] of [["IMMICH_OCCASIONS", saved.on], ["IMMICH_OCCASION_SKIP", saved.skip]]) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

test.describe("OFF ⇒ identity — the rollback path", () => {
  test("withOccasions hands back the SAME object with the env unset, and never asks Immich", async () => {
    delete process.env.IMMICH_OCCASIONS;
    const base = { ok: true, assets: [photo("a", "2019-05-20T10:00:00.000Z", ["Melanie Smith"])] };
    let asked = 0;
    const out = await withOccasions(base, BDAY, {
      fetchPeople: async () => { asked++; return { ok: true, people: [MELANIE] }; },
      searchDay: async () => { asked++; return { ok: true, assets: [] }; }
    });
    expect(out).toBe(base);
    expect(asked).toBe(0);
  });

  test("labelOccasions hands back the SAME array when nothing is marked", () => {
    const assets = [photo("a", "2019-05-20T10:00:00.000Z", ["Melanie Smith"])];
    expect(labelOccasions(assets)).toBe(assets);
  });
});

test.describe("birthdaysOn", () => {
  test("matches the local day and month only", () => {
    const got = birthdaysOn([MELANIE, KELLY], BDAY);
    expect(got.map((b) => b.name)).toEqual(["Melanie Smith"]);
    expect(got[0].birthYear).toBe(1990);
    expect(birthdaysOn([MELANIE], new Date(2026, 4, 21))).toEqual([]);
  });

  test("the skip list drops a full name, case-insensitively, and nobody else", () => {
    const got = birthdaysOn([MELANIE, GREG], BDAY, ["  greg   DEE "]);
    expect(got.map((b) => b.name)).toEqual(["Melanie Smith"]);
  });

  test("29 February only comes round on 29 February", () => {
    const leap = { id: "p-l", name: "Leap Kid", birthDate: "2004-02-29" };
    expect(birthdaysOn([leap], new Date(2027, 1, 28))).toEqual([]);
    expect(birthdaysOn([leap], new Date(2027, 2, 1))).toEqual([]);
    expect(birthdaysOn([leap], new Date(2028, 1, 29)).map((b) => b.name)).toEqual(["Leap Kid"]);
  });

  test("a malformed or absent birth date is nobody's birthday", () => {
    const bad = [{ id: "x", name: "X", birthDate: "20/05/1990" }, { id: "y", name: "Y", birthDate: null }];
    expect(birthdaysOn(bad, BDAY)).toEqual([]);
  });
});

test.describe("weightPool", () => {
  const others = Array.from({ length: 30 }, (_, i) =>
    photo(`o${i}`, `${2011 + (i % 15)}-05-${i % 2 ? "19" : "21"}T08:00:00.000Z`));

  test("only photos of the person taken ON the birthday are marked — not the day after", () => {
    const onDay = photo("b1", "2019-05-20T18:00:00.000Z", ["Melanie Smith", "Kelly Rose"]);
    const dayAfter = photo("b2", "2019-05-21T09:00:00.000Z", ["Melanie Smith"]);
    const notHer = photo("b3", "2019-05-20T12:00:00.000Z", ["Kelly Rose"]);
    const out = weightPool([onDay, dayAfter, notHer, ...others], [], [MELANIE], BDAY);
    const marked = out.filter((a) => a.birthdayOf);
    expect(marked.map((a) => a.id)).toEqual(["b1"]);
    expect(marked[0].birthdayOf).toBe("Melanie Smith");
  });

  test("about half: birthday photos first newest-year first, the rest thinned to as many again", () => {
    const bday = Array.from({ length: 10 }, (_, i) =>
      photo(`m${i}`, `${2012 + i}-05-20T10:00:00.000Z`, ["Melanie Smith"]));
    const out = weightPool([...others, ...bday.slice(0, 4)], bday.slice(4), [MELANIE], BDAY);
    expect(out).toHaveLength(20);
    expect(out.slice(0, 10).every((a) => a.birthdayOf === "Melanie Smith")).toBe(true);
    expect(out.slice(0, 10).map((a) => a.id)).toEqual(["m9", "m8", "m7", "m6", "m5", "m4", "m3", "m2", "m1", "m0"]);
    expect(out.slice(10).some((a) => a.birthdayOf)).toBe(false);
    // Spread across the pool, not the first ten of it.
    const kept = out.slice(10).map((a) => Number(a.id.slice(1)));
    expect(Math.max(...kept)).toBeGreaterThanOrEqual(25);
  });

  test("a thin birthday keeps a floor of six others, so the day's walk is not four photos", () => {
    const one = photo("m1", "2018-05-20T10:00:00.000Z", ["Melanie Smith"]);
    const out = weightPool(others, [one], [MELANIE], BDAY);
    expect(out).toHaveLength(7);
    expect(out[0].id).toBe("m1");
  });

  test("a photo in both the pool and the person search is counted once", () => {
    const dup = photo("m1", "2018-05-20T10:00:00.000Z", ["Melanie Smith"]);
    const out = weightPool([dup, ...others], [dup], [MELANIE], BDAY);
    expect(out.filter((a) => a.id === "m1")).toHaveLength(1);
  });

  test("a birthday with no photographs leaves the pool exactly as it was", () => {
    expect(weightPool(others, [], [MELANIE], BDAY)).toBe(others);
  });

  test("never mutates the pool's assets (the route memo shares them)", () => {
    const shared = photo("m1", "2018-05-20T10:00:00.000Z", ["Melanie Smith"]);
    weightPool([shared], [], [MELANIE], BDAY);
    expect("birthdayOf" in shared).toBe(false);
  });
});

test.describe("withOccasions", () => {
  const base = () => ({ ok: true, assets: [photo("o1", "2015-05-20T08:00:00.000Z")] });

  test("a failed people fetch is NOT cacheable — a pool that missed a birthday must not pin for an hour", async () => {
    const out = await withOccasions(base(), BDAY, { fetchPeople: async () => ({ ok: false, people: [] }) });
    expect(out.ok).toBe(false);
    expect(out.assets.map((a) => a.id)).toEqual(["o1"]);
  });

  test("a failed person search is NOT cacheable either", async () => {
    const out = await withOccasions(base(), BDAY, {
      fetchPeople: async () => ({ ok: true, people: [MELANIE] }),
      searchDay: async () => ({ ok: false, assets: [] })
    });
    expect(out.ok).toBe(false);
  });

  test("a day with no birthday returns the base answer untouched", async () => {
    const b = base();
    const out = await withOccasions(b, new Date(2026, 6, 1), {
      fetchPeople: async () => ({ ok: true, people: [MELANIE] }),
      searchDay: async () => { throw new Error("must not search"); }
    });
    expect(out).toBe(b);
  });

  test("searches past years only, never before the person was born, at most fifteen back", async () => {
    const calls = [];
    const young = { id: "p-y", name: "Young One", birthDate: "2021-05-20" };
    await withOccasions(base(), BDAY, {
      fetchPeople: async () => ({ ok: true, people: [MELANIE, young] }),
      searchDay: async (id, month, day, years) => { calls.push({ id, month, day, years }); return { ok: true, assets: [] }; }
    });
    const mel = calls.find((c) => c.id === "p-mel");
    expect(mel.month).toBe(4);
    expect(mel.day).toBe(20);
    expect(mel.years[0]).toBe(2025);
    expect(mel.years.at(-1)).toBe(2011);
    expect(calls.find((c) => c.id === "p-y").years).toEqual([2025, 2024, 2023, 2022, 2021]);
  });

  test("respects the skip list from the env", async () => {
    process.env.IMMICH_OCCASION_SKIP = "Melanie Smith";
    const searched = [];
    await withOccasions(base(), BDAY, {
      fetchPeople: async () => ({ ok: true, people: [MELANIE, GREG] }),
      searchDay: async (id) => { searched.push(id); return { ok: true, assets: [] }; }
    });
    expect(searched).toEqual(["p-greg"]);
  });

  test("end to end: the person search's photographs are marked and lead the pool", async () => {
    const found = photo("m1", "2019-05-20T19:00:00.000Z", ["Melanie Smith"]);
    const out = await withOccasions(base(), BDAY, {
      fetchPeople: async () => ({ ok: true, people: [MELANIE] }),
      searchDay: async () => ({ ok: true, assets: [found] })
    });
    expect(out.ok).toBe(true);
    expect(out.assets[0]).toMatchObject({ id: "m1", birthdayOf: "Melanie Smith" });
  });
});

test.describe("labelOccasions", () => {
  const marked = (people = ["Melanie Smith", "Kelly Rose"]) =>
    ({ ...photo("m1", "2019-05-20T19:00:00.000Z", people), birthdayOf: "Melanie Smith" });

  test("says whose birthday it was, with the photograph's own year", () => {
    const [out] = labelOccasions([marked()], { nameFor: (n) => n.split(" ")[0] });
    expect(out.trip).toBe("Melanie's birthday 2019");
  });

  test("takes the person out of the names line, so it never reads 'Melanie · Melanie's birthday'", () => {
    const [out] = labelOccasions([marked()], { nameFor: (n) => n.split(" ")[0] });
    expect(out.people).toEqual(["Kelly Rose"]);
  });

  test("someone on the never-name list gets 'Birthday 2019' and their name appears nowhere", () => {
    const [out] = labelOccasions([marked()], { hideNames: ["melanie smith"], nameFor: (n) => n });
    expect(out.trip).toBe("Birthday 2019");
    expect(JSON.stringify(out)).not.toContain("Melanie");
  });

  test("ALWAYS strips the internal mark — it holds a full name", () => {
    const out = labelOccasions([marked(), photo("o1", "2015-05-20T08:00:00.000Z")]);
    expect(out).toHaveLength(2);
    for (const a of out) expect("birthdayOf" in a).toBe(false);
    // An unmarked neighbour passes through as the same object.
    expect(out[1].id).toBe("o1");
    expect("trip" in out[1]).toBe(false);
  });

  test("never mutates its input", () => {
    const m = marked();
    labelOccasions([m]);
    expect(m.birthdayOf).toBe("Melanie Smith");
    expect("trip" in m).toBe(false);
  });
});
