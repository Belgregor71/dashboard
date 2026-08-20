import { test, expect } from "@playwright/test";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, extname } from "node:path";
import {
  WEATHER_ANIMATIONS,
  getWeatherAnimationFilename,
  getWindBeaufortFilename,
  getBeaufortNumber
} from "../src/js/config/weather-animations.js";

/* ═══════════════════════════════════════════════════════════════════════════
   THE ICONS THE WALL ASKS FOR MUST BE ON THE DISK — audit M7.

   The full Meteocons pack was vendored wholesale: 236 files, 55 of them
   reachable. The other 181 are gone, and this file is the reason it was safe
   to remove them and the reason it stays safe.

   ⚠ WHAT MAKES THIS DANGEROUS IS THAT IT FAILS SILENTLY. `loadLottieAnimation`
   hands a path to lottie-web, which fetches it; a 404 produces no animation, no
   thrown error, and no empty space — the weather strip simply has nothing in it
   where the condition should be. The audit found SIX such names already
   shipping (`rain-day.json`, `snow-day.json`, `drizzle-day.json` and their
   nights) in a duplicate WEATHER_ANIMATIONS map in `src/js/config/config.js`
   that nothing imported. That map is deleted; this file is what would have
   caught it.

   ⚠ AND THE DANGEROUS DIRECTION IS COMPUTED NAMES. A literal-string sweep
   cannot see `` `wind-beaufort-${n}.json` ``, so a deletion pass guided by one
   would take the whole family and nothing would notice until it blew a gale.
   `getWindBeaufortFilename` is the only computed construction in the repo that
   names an icon — verified by grepping every template literal ending in
   `.json` across src/ and server/ — so it gets its own test, driven through the
   real function across its real input range rather than by pattern-matching
   filenames.
   ═══════════════════════════════════════════════════════════════════════════ */

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const LOTTIE_DIR = join(root, "static", "icons", "weather", "lottie");

const onDisk = (file) => existsSync(join(LOTTIE_DIR, file));

test("every weather code maps to an icon that exists", () => {
  const missing = [];
  for (const [code, pair] of Object.entries(WEATHER_ANIMATIONS)) {
    for (const when of ["day", "night"]) {
      if (!onDisk(pair[when])) missing.push(`code ${code} ${when} -> ${pair[when]}`);
    }
  }
  expect(missing, `WEATHER_ANIMATIONS names icons that are not on disk:\n${missing.join("\n")}`)
    .toEqual([]);
});

test("the fallback exists for a code the map has never heard of", () => {
  /* The path taken when Open-Meteo grows a code. If the fallback itself is
     missing, an unknown code is a blank strip rather than a wrong icon — and
     the unknown code is exactly when nobody is watching. */
  for (const code of [-1, 4, 999, NaN]) {
    expect(onDisk(getWeatherAnimationFilename(code, true)), `day fallback for ${code}`).toBe(true);
    expect(onDisk(getWeatherAnimationFilename(code, false)), `night fallback for ${code}`).toBe(true);
  }
});

test("the whole beaufort family survives, across the real wind range", () => {
  /* Driven through getBeaufortNumber from km/h rather than asserting 0..12 by
     hand: the clamp is inside the pair of functions, so a change to either the
     scale or the clamp has to keep landing on a file that exists. 0 to a
     cyclone, plus the nonsense a dead anemometer sends. */
  const speeds = [0, 1, 5, 11, 19, 28, 38, 49, 61, 74, 88, 102, 117, 200, 400, -5];
  const missing = [];
  for (const kmh of speeds) {
    const file = getWindBeaufortFilename(getBeaufortNumber(kmh));
    if (!onDisk(file)) missing.push(`${kmh} km/h -> ${file}`);
  }
  expect(missing, `the beaufort family is incomplete:\n${missing.join("\n")}`).toEqual([]);
});

test("no source file names a weather icon that is not on disk", () => {
  /* The literal half, and the general form of the defect the audit found. Any
     bare "<something>.json" in a lottie call site has to resolve.

     ⚠ COMMENTS ARE STRIPPED. This repo documents deletions by quoting the thing
     it deleted — the header above names three icons that are deliberately gone
     — and a guard that could not tell a warning from the thing it warns about
     would force that explanation to be removed. Same rule as
     commute-privacy.spec.js, for the same reason. */
  const stripComments = (src) =>
    src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[^\n]*?\/\/[^\n]*$/gm, "");

  const files = [];
  const walk = (d) => {
    for (const name of readdirSync(d)) {
      if (name === "node_modules" || name.startsWith(".")) continue;
      const full = join(d, name);
      if (statSync(full).isDirectory()) walk(full);
      else if ([".js", ".mjs", ".cjs"].includes(extname(name))) files.push(full);
    }
  };
  walk(join(root, "src"));

  /* Icon-shaped only. `aggregates.json`, `package.json` and the holiday caches
     are data files that have nothing to do with this directory, and a guard
     that demanded they live in static/icons would be wrong in a way that gets
     it disabled. The families here are the Meteocons naming scheme. */
  const ICONISH =
    /^(clear|partly-cloudy|overcast|extreme|thunderstorms|fog|rain|snow|sleet|drizzle|wind|hail|mist|haze|dust|smoke|hurricane|tornado|uv-index|moon|sunrise|sunset|thermometer|pollen|tide|barometer|compass|alert|code|celsius|fahrenheit|beanie|umbrella|cloud|starry|solar|lunar|horizon)[a-z0-9-]*\.json$/;

  const missing = [];
  for (const file of files) {
    const code = stripComments(readFileSync(file, "utf8"));
    for (const m of code.matchAll(/["'`]([a-z0-9-]+\.json)["'`]/g)) {
      if (ICONISH.test(m[1]) && !onDisk(m[1])) {
        missing.push(`${file.slice(root.length + 1)} names ${m[1]}`);
      }
    }
  }
  expect(missing, `these icons are named in source but not on disk:\n${missing.join("\n")}`)
    .toEqual([]);
});

test("the directory holds only what is reachable", () => {
  /* The other direction, and the cheap one: this is what keeps a re-vendored
     pack from quietly restoring 1.7 MB. Deliberately a COUNT and a spot check
     rather than an exact manifest — a manifest would have to be edited every
     time a weather code changes its icon, and a test that must be edited to
     stay green is a test that gets edited without being read. */
  const present = readdirSync(LOTTIE_DIR).filter((f) => f.endsWith(".json"));
  expect(present.length).toBeLessThanOrEqual(60);

  // Families the audit named as safe to drop, in a house in subtropical Brisbane.
  for (const gone of ["pollen.json", "hurricane.json", "tide-high.json", "uv-index-1.json"]) {
    expect(onDisk(gone), `${gone} is back — was the pack re-vendored?`).toBe(false);
  }

  // And the size the deletion bought, so a regression is visible as a number.
  const kb = present.reduce((s, f) => s + statSync(join(LOTTIE_DIR, f)).size, 0) / 1024;
  expect(kb).toBeLessThan(900);
});
