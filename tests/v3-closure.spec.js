import { test, expect } from "@playwright/test";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve, relative, sep, extname } from "node:path";

/* ═══════════════════════════════════════════════════════════════════════════
   THE V3 ↔ src/js BOUNDARY, MADE ENFORCEABLE.

   Cutover step 1 (docs/design/V3-CUTOVER.md §1). Once `/` serves V3, `src/js/`
   reads as "the old dashboard" — and it is nothing of the kind. It is V3's
   runtime library. V3's import closure is 71 files and 41 of them live in
   `src/js/`: the event bus, the entire Home Assistant client, the attention
   engine, the TTS lane. A cleanup that "retires the legacy tree" would take
   all of it out from under the only surface still running.

   Forty-two, in fact. §1 counted imports; `js/config.js` arrives by
   `<script>` tag and is the one whose loss is silent. See SCRIPT_TAG below.

   §1 offered two ways to make that visible: a header comment on each module
   (cheap) or a move to `src/shared/` (durable). The move costs 234 import
   rewrites across 95 files, 155 of them in the incumbent tree the cutover is
   not supposed to touch. So: the comment, plus this — which is what makes the
   comment durable. A header only warns whoever opens the file. This goes red.

   Five assertions, and they fail in different directions on purpose:

     1. every specifier in the closure resolves     → deletion / rename
     2. the src/js/ members equal the manifest      → silent coupling drift,
                                                       both directions
     3. each manifest member carries the marker     → header dropped in a rewrite
     4. v3/index.html still loads /js/config.js     → the dependency no import
                                                       graph can see
     5. nothing else carries the marker             → header left behind after a
                                                       module genuinely left

   ⚠ The manifest below is not a cache to refresh until green. A diff against it
   means V3's dependency on the incumbent tree just changed — which is exactly
   the event §1 exists to notice. Read the change, then record it.
   ═══════════════════════════════════════════════════════════════════════════ */

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(root, "src");
const ENTRY = join(SRC, "v3", "main.js");

const MARKER = "V3-SHARED-RUNTIME";

// Loaded by BOTH surfaces — the incumbent at / and V3 at /v3/.
const SHARED_BOTH = [
  "js/config/alertLines.js",
  /* ⚠ BOTH ENTERED V3'S CLOSURE 2026-08-16 with the week-ahead strip, and both
     are the same fact: V3 had never drawn an animated weather icon, so the
     WMO-code → filename map and the lottie loader were incumbent-only. Neither
     imports anything itself, so this pair is the whole of the addition — the
     lottie-web PLAYER is a node_modules specifier and is not walked here.

     The loader is safe on any surface with or without the flag: it returns
     immediately when `window.lottie` is unset, which is what it did on V3 from
     the cutover until v3/main.js's "lottie" stage started setting it. */
  "js/config/weather-animations.js",
  /* ⚠ `js/config/config.js` LEFT V3'S CLOSURE on 2026-08-13, and the drift is
     the point rather than an accident. It was reachable only because
     houseSnapshot.js and briefingData.js imported COMMUTE_ORIGIN and the two
     destinations from it — this house's street address, in a file that is
     tracked in a PUBLIC repo and bundled to the browser. Those constants are
     `.env` values on the server now (server/routes/commute.js), so nothing V3
     loads reaches this module any more.

     It is still very much alive on the INCUMBENT surface, where six modules
     import WEATHER_LAT/WEATHER_LON from it. Removed from this list, not
     deleted from the tree. */
  "js/core/config.js",
  "js/core/contextStore.js",
  "js/core/eventBus.js",
  /* ⚠ ENTERED V3'S CLOSURE 2026-08-17 with the context feed. Phase 6's runtime
     is the fourth init* the cutover disarmed — `window.__intent` read
     `undefined` on the wall while its flag read true — and it could not be
     armed until contextStore had a V3 writer, because deriveIntent reads
     exactly the three slices that were frozen. See v3/main.js stage "intent";
     the arming rides `v3HouseIntent`, which is NOT `houseIntent`. */
  "js/core/intentEngine.js",
  "js/core/memoryRuntime.js",
  "js/core/personality.js",
  "js/core/personalityRuntime.js",
  /* Phase 8, armed on V3 2026-08-16. It had exactly one caller — js/core/app.js,
     which V3 does not import — so the house had learned nothing since the
     cutover. Same defect the memory stage in v3/main.js records; see the
     "routines" stage there. */
  "js/core/routineRuntime.js",
  "js/core/tts.js",
  "js/helpers/lottie.js",
  "js/modules/aiBriefing.js",
  "js/modules/briefingData.js",
  "js/services/alertRouter.js",
  "js/services/attentionEngine.js",
  "js/services/attentionRank.js",
  "js/services/briefingSchedule.js",
  "js/services/candidateSources.js",
  "js/services/delight.js",
  /* ⚠ ENTERED V3'S CLOSURE 2026-08-17, and it entered by being CARVED OUT of
     modules/goodnightRoutine.js rather than by a new import of it. That module
     ends in `engageScreensaver()` — an incumbent-only surface — so reaching its
     two pure functions from V3 would have dragged the whole incumbent
     screensaver into V3's bundle. The shared half moved here; each surface
     keeps its own ending. */
  "js/services/goodnight.js",
  "js/services/homeAssistant/client.js",
  "js/services/homeAssistant/entityFeed.js",
  "js/services/homeAssistant/state.js",
  "js/services/homeAssistant/todoEntities.js",
  "js/services/houseModel.js",
  "js/services/insightRules.js",
  "js/services/localAnswers.js",
  "js/services/localIntents.js",
  "js/services/mealEvent.js",
  "js/services/mediaImage.js",
  "js/services/mediaSource.js",
  "js/services/memoryEngine.js",
  "js/services/momentsEngine.js",
  "js/services/occasions.js",
  "js/services/photoMemory.js",
  "js/services/predictiveRules.js",
  "js/services/quietMode.js",
  "js/services/routineStore.js",
  "js/services/sleepSummary.js",
  "js/services/vocabulary.js",
  "js/services/voiceSnapshot.js",
  "js/services/weather/bom.js",
  "js/vendor/suncalc.js",
  /* ⚠ ENTERED V3'S CLOSURE 2026-08-17, and like goodnight.js above it entered
     by a CARVE-OUT rather than a new import: `getBaseCategory` lived in
     services/weather/renderer.js, a 900-line DOM renderer whose import would
     have pulled the incumbent's entire weather surface into V3's bundle. It
     moved down here next to the map it collapses — one list, not two — and
     renderer.js re-exports it so the incumbent's address is unchanged. */
  "js/weatherPrompts.js"
];

// In `src/js/` for history, but only V3 loads them. These are the dangerous
// two: delete them with "the old dashboard" and nothing on / goes wrong to
// warn you — the surface that breaks is the one nobody is testing at the time.
const V3_ONLY = [
  "js/services/displayWindow.js",
  "js/services/houseSnapshot.js"
];

/* Not imported by anything — `src/v3/index.html:110` loads it as a plain
   `<script src="/js/config.js">`, exactly as the incumbent does. §1 missed it
   for that reason: it is invisible to an import graph.

   ⚠ It is also the worst of the 42 to lose. It sets `window.CONFIG`, and every
   V3 flag read is `window.CONFIG?.features?.x` — optional-chained. Retire
   `src/js/` and V3 does not throw. It boots with every feature flag silently
   false, which is a total flag rollback presenting as normal operation. An
   error would have been kinder. Hence the separate script-tag assertion. */
const SCRIPT_TAG = ["js/config.js"];

const IMPORTED = [...SHARED_BOTH, ...V3_ONLY];
const MANIFEST = [...IMPORTED, ...SCRIPT_TAG].sort();

/* The same walk the cutover plan used: static `from "…"` / `import "…"`
   specifiers, transitively. Complete for this tree — there are no dynamic
   `import()` calls and no `export … from` re-exports in src/ (the one mention
   of `import()` in v3/main.js is prose in a comment explaining why a spec
   cannot use one). If either ever lands, this walker must learn it before it
   can be trusted again. */
function importClosure(entry) {
  const seen = new Set();
  const unresolved = [];
  const stack = [resolve(entry)];

  while (stack.length) {
    const file = stack.pop();
    if (seen.has(file)) continue;
    seen.add(file);

    const source = readFileSync(file, "utf8");
    const specifiers = /(?:from|import)\s*["'](\.[^"']+)["']/g;
    let match;
    while ((match = specifiers.exec(source))) {
      const spec = match[1];
      let target = resolve(dirname(file), spec);
      if (!existsSync(target) && existsSync(`${target}.js`)) target = `${target}.js`;
      if (existsSync(target) && statSync(target).isDirectory()) target = join(target, "index.js");

      if (!existsSync(target)) {
        // CSS and other non-JS assets are the bundler's business, not ours.
        if ([".js", ".mjs", ".cjs"].includes(extname(target))) {
          unresolved.push({ from: rel(file), spec });
        }
        continue;
      }
      if ([".js", ".mjs", ".cjs"].includes(extname(target))) stack.push(target);
    }
  }

  return { files: [...seen].map(rel).sort(), unresolved };
}

function rel(file) {
  return relative(SRC, file).split(sep).join("/");
}

function jsFilesUnder(dir) {
  const out = [];
  const walk = (d) => {
    for (const name of readdirSync(d)) {
      if (name === "node_modules" || name.startsWith(".")) continue;
      const full = join(d, name);
      if (statSync(full).isDirectory()) walk(full);
      else if ([".js", ".mjs", ".cjs"].includes(extname(name))) out.push(full);
    }
  };
  walk(dir);
  return out;
}

test.describe("V3 ↔ src/js boundary (cutover §1)", () => {
  test("every module V3 imports still resolves", () => {
    const { unresolved } = importClosure(ENTRY);
    expect(
      unresolved,
      `V3's import closure has broken specifiers. A module it depends on was ` +
        `deleted, moved or renamed:\n` +
        unresolved.map((u) => `  ${u.from} → ${u.spec}`).join("\n")
    ).toEqual([]);
  });

  test("the src/js modules in V3's closure match the recorded manifest", () => {
    const { files } = importClosure(ENTRY);
    const actual = files.filter((f) => f.startsWith("js/")).sort();

    const added = actual.filter((f) => !IMPORTED.includes(f));
    const removed = IMPORTED.filter((f) => !actual.includes(f));

    expect(
      { added, removed },
      `V3's dependency on the incumbent tree changed.\n` +
        (added.length
          ? `  NEW coupling (V3 now loads these from src/js/):\n${added.map((f) => `    + ${f}`).join("\n")}\n` +
            `  Give each one the ${MARKER} header, then add it to the manifest.\n`
          : "") +
        (removed.length
          ? `  GONE (V3 no longer loads these):\n${removed.map((f) => `    - ${f}`).join("\n")}\n` +
            `  Remove the ${MARKER} header too, or assertion 4 will fail.\n`
          : "") +
        `  Do not just refresh the manifest — this is the drift §1 exists to catch.`
    ).toEqual({ added: [], removed: [] });
  });

  test("every shared module carries the boundary header", () => {
    // A file that is gone entirely is assertion 1's failure, not this one —
    // each assertion should name one cause. (health.js's rule, applied here.)
    const missing = MANIFEST.filter(
      (f) =>
        existsSync(join(SRC, f)) &&
        !readFileSync(join(SRC, f), "utf8").includes(MARKER)
    );
    expect(
      missing,
      `These modules are load-bearing for V3 but no longer say so. The header is ` +
        `the only thing telling a future cleanup that src/js/ is not legacy:\n` +
        missing.map((f) => `  src/${f}`).join("\n")
    ).toEqual([]);
  });

  test("V3 still loads the feature flags it silently depends on", () => {
    const html = readFileSync(join(SRC, "v3", "index.html"), "utf8");
    expect(
      /<script\s+src="\/js\/config\.js"\s*>/.test(html),
      `src/v3/index.html no longer loads /js/config.js. V3 will not throw — ` +
        `every flag read is optional-chained, so the page boots with all ` +
        `features off and looks like it is working.`
    ).toBe(true);
  });

  test("no module claims to be shared when it is not", () => {
    const stale = jsFilesUnder(join(SRC, "js"))
      .filter((f) => readFileSync(f, "utf8").includes(MARKER))
      .map(rel)
      .filter((f) => !MANIFEST.includes(f))
      .sort();

    expect(
      stale,
      `These carry the ${MARKER} header but V3 does not import them. A stale ` +
        `marker is worse than none — it protects a file that no longer needs ` +
        `protecting, and teaches the next reader to distrust the rest:\n` +
        stale.map((f) => `  src/${f}`).join("\n")
    ).toEqual([]);
  });
});
