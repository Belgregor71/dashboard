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
      searchPerson: async () => { asked++; return { ok: true, assets: [] }; }
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
  // Thirty on-this-day photos of nobody in particular.
  const others = Array.from({ length: 30 }, (_, i) =>
    photo(`o${i}`, `${2011 + (i % 15)}-05-${i % 2 ? "19" : "21"}T08:00:00.000Z`));
  // Forty photos of Melanie on ordinary days, 2011–2025.
  const hers = Array.from({ length: 40 }, (_, i) =>
    photo(`h${String(i).padStart(2, "0")}`, `${2011 + Math.floor(i * 15 / 40)}-0${1 + (i % 4)}-1${i % 10}T10:00:00.000Z`, ["Melanie Smith"]));
  const mel = (assets) => [{ name: "Melanie Smith", assets }];

  test("only photos taken ON the birthday are marked — the day after is filler, not 'her birthday'", () => {
    const onDay = photo("b1", "2019-05-20T18:00:00.000Z", ["Melanie Smith", "Kelly Rose"]);
    const dayAfter = photo("b2", "2019-05-21T09:00:00.000Z", ["Melanie Smith"]);
    const notHer = photo("b3", "2019-05-20T12:00:00.000Z", ["Kelly Rose"]);
    const out = weightPool([onDay, dayAfter, notHer, ...others], mel([]), BDAY);
    expect(out.filter((a) => a.birthdayOf).map((a) => a.id)).toEqual(["b1"]);
    expect(out[0]).toMatchObject({ id: "b1", birthdayOf: "Melanie Smith" });
    // The day-after photo is hers, so it is featured — unmarked.
    expect(out[1].id).toBe("b2");
    expect("birthdayOf" in out[1]).toBe(false);
  });

  test("about half: her twelve lead (birthday ones first, newest first), the rest thinned to twelve", () => {
    const bdays = [2014, 2019, 2017].map((y) => photo(`m${y}`, `${y}-05-20T10:00:00.000Z`, ["Melanie Smith"]));
    const out = weightPool(others, mel([...bdays, ...hers]), BDAY);
    expect(out).toHaveLength(24);
    expect(out.slice(0, 3).map((a) => a.id)).toEqual(["m2019", "m2017", "m2014"]);
    expect(out.slice(0, 3).every((a) => a.birthdayOf === "Melanie Smith")).toBe(true);
    // Nine filler photos of her, unmarked, spread across her years.
    const filler = out.slice(3, 12);
    expect(filler.every((a) => a.id.startsWith("h") && !("birthdayOf" in a))).toBe(true);
    const years = filler.map((a) => Number(a.localDateTime.slice(0, 4)));
    expect(Math.max(...years) - Math.min(...years)).toBeGreaterThanOrEqual(10);
    // Then twelve of the rest, spread across the pool rather than its first twelve.
    const rest = out.slice(12);
    expect(rest.every((a) => a.id.startsWith("o"))).toBe(true);
    expect(Math.max(...rest.map((a) => Number(a.id.slice(1))))).toBeGreaterThanOrEqual(25);
  });

  test("filler is photographs OF her — a crowd shot only when there are not enough of those", () => {
    const crowd = (id, y) => photo(id, `${y}-02-01T10:00:00.000Z`,
      ["Melanie Smith", "A One", "B Two", "C Three", "D Four", "E Five"]);
    const crowds = Array.from({ length: 20 }, (_, i) => crowd(`c${i}`, 2011 + (i % 14)));
    const close = hers.slice(0, 5);
    const out = weightPool(others, mel([...crowds, ...close]), BDAY);
    const featured = out.slice(0, 12);
    // All five close photographs, then seven crowds to make up the twelve.
    expect(featured.filter((a) => a.id.startsWith("h"))).toHaveLength(5);
    expect(featured.filter((a) => a.id.startsWith("c"))).toHaveLength(7);
    // With enough close ones, no crowd at all.
    const plenty = weightPool(others, mel([...crowds, ...hers]), BDAY);
    expect(plenty.slice(0, 12).some((a) => a.id.startsWith("c"))).toBe(false);
  });

  test("more birthday photos than the share: all of them, no filler", () => {
    const many = Array.from({ length: 15 }, (_, i) => photo(`m${i}`, `${2011 + i}-05-20T10:00:00.000Z`, ["Melanie Smith"]));
    const out = weightPool(others, mel([...many, ...hers]), BDAY);
    expect(out.slice(0, 15).every((a) => a.birthdayOf)).toBe(true);
    expect(out.some((a) => a.id.startsWith("h"))).toBe(false);
    expect(out).toHaveLength(30);
  });

  test("a person with one photo keeps a floor of six others, so the day's walk is not two photos", () => {
    const one = photo("m1", "2018-05-20T10:00:00.000Z", ["Melanie Smith"]);
    const out = weightPool(others, mel([one]), BDAY);
    expect(out).toHaveLength(7);
    expect(out[0].id).toBe("m1");
  });

  test("two birthdays on one day share the twelve", () => {
    const gregs = Array.from({ length: 20 }, (_, i) => photo(`g${i}`, `${2011 + (i % 14)}-03-0${1 + (i % 9)}T10:00:00.000Z`, ["Greg Dee"]));
    const out = weightPool(others, [{ name: "Melanie Smith", assets: hers }, { name: "Greg Dee", assets: gregs }], BDAY);
    expect(out.filter((a) => a.id.startsWith("h"))).toHaveLength(6);
    expect(out.filter((a) => a.id.startsWith("g"))).toHaveLength(6);
  });

  test("this year's photographs are not memories yet", () => {
    const today = photo("now", "2026-05-20T08:00:00.000Z", ["Melanie Smith"]);
    const out = weightPool(others, mel([today]), BDAY);
    expect(out).toBe(others);
  });

  test("a photo in both the pool and the person search is counted once", () => {
    const dup = photo("m1", "2018-05-20T10:00:00.000Z", ["Melanie Smith"]);
    const out = weightPool([dup, ...others], mel([dup]), BDAY);
    expect(out.filter((a) => a.id === "m1")).toHaveLength(1);
  });

  test("a birthday with no photographs leaves the pool exactly as it was", () => {
    expect(weightPool(others, mel([]), BDAY)).toBe(others);
  });

  test("never mutates the pool's assets (the route memo shares them)", () => {
    const shared = photo("m1", "2018-05-20T10:00:00.000Z", ["Melanie Smith"]);
    weightPool([shared], mel([]), BDAY);
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
      searchPerson: async () => ({ ok: false, assets: [] })
    });
    expect(out.ok).toBe(false);
  });

  test("a day with no birthday returns the base answer untouched", async () => {
    const b = base();
    const out = await withOccasions(b, new Date(2026, 6, 1), {
      fetchPeople: async () => ({ ok: true, people: [MELANIE] }),
      searchPerson: async () => { throw new Error("must not search"); }
    });
    expect(out).toBe(b);
  });

  test("searches each birthday person once, by their Immich id", async () => {
    const searched = [];
    await withOccasions(base(), BDAY, {
      fetchPeople: async () => ({ ok: true, people: [MELANIE, GREG, KELLY] }),
      searchPerson: async (id) => { searched.push(id); return { ok: true, assets: [] }; }
    });
    expect(searched.sort()).toEqual(["p-greg", "p-mel"]);
  });

  test("respects the skip list from the env", async () => {
    process.env.IMMICH_OCCASION_SKIP = "Melanie Smith";
    const searched = [];
    await withOccasions(base(), BDAY, {
      fetchPeople: async () => ({ ok: true, people: [MELANIE, GREG] }),
      searchPerson: async (id) => { searched.push(id); return { ok: true, assets: [] }; }
    });
    expect(searched).toEqual(["p-greg"]);
  });

  test("end to end: the person search's birthday photograph is marked and leads the pool", async () => {
    const found = photo("m1", "2019-05-20T19:00:00.000Z", ["Melanie Smith"]);
    const out = await withOccasions(base(), BDAY, {
      fetchPeople: async () => ({ ok: true, people: [MELANIE] }),
      searchPerson: async () => ({ ok: true, assets: [found] })
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
