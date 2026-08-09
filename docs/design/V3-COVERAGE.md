# V3 Runtime Coverage — the answer to V3-CUTOVER.md §5

**Taken 2026-08-10**, suite green (168 passed), against commit `881d7b4`.
Reproduce with `npm run verify:v3-coverage`, then **`npm run build`** to put
`dist/` back.

> §5 said the graph's answer ("17 of 29 V3 files have no edge to any spec") is
> structurally wrong, and that the real question had to be answered at runtime.
> It now is. **304 of 387 functions execute (79%); 415 of 4,177 code lines never
> run (10% dead).** Nothing is uncovered wholesale — but the three things that
> are uncovered are, between them, the GPU-failure path, the voice-summoned
> subjects, and the photo ground.

---

## Headline

| | |
| --- | --- |
| Files in `src/v3/` | 31, **all 31 in the `/v3/` bundle** — no orphans |
| Functions executed | **304 / 387 (79%)** |
| Code lines never run | **415 / 4,177 (10%)** |
| Specs that reach V3 at runtime | **13** (12 browser + `v3-composer`, node-only) |
| Files at 100% | 12 |
| Files at 0% | **2** — `subjects/media.js`, `substrate/canvas2d.js` |

---

## Method, and the three ways it was nearly wrong

V3 runs in **two** places, and a pass that took either one alone would have been
badly misleading:

- **browser** — the specs' `page.goto("/v3/")` loads `dist/assets/v3-*.js`.
  `tests/fixtures/coverage.js` (an opt-in `page` fixture, `V3_COVERAGE=1`)
  records raw V8 coverage per test: 109 captures.
- **node** — 8 V3 modules are *also* imported directly by specs and called as
  plain functions in the worker. `NODE_V8_COVERAGE` writes that for free: 11
  dumps. Without it, `grammar.js` and `composer.js` read as dead.

Three things had to be got right, and each was wrong first:

**1. The build.** Against the production bundle every range attributes to one
file (no map), minification moves statements, and — the one that changes the
answer — **tree-shaking deletes unexercised exports, so they are not "uncovered",
they are absent, and the percentage goes UP as coverage gets worse.**
`vite.coverage.config.js` turns on sourcemaps and turns off both minify and
treeshake.

**2. The sourcemap.** No `c8`/`istanbul` in this repo, so the decoder is
hand-rolled (base64-VLQ → per-line mappings → nearest preceding mapping). A
sourcemap that is off by two lines produces a report that looks entirely
reasonable and names the wrong functions. So the script **self-checks**: V8's
`functionName` comes from the *bundle*, the line text from the *original file* at
the position the map claims. They agree for **28,078 of 28,187** named functions
(99.6%). The only disagreement is one arrow inside a multi-line ternary.

**3. ⚠⚠ The node side's offsets are not offsets into the file on disk.**
Playwright's loader transforms every module it imports, so the script V8 measured
is ~3× the size of the file (`attention.js`: V8 span 51,095 bytes vs 18,146 on
disk) and every line derived from it is shifted. The first version merged the two
runtimes on `file:line:col`; the shift meant they **never merged**. `health.js`
pulls in `attention.js` transitively, node reported its whole API as unexecuted
at shifted positions, and the report claimed **`initAttention`, `setDepth` and
`poll` never ran** — which cannot be true of a surface that boots. It was
believable enough to nearly ship: `attention.js` read 61%, and it is really 94%.

🔑 **A coverage report's failure mode is a plausible answer, not an error.**
Positions now come from the browser only; node contributes "a function of this
name, in this file, ran".

### The one blind spot that remains, and the column that covers it

V8 reports functions it has compiled. Module-level functions nobody called *are*
reported (count 0) — but **a function nested inside a function that was never
entered is never compiled and appears nowhere at all.** `media.js` reports one
function, not two, because the inner arrow at `:52` is inside `showMedia`, which
never runs.

So the table carries a **dead/code** column beside the function one: every line
inside a never-entered function, its invisible children included. That is why
`media.js` reads `1 fn, 0%` *and* `27/45 lines dead` — the second number is the
honest one.

(Recorded so nobody repeats it: `--js-flags=--no-lazy` was tried to force eager
compilation. It changed **nothing** — identical per-capture function counts. See
`playwright.coverage.config.js`.)

---

## Per-file

```
file                                  fns  exec    %   dead/code
src/v3/core/alerts.js                  11     5   45%       9/111
src/v3/core/arrival.js                 12     7   58%       9/119
src/v3/core/attention.js               18    17   94%       1/230
src/v3/core/boot.js                    19    15   79%       3/140
src/v3/core/briefing-window.js         13     6   46%      11/107
src/v3/core/composer.js                 6     6  100%        0/61
src/v3/core/depth.js                   15    12   80%        3/96
src/v3/core/display.js                 18    12   67%      17/166
src/v3/core/grammar.js                  3     3  100%       0/105
src/v3/core/ground.js                  18     4   22%      72/143   ← 3
src/v3/core/health.js                   7     5   71%       5/160
src/v3/core/now-playing.js             19    16   84%      12/215
src/v3/core/presence-light.js          16    10   63%      39/144   ← 4
src/v3/core/presence.js                18    13   72%      23/161
src/v3/core/scrim.js                   38    37   97%       4/303
src/v3/core/spread.js                   9     9  100%        0/88
src/v3/core/vocabulary-card.js          4     4  100%        0/56
src/v3/core/voice.js                   24    20   83%      11/309
src/v3/main.js                         42    38   90%       4/328
src/v3/subjects/briefing.js             5     4   80%        1/70
src/v3/subjects/calendar.js             9     9  100%        0/67
src/v3/subjects/dom.js                  7     7  100%        0/83
src/v3/subjects/index.js               18    13   72%      38/178   ← 2
src/v3/subjects/lists.js                2     2  100%        0/34
src/v3/subjects/media.js                1     0    0%       27/45   ← 2
src/v3/subjects/memories.js             4     4  100%        0/92
src/v3/subjects/recipe.js               4     4  100%        0/71
src/v3/subjects/status.js               8     8  100%       0/158
src/v3/substrate/canvas2d.js            1     0    0%     100/110   ← 1
src/v3/substrate/gl.js                 10     8   80%      14/165   ← 1
src/v3/substrate/index.js               8     6   75%      12/62    ← 1
```

---

## Findings, ranked by what the cutover changes

### 1. ⚠ The GPU-failure path is 100% unexercised — and it is the kiosk's

`substrate/canvas2d.js` is **entirely dead**: `createCanvasSubstrate()` (lines
16-138, 100 code lines) has never run. It is the silent fallback
`substrate/index.js:86` selects when WebGL is unavailable — and headless Chromium
always has WebGL2, so no spec has ever taken that branch. With it:

- `substrate/index.js:94` `onLost` — the `webglcontextlost` handler, never run;
- `substrate/index.js:115` and `gl.js:192` — **both `destroy()` methods**, never run;
- `gl.js:158` `loop` — the rAF frame loop, never run in a spec.

This is the finding that changes character at the cutover. Today a lost GL context
degrades a secondary surface. After it, **the wall's entire ground falls into 110
lines of code that have never executed once**, on a box that runs for weeks — and
[[project-g11-vaapi-unused]] already established the G11 does all its video in
software. `index.js:86` takes `forceBackend`, so the seam to test it already
exists and nothing uses it.

### 2. Three entries in the voice dispatch table never fire

`subjects/index.js` maps intents to subjects. Never executed:

```
181  "show.sky":     () => showSky(),          + showSky() itself, :117-154 (38 lines)
183  "show.tonight": (_i, snap) => showDay(snap),
187  "show.media":   () => showMedia(),        + showMedia(),      :26-63  (27 lines)
```

That is most of `subjects/index.js`'s 38 dead lines plus all of `media.js`. **This
is the same table that already shipped a real defect** — Phase 6's `show.status`
was shadowed by `NAV_KEYWORD_MAP` and nobody noticed
([[project-v3-phase6-invisible]]). An unexercised entry in that table is not a
theoretical gap; it is the exact shape of the bug this project has already had.

### 3. `ground.js` at 22% — the photo ground's whole dissolve path

`dissolve()` (:135-188, 53 lines), `tick()`, `oneShot()`, `localDayKey()`,
`thumbUrl()` — none have run. Ground is the awake photograph behind everything
([[project-awake-photo-ground]], [[project-ambient-archive-crop]]), and the
dissolve is the only moving part of it. Note `window.__groundDissolve` and
`window.__groundRetry` exist at :222-223 **specifically to drive this from a
probe, and nothing calls them** (see 5).

### 4. `presence-light.js` — the lane that is about to be flag-flipped

`normalise()`, `startDecay()`, and **both** SSE listeners (`voice_level`,
`voice_sound_presence`) never run. That is the sound-presence lane, which is
default-OFF pending the `/flag-flip` loop ([[project-sound-presence]]) — so the
runtime path of the next flag to be flipped is the one with no runtime coverage.
Worth closing **before** the flip rather than after.

### 5. Eleven seams with no caller anywhere in the repo

Not "untested" — **dead**. Each appears exactly once repo-wide, at its own
definition (`graphify-out/` excluded):

```
__resetAlerts  __resetArrival  __resetBriefingWindow  __resetDisplay
__resetHealth  __resetNowPlaying  __resetPresence
__groundDissolve  __groundRetry  isPanelDark  reportUnheard
```

Seven of those are `__reset*` test seams that no test uses; `__resetBoot` is the
only one with callers. They are maintained code paying no rent. Either wire them
into the specs that would benefit (3 and 4 above want exactly these) or delete
them — but they should not survive the cutover unexamined.

### 6. Structural, not gaps — do not "fix" these

- **Speech completion.** `onAudio` and `.then(idle, idle)` in `alerts.js`,
  `arrival.js`, `briefing-window.js`, `voice.js` never run because `KOKORO_URL`
  points at a dead port by design. This is most of why those files sit at 45-58%.
  Closing it means faking audio, which buys little.
- **Long intervals.** `main.js`'s 300 s cache ticks and 90 s rail tick, plus
  `health.js`'s poll interval and `now-playing.js`'s recheck, never fire inside a
  30 s spec. Their bodies are covered by direct calls; only the timer arms are dark.

---

## Scope — what this pass does NOT answer

- **`tests/verify/**` is excluded** (it is the pre-push gate, not `npm test`), so
  `verify/v3-contrast.spec.js` contributes nothing here. Including it would lift
  `scrim.js` and nothing else materially.
- **The shared `src/js/` runtime is not measured.** V3's closure is 42 files, 41
  in `src/js/` ([[project-v3-cutover]] §1). This pass measures `src/v3/` only.
- **`/js/config.js` is invisible to it too** — it is a `<script>` tag, and V3
  reads `window.CONFIG?.features` optional-chained, so a coverage pass cannot see
  the flag rollback that losing it would cause.
- A function that ran **once, in one spec, on one branch** counts as covered.
  This is coverage, not assurance.

---

## Re-running

```bash
npm run verify:v3-coverage     # build + 13 specs + report  (~2 min)
npm run build                  # ⚠ REQUIRED — puts dist/ back to the real bundle
```

`node scripts/verify/v3-coverage.mjs` alone re-reports from raw data already
taken. `--probe=src/v3/core/attention.js:174` dumps every record landing
at a position — which is how the Playwright-transform trap above was found.

Raw V8 output lands in `coverage/` (gitignored, ~40 MB). With `V3_COVERAGE`
unset, `tests/fixtures/coverage.js` exports Playwright's `test` **itself**, not a
pass-through extension of it, so the everyday suite is unchanged.
