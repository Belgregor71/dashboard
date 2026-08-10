# V3 Runtime Coverage — the answer to V3-CUTOVER.md §5

**Taken 2026-08-10**, suite green (168 passed), against commit `881d7b4`.
**Re-taken 2026-08-10 against `9d17ef4`, after finding 1 was closed** — every
number in this document is the second reading. Reproduce with
`npm run verify:v3-coverage`, then **`npm run build`** to put `dist/` back.

> §5 said the graph's answer ("17 of 29 V3 files have no edge to any spec") is
> structurally wrong, and that the real question had to be answered at runtime.
> It now is. **318 of 399 functions execute (80%); 298 of 4,232 code lines never
> run (7% dead).** Nothing is uncovered wholesale — and of the three things that
> were, the GPU-failure path is now closed (**and it was broken**, see finding
> 1); the voice-summoned subjects and the photo ground remain.

> **First reading, for the diff:** 304/387 functions (79%), 415/4,177 lines dead
> (10%). The whole of the movement is the substrate — see finding 1. ⚠ Note the
> function DENOMINATOR grew (387 → 399) while coverage improved: V8 never
> reported the eight functions nested inside `createCanvasSubstrate` while it
> had never been entered, so running it for the first time both added seven hits
> and seven-plus to the total. **A rising denominator is the healthy direction
> here** — it is the tree-shaking trap (§ Method 1) in its other form.

---

## Headline

| | |
| --- | --- |
| Files in `src/v3/` | 31, **all 31 in the `/v3/` bundle** — no orphans |
| Functions executed | **318 / 399 (80%)** |
| Code lines never run | **298 / 4,232 (7%)** |
| Specs that reach V3 at runtime | **14** (13 browser + `v3-composer`, node-only) |
| Files at 100% | 11, `substrate/gl.js` newly among them |
| Files at 0% | **1** — `subjects/media.js` |

---

## Method, and the three ways it was nearly wrong

V3 runs in **two** places, and a pass that took either one alone would have been
badly misleading:

- **browser** — the specs' `page.goto("/v3/")` loads `dist/assets/v3-*.js`.
  `tests/fixtures/coverage.js` (an opt-in `page` fixture, `V3_COVERAGE=1`)
  records raw V8 coverage per test: 118 captures (109 in the first reading).
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
src/v3/core/spread.js                   9     9  100%        0/93
src/v3/core/vocabulary-card.js          4     4  100%        0/56
src/v3/core/voice.js                   24    20   83%      11/320
src/v3/main.js                         42    38   90%       4/335
src/v3/subjects/briefing.js             5     4   80%        1/70
src/v3/subjects/calendar.js             9     9  100%        0/67
src/v3/subjects/dom.js                  7     7  100%        0/83
src/v3/subjects/index.js               18    13   72%      38/178   ← 2
src/v3/subjects/lists.js                2     2  100%        0/34
src/v3/subjects/media.js                1     0    0%       27/45   ← 2
src/v3/subjects/memories.js             4     4  100%        0/92
src/v3/subjects/recipe.js               4     4  100%        0/71
src/v3/subjects/status.js               8     8  100%       0/158
src/v3/substrate/canvas2d.js            8     7   88%       4/110   ← 1
src/v3/substrate/gl.js                 10    10  100%       0/165   ← 1
src/v3/substrate/index.js              13    11   85%        5/94   ← 1
```

---

## Findings, ranked by what the cutover changes

### 1. ✅ CLOSED (`9d17ef4`) — the GPU-failure path was 100% unexercised, **and it was broken**

The original finding: `substrate/canvas2d.js` entirely dead —
`createCanvasSubstrate()` (100 code lines) never run, along with `onLost` (the
`webglcontextlost` handler), **both `destroy()`s**, and `gl.js`'s rAF `loop`.
Headless Chromium always has WebGL2, so no spec had ever taken the branch. It is
the finding that changed character at the cutover: after the flip, **the wall's
entire ground falls into code that has never executed once**, on a box that runs
for weeks.

⚠⚠ **RUNNING IT FOUND A REAL DEFECT ON THE FIRST TRY. A canvas keeps its context
type for life** — `getContext("2d")` on an element that has ever held a `webgl2`
context returns **null**, lost context or not. So the loss handler built
`impl = null`, and the next `.backend` read threw *"Cannot read properties of
null"*. On the wall: a frozen field, an uncaught TypeError on every 60 s causes
tick for as long as the page lives, and — because nothing above the substrate
knows or may ask which backend it got — **that night's panel darkening broken
too, from inside an unrelated subsystem.** Reading the handler cannot show this;
losing a real context does, immediately.

🔑 **Unexercised code is not code that probably works.** This was the only
finding in this report whose subject is a *recovery* path, and recovery paths
are exactly where "it looks right" is worth nothing.

Closed with `tests/v3-substrate.spec.js` (8 assertions, 7 mutations, each proven
red first) and two ways in that cover different code:

- **`?__backend=canvas2d`** — the cold fallback, a machine with no WebGL at all.
  `initSubstrate`'s `forceBackend` seam already existed and **nothing at runtime
  could set it**; `main.js` now reads it off the query string, which is also the
  only way to look at the 2D field on the glass.
- **`WEBGL_lose_context`** — the genuine handler path, which the forced backend
  cannot reach.

The fix swaps in a shallow-cloned canvas (id, class and the 480×270 backing store
come with it), falls back to an `INERT` backend rather than `null` if even 2D is
refused, and wraps the rebuild — it runs inside an event dispatch, where a throw
is an uncaught page error *and* leaves the dead GL backend in place.

**Result: canvas2d 0% → 88%, gl.js 80% → 100%, index.js 75% → 85%** (its
denominator grew from 8 functions to 13 with the new code). Three misses remain
and all three are the same one: **`destroy()` has no caller.** V3 never unmounts
the field, so the wrapper's `destroy()`, `canvas2d`'s and `INERT`'s are teardown
kept for the contract's sake. `gl.js`'s `destroy()` is no longer among them — the
loss path calls it.

⚠ **`playwright.coverage.config.js` lists the specs by name.** A V3 spec that is
not added to that list does not make its subject read as *uncovered* — it makes
it read as **dead**, which is the same lie pointing the other way. This spec
covered `canvas2d.js` fully and the report still called it 100% dead until the
filename was added.

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
- **The substrate's teardown** (added after finding 1 closed). `initSubstrate`'s
  `destroy()`, `canvas2d`'s and `INERT`'s have no caller: the field is mounted
  once at boot and V3 never unmounts it. They are the backend contract's
  symmetric half, not a gap — and `gl.js`'s `destroy()`, which the loss path
  really does call, is the reason the contract is worth keeping.

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
npm run verify:v3-coverage     # build + 14 specs + report  (~2 min)
npm run build                  # ⚠ REQUIRED — puts dist/ back to the real bundle
```

`node scripts/verify/v3-coverage.mjs` alone re-reports from raw data already
taken. `--probe=src/v3/core/attention.js:174` dumps every record landing
at a position — which is how the Playwright-transform trap above was found.

Raw V8 output lands in `coverage/` (gitignored, ~40 MB). With `V3_COVERAGE`
unset, `tests/fixtures/coverage.js` exports Playwright's `test` **itself**, not a
pass-through extension of it, so the everyday suite is unchanged.
