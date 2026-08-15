import { test, expect } from "./fixtures/coverage.js";

/* ═══════════════════════════════════════════════════════════════════════════
   THE CURATED YEAR — depth 3 leads with what somebody chose.

   `src/v3/subjects/memories.js` asked, in its own header, for "a design
   decision rather than a heuristic": the wall showed seven lovely border collie
   photographs, a product shot of two supplement bottles, and a close-up of a
   sandwich. All real photographs of unremarkable things, which no pixel rule
   catches and which two previously built, previously REJECTED filters prove is
   the wrong lane to fix it in.

   The answer was already on the box and severed from it: 73 memories the
   household authored through Memory Studio, photo-anchored and titled in a
   person's own words, which nothing had read since the V3 cutover.

   So the three things these specs are about are the three ways preference can
   silently become something else:

     · the flag not being a rollback — flag-off must not even FETCH /api/memories,
       or the "off" build is a different build that happens to look the same;
     · preference quietly becoming exclusion — the raw pool must still fill the
       3×3, because filtering the library is exactly the mistake this replaces;
     · the same photograph appearing twice, once with the household's words and
       once with a bare year, which is what makes curation look like a bug.

   Every upstream is answered here, for the reason tests/v3-subjects.spec.js
   paid for on its first run: what a subject shows is a function of the house's
   real state, so a spec about subjects cannot share one.
   ═══════════════════════════════════════════════════════════════════════════ */

/* Today, in LOCAL parts. An authored memory's anchor is compared with
   getMonth()/getDate(), so a fixture stamped from a UTC slice is a spec that
   passes before 10am in Brisbane and fails after it. */
function todayParts() {
  const d = new Date();
  return { month: d.getMonth() + 1, day: d.getDate(), year: d.getFullYear() };
}

const RAW = {
  assets: [
    { id: "raw-1", localDateTime: "2019-08-10T08:00:00Z", city: "Nudgee" },
    { id: "raw-2", localDateTime: "2021-08-10T08:00:00Z", city: null },
    { id: "raw-3", localDateTime: "2022-08-10T08:00:00Z", city: "Oxley Vale" }
  ]
};

/** An authored entry anchored to today, the shape Memory Studio writes. */
function authoredToday(overrides = {}) {
  const { month, day } = todayParts();
  return {
    id: "learnt-how-to-cook-thai-in-chang-mai-mrkj16in",
    kind: "trip",
    title: "learnt how to cook Thai in Chang Mai",
    tags: ["autumn", "bright"],
    photos: [{ immich: "f3ff1967-008e-4abc-a83c-4186fbc314b2" }],
    sensitivity: "normal",
    recurring: { month, day },
    ...overrides
  };
}

async function bootV3(page, { routes = {}, flags = {} } = {}) {
  const pageErrors = [];
  const fetched = [];
  page.on("pageerror", (err) => pageErrors.push(err.message));

  /* ONE handler that dispatches by pathname prefix, rather than a specific
     route per upstream plus a catch-all. page.route matches
     LAST-registered-first, so the two-handler shape only works if the catch-all
     is registered FIRST — a rule that is invisible at the call site and has
     been got wrong here before (reference-playwright-route-order). Dispatching
     inside one handler removes the ordering question entirely. */
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    fetched.push(url.pathname);
    const key = Object.keys(routes).find((k) => url.pathname.startsWith(k));
    if (key) {
      const body = routes[key];
      if (body === null) return route.fulfill({ status: 503, contentType: "application/json", body: "{}" });
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
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

  /* The flag is appended to the real /js/config.js rather than set from an init
     script — the repo's established way (ambient-memory.spec.js et al), and the
     only one that is true before the module reads it. window.CONFIG is written
     by a separate <script> tag, so anything that runs earlier has nothing to
     assign to and anything that runs later is testing the NEXT page load. */
  await page.route("**/js/config.js", async (route) => {
    const res = await route.fetch();
    const body =
      (await res.text()) +
      Object.entries(flags)
        .map(([k, v]) => `\nwindow.CONFIG.features.${k} = ${JSON.stringify(v)};`)
        .join("") +
      "\n";
    await route.fulfill({ response: res, body });
  });

  await page.goto("/v3/");
  await page.waitForFunction(() => typeof window.__v3 === "function");
  return { pageErrors, fetched };
}

async function showYear(page) {
  return page.evaluate(async () => {
    await window.__v3Transcript("show me the year");
    const mount = document.getElementById("subject-mount");
    return {
      subject: window.__v3().subject,
      depth: window.__depth().depth,
      images: mount.querySelectorAll("img").length,
      srcs: Array.from(mount.querySelectorAll("img")).map((i) => new URL(i.src).pathname),
      captions: Array.from(mount.querySelectorAll(".subject__caption-sm")).map((n) => n.textContent)
    };
  });
}

/* ── Stage 3a · the runtime is ARMED ────────────────────────────────────────
   The defect under all of this, and the one that looked wired: `collectMemory`
   was imported by attentionEngine.js:19 and therefore passed the closure test,
   while `initMemoryRuntime()` had exactly one caller — js/core/app.js — that V3
   does not import. So `window.__memoryState` was UNDEFINED on the live wall and
   every one of the 73 authored memories reached nothing, silently, for the
   whole life of the cutover.

   ⚠ The shape of that bug is why this spec asserts the HANDLE and not the
   import. An import graph cannot tell you whether anything called the function.
─────────────────────────────────────────────────────────────────────────── */

test("the memory runtime is armed on V3 — the handle exists and reads enabled", async ({ page }) => {
  const { pageErrors } = await bootV3(page, {
    routes: { "/api/memories": { memories: [authoredToday()] } }
  });

  const state = await page.evaluate(() =>
    typeof window.__memoryState === "function" ? window.__memoryState() : null
  );

  expect(state, "window.__memoryState is undefined — the runtime was never armed").not.toBeNull();
  expect(state.enabled).toBe(true);
  // Loaded, not merely enabled: an armed runtime with an empty store is the
  // same silence with better paperwork.
  await expect
    .poll(async () => (await page.evaluate(() => window.__memoryState().entries)).length)
    .toBe(1);
  expect(pageErrors).toEqual([]);
});

test("memoryEngine:false is the rollback — armed, and deliberately holding nothing", async ({ page }) => {
  await bootV3(page, {
    routes: { "/api/memories": { memories: [authoredToday()] } },
    flags: { memoryEngine: false }
  });

  const state = await page.evaluate(() => window.__memoryState());
  // The handle is registered in BOTH states on purpose, so CDP can tell "off"
  // from "broken" without waiting for the right day.
  expect(state.enabled).toBe(false);
  expect(state.entries).toEqual([]);
});

/* ── The rollback ───────────────────────────────────────────────────────── */

test("flag-off never fetches the authored store, and the grid is what shipped before", async ({ page }) => {
  const { pageErrors, fetched } = await bootV3(page, {
    routes: { "/api/immich/on-this-day": RAW, "/api/memories": { memories: [authoredToday()] } },
    flags: { v3CuratedYear: false }
  });

  /* ⚠ COUNTED ACROSS THE OPEN, not from zero. `/api/memories` is fetched at
     boot whatever this flag says — Stage 3a armed initMemoryRuntime, which
     loads the same file for the attention queue's Low-band memory candidate.
     Asserting "never fetched" passed nothing and taught the wrong lesson: what
     this flag governs is whether the SUBJECT reads the store, and the honest
     measurement is the delta across the open. */
  const before = fetched.filter((p) => p === "/api/memories").length;
  const got = await showYear(page);
  const after = fetched.filter((p) => p === "/api/memories").length;

  expect(got.subject).toBe("show.year");
  expect(got.images).toBe(3);
  // Not merely "the curated plate is absent" — the request is never MADE. An
  // off state that still pays for the fetch is a different build wearing the
  // old build's face.
  expect(after - before).toBe(0);
  expect(got.srcs.every((s) => s.startsWith("/api/immich/asset/"))).toBe(true);
  expect(pageErrors).toEqual([]);
});

/* ── ON ─────────────────────────────────────────────────────────────────── */

test("what somebody CHOSE comes first, in their own words", async ({ page }) => {
  const { pageErrors } = await bootV3(page, {
    routes: { "/api/immich/on-this-day": RAW, "/api/memories": { memories: [authoredToday()] } },
    flags: { v3CuratedYear: true }
  });

  const got = await showYear(page);

  expect(got.subject).toBe("show.year");
  expect(got.depth).toBe(3);
  expect(got.srcs[0]).toBe("/api/immich/asset/f3ff1967-008e-4abc-a83c-4186fbc314b2/thumb");
  // The household's sentence, not "3 years ago · Nudgee".
  expect(got.captions[0]).toBe("learnt how to cook Thai in Chang Mai");
  expect(pageErrors).toEqual([]);
});

/* PREFERENCE IS NOT EXCLUSION, and this is the assertion that keeps it honest.
   The whole reason curation was chosen over a third filter is that filters were
   built twice, looked exact, and dropped real memories. One curated plate must
   not shrink the year to one photograph. */
test("the raw pool still FILLS the grid — nothing is excluded, something is preferred", async ({ page }) => {
  await bootV3(page, {
    routes: { "/api/immich/on-this-day": RAW, "/api/memories": { memories: [authoredToday()] } },
    flags: { v3CuratedYear: true }
  });

  const got = await showYear(page);
  expect(got.images).toBe(4); // 1 curated + all 3 raw
  expect(got.srcs.slice(1)).toEqual([
    "/api/immich/asset/raw-1/thumb",
    "/api/immich/asset/raw-2/thumb",
    "/api/immich/asset/raw-3/thumb"
  ]);
});

test("a photograph that is both curated and in the raw pool appears ONCE", async ({ page }) => {
  // Curation looks like a bug the moment the same picture is on screen twice —
  // once with a sentence under it and once with a bare year.
  await bootV3(page, {
    routes: {
      "/api/immich/on-this-day": RAW,
      "/api/memories": { memories: [authoredToday({ photos: [{ immich: "raw-2" }] })] }
    },
    flags: { v3CuratedYear: true }
  });

  const got = await showYear(page);
  expect(got.images).toBe(3);
  expect(got.srcs.filter((s) => s.includes("raw-2"))).toHaveLength(1);
  expect(got.captions[0]).toBe("learnt how to cook Thai in Chang Mai");
});

test("an entry anchored to another day is not today's memory", async ({ page }) => {
  const { month, day } = todayParts();
  await bootV3(page, {
    routes: {
      "/api/immich/on-this-day": RAW,
      "/api/memories": {
        memories: [authoredToday({ recurring: { month: month === 1 ? 12 : month - 1, day } })]
      }
    },
    flags: { v3CuratedYear: true }
  });

  const got = await showYear(page);
  expect(got.images).toBe(3);
  expect(got.srcs.every((s) => s.startsWith("/api/immich/asset/raw-"))).toBe(true);
});

/* ⚠ The reason to lead with the LOCAL store, stated as a test. Immich lives on
   a NAS that sleeps; before this, a sleeping NAS meant depth 3 had nothing and
   refused to open. The household's own writing does not depend on it. */
test("a curated day still opens with Immich unreachable", async ({ page }) => {
  const { pageErrors } = await bootV3(page, {
    routes: { "/api/immich/on-this-day": null, "/api/memories": { memories: [authoredToday()] } },
    flags: { v3CuratedYear: true }
  });

  const got = await showYear(page);
  expect(got.depth).toBe(3);
  expect(got.images).toBe(1);
  expect(got.captions[0]).toBe("learnt how to cook Thai in Chang Mai");
  expect(pageErrors).toEqual([]);
});

test("nothing curated and nothing photographed is still a refusal, not a black screen", async ({ page }) => {
  const { pageErrors } = await bootV3(page, {
    routes: { "/api/immich/on-this-day": { assets: [] }, "/api/memories": { memories: [] } },
    flags: { v3CuratedYear: true }
  });

  const got = await showYear(page);
  expect(got.subject).toBeNull();
  expect(got.depth).not.toBe(3);
  expect(pageErrors).toEqual([]);
});

/* ⚠ THE HOUSE DOES NOT PUT GRIEF INTO WORDS. memoryEngine.toSurface makes
   exactly one rule about a tender entry — `caption: null` — and a screen that
   was asked for does not get to invent an exception to it. 12 of the 73 live
   authored memories are tender and the next curated day after this shipped
   (20 August, a dog, 2006) is one of them, so this is the real case. */
test("a tender memory is SHOWN but never narrated", async ({ page }) => {
  const { year, month, day } = todayParts();
  const iso = `${year - 20}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  await bootV3(page, {
    routes: {
      "/api/immich/on-this-day": { assets: [] },
      "/api/memories": {
        memories: [
          authoredToday({
            id: "boof",
            title: "Boof loved his bear",
            kind: "pet",
            sensitivity: "tender",
            date: iso,
            recurring: undefined,
            photos: [{ immich: "boof-1" }]
          })
        ]
      }
    },
    flags: { v3CuratedYear: true }
  });

  const got = await showYear(page);
  expect(got.images).toBe(1); // the photograph is there
  expect(got.captions).toEqual(["20 years ago"]); // the sentence is not
  expect(got.captions.join(" ")).not.toContain("Boof");
});

/* A dated entry earns "N years ago" in front of its own words; a recurring one
   has no year to count from and must not invent one. `new Date(null)` is the
   epoch rather than an invalid date, which is how an undated memory once got
   captioned "56 years ago". */
test("a dated memory counts the years; a recurring one says only what was written", async ({ page }) => {
  const { year, month, day } = todayParts();
  const iso = `${year - 3}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  await bootV3(page, {
    routes: {
      "/api/immich/on-this-day": { assets: [] },
      "/api/memories": {
        memories: [
          authoredToday({ id: "dated", date: iso, recurring: undefined, photos: [{ immich: "d1" }] }),
          authoredToday({ id: "recurring", title: "the good jacaranda year", photos: [{ immich: "r1" }] })
        ]
      }
    },
    flags: { v3CuratedYear: true }
  });

  const got = await showYear(page);
  expect(got.captions).toEqual([
    "3 years ago · learnt how to cook Thai in Chang Mai",
    "the good jacaranda year"
  ]);
});
