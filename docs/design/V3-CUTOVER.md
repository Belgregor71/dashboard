# V3 Cutover Plan

**Written 2026-08-09.** Derived from a `graphify --code-only` knowledge graph of the repo
(2,649 nodes / 6,056 edges / 163 communities, 98% EXTRACTED). Every finding below was
**verified by reading the code**, not taken from the graph alone — the graph proposed the
questions, the files answered them.

Scope: **V3 only.** Findings that affect the incumbent surface alone are deliberately out.

---

## 0. What "becoming default" actually is

> ⚠ **CORRECTED 2026-08-09 (§3, `9486a89`). `server.js:167` did not serve `/`. It was dead
> code, and had been since the Vite build landed.** `express.static(dist)` is mounted
> fourteen lines above it and serve-static answers `/` with `dist/index.html` **itself** —
> its `index` option defaults to `"index.html"`. The `app.get("/")` below it was never
> reached; a handler returning 418 there was measured unreachable. **The "one line" this
> whole plan was scoped around would have flipped nothing, and a deploy of it would have
> looked entirely successful.** 🔑 A route below a static mount is not a route.

- V3 is served at `/v3/`. Both are real Vite entry points (`vite.config.js:18-21`:
  `index → src/index.html`, `v3 → src/v3/index.html`).
- The flip is still small, but it is a **re-ordering** plus a flag, not an edit in place —
  see §3 for the shipped shape.
- `dashboard-kiosk.service` launches Chromium on a **bare `http://localhost:3000`** (G11,
  confirmed 2026-08-09) and nothing navigates it afterwards. So the flag decides the wall
  **from the next kiosk restart**, not immediately.
- ⚠ **The RUNNING page is not the launch URL.** Checked over CDP 2026-08-09 19:40: the live
  page was on `http://localhost:3000/v3/`, left there by a hand navigation during an earlier
  V3 verification. That navigation is **not persisted anywhere** — a Chromium restart takes
  the wall back to `/`, i.e. back to the incumbent while the flag is off. 🔑 **The wall's
  current surface and the wall's configured surface are two different facts; `ps` and the
  unit file only tell you the second.** Ask CDP (`curl 127.0.0.1:9222/json` on the host) for
  the first.

Note the old handler already said a missing `dist/index.html` is "a build failure to
surface, not to paper over with the retired legacy app (Phase 5 removed
`static/index.html`)". There is no third fallback, and the replacement keeps that.

---

## P0 — Do before the flip

### 1. V3 is NOT standalone — it imports ~25 incumbent modules (118 edges)

> ✅ **DONE 2026-08-09 (`6960e65` + `ce83e21`). The boundary is now enforced by
> `tests/v3-closure.spec.js`, and the count below is wrong — read this box, not the
> estimate.**
>
> The closure, **computed rather than estimated**: **71 files, 41 of them in `src/js/`.**
> "~25" counted only the direct named imports. **39 of the 41 are in the incumbent's
> closure too**; exactly two — `services/houseSnapshot.js` and `services/displayWindow.js` —
> live in `src/js/` but are loaded by **V3 alone**, so losing them breaks nothing on `/`
> to warn you.
>
> 🔑 **It is 42, and the 42nd is not an import.** `src/v3/index.html:110` loads
> `/js/config.js` as a plain `<script>` — invisible to any dependency graph, which is why
> this section missed it. V3 reads `window.CONFIG?.features?.…` in four places, **optional-
> chained**, so retiring `src/js/` does **not** throw: V3 boots with every feature flag
> silently `false`. A total flag rollback presenting as normal operation. An error would
> have been kinder. (Vite warns about the same tag on every build — the signal was always
> there.)
>
> **The choice, resolved with numbers:** the `src/shared/` move measured **234 import
> rewrites across 95 files, 155 of them in the incumbent tree** the cutover is not supposed
> to touch. So: the header comment on all 42, **plus a guard spec** — which is what makes
> the cheap option durable. A comment only warns whoever opens the file; the guard goes red.
> Marker token `V3-SHARED-RUNTIME`, one grep finds every member.
>
> Five assertions, each naming **one** cause, and **every one proven red by mutation before
> it was kept**: an unresolvable specifier · the `src/js/` closure drifting from the recorded
> manifest (both directions) · a header dropped in a rewrite · the `/js/config.js` script tag
> disappearing · a stale marker left on a module that genuinely left.
>
> ⚠ **The manifest in that spec is not a cache to refresh until green.** A diff against it
> means V3's coupling to the incumbent tree just changed — the exact event this section
> exists to notice. Read the change, then record it.

`src/v3/main.js` has these direct `../js/` imports (read from the file, lines 9-25):

```
../js/vendor/suncalc.js                 getPosition
../js/services/vocabulary.js            railPhrase
../js/services/voiceSnapshot.js         voiceSnapshot, refreshVoiceCache
../js/services/homeAssistant/client.js  connectHA, isHAConnected
../js/services/homeAssistant/entityFeed.js  registerEntityFeed
../js/services/homeAssistant/state.js   getAllEntities
../js/core/eventBus.js                  emit
../js/services/houseSnapshot.js         refreshHouseCache, houseCacheAge
```

Across the rest of `src/v3/`, add: `core/tts.js`, `config/alertLines.js`,
`services/alertRouter.js`, `modules/aiBriefing.js`, `services/attentionEngine.js`,
`services/attentionRank.js`, `services/briefingSchedule.js`,
`services/candidateSources.js`, `services/displayWindow.js`, `services/localAnswers.js`,
`services/localIntents.js`, `services/mealEvent.js`.

⚠ **The hazard:** once V3 is "the dashboard", `src/js/` reads as *the old one* — and it is
actually V3's runtime library. A future cleanup that retires the legacy tree takes
`eventBus` and the Home Assistant client with it.

**Action:** ~~make the boundary visible in the filesystem. Either move the genuinely shared
modules to `src/shared/`, or add a load-bearing header comment to each of the ~25. The
comment is cheap; the move is durable. Do one, not neither.~~
✅ **Done — header on all 42 plus `tests/v3-closure.spec.js`. See the box at the top of this
section.** The framing "cheap *or* durable" turned out to be a false pair: a comment and a
guard together cost less than the move and enforce more than either.

### 2. Nineteen symbols exist in BOTH trees — and have already diverged

> ✅ **DONE 2026-08-09 — the answers live in `docs/design/V3-DUPLICATES.md`. Read that,
> not this section, and do not re-derive the table below.** Headline: only **five** of the
> nineteen are genuine same-concept pairs; fourteen are name collisions between unrelated
> code (`normalise` is RMS vs text, `readState` is a fetch vs a candidate read, and so on).
> One pair carried a real defect — V3's voice lane sent **neither** upstream the context it
> takes, so follow-ups and HA clarifications were both broken. Fixed in `2e59dd1` with the
> lane-2/3 spec coverage V3 never had. 🔑 The load-bearing method: a duplicate can only
> collide if both copies load in the same page, and **`js/core/presence.js` is not in V3's
> import closure** (70 files, 40 of them in `src/js/`) — so most of this table cannot
> collide under any circumstances.

| Symbol | V3 | Incumbent |
| --- | --- | --- |
| `initPresence()` | `src/v3/core/presence.js` | `src/js/core/presence.js` |
| `firstName()` | `src/v3/core/arrival.js` | `src/js/modules/arrivalGreeting.js` |
| `cooldowns` | `src/v3/core/alerts.js` | `doorbellAlert.js`, `arrivalGreeting.js` |
| `clearLinger()` `initHalfDuplex()` `postJson()` `reportSpeaking()` | `src/v3/core/voice.js` | `src/js/core/voiceSession.js` |
| `localDayKey()` `oneShot()` | `src/v3/core/ground.js` | `src/js/modules/background.js` |
| `captionFor()` | `src/v3/subjects/memories.js` | `src/js/services/photoMemory.js` |
| `announce()` | `core/attention.js`, `core/presence.js` | `src/js/core/tts.js` |
| `formatUptime()` | `src/v3/subjects/status.js` | `src/js/modules/systemStatus.js` |
| `readState()` | `src/v3/core/display.js` | `src/js/modules/focusHero.js` |
| `getJson()` | `src/v3/subjects/dom.js` | `briefingData.js`, `houseSnapshot.js`, `voiceSnapshot.js` |
| `normalise()` | `src/v3/core/presence-light.js` | `src/js/services/localIntents.js` |
| `onPresence()` `record()` `tick()` `listeners` | various V3 | `routineRuntime.js`, `eventBus.js`, `background.js` |

🔑 **This is not a naming curiosity — one pair has already diverged in a way that mattered:**
V3's arrival has a minimum-away guard and `src/js/modules/arrivalGreeting.js:289` still does
not. That is the pattern, not the exception.

**Action:** for each pair, record which copy is authoritative after the cutover. Start with
the four **voice** duplicates — that is the half-duplex path, which is newly default-on.

### 3. The flip must be flag-gated and reversible

> ✅ **DONE 2026-08-09 (`9486a89`). The mechanism is shipped and default-off. What remains
> is the live verification and the default change itself — see "What is left" below.**

Project rule, and there is no fallback surface once `/` is V3. Put serve-path selection
behind a flag; the off state must serve the incumbent byte-identically. ⚠ Verify the suite
passes in **both** states — flag flips have broken tests here that assumed the old default.

**Shipped shape.** `resolveRootSurface(env)` in `server/config.js` names the surface;
`server.js` registers `app.get("/")` **above** `express.static(dist)` and sends
`SURFACE_ENTRY[surface]`.

- `DEFAULT_ROOT_SURFACE = "incumbent"` is the committed default. **Flipping that constant is
  the cutover**, and `tests/root-surface.spec.js` is written so the flip is a deliberate
  edit rather than a surprise.
- `V3_DEFAULT` overrides it in **both** directions (`1`/`true`, `0`/`false`). So the Pi can
  be pinned either way from `.env` with a restart and **no deploy** — that is the fast
  rollback, and it is also how the on-state was first exercised.
- The resolver takes `env` as an argument rather than reading `process.env` at module load:
  `server/config.js` is imported by `server.js`, so its top level runs **before**
  `dotenv.config()`. A value captured up there is frozen at whatever the shell had (audit
  2026-07-26, M2 — that exact bug has shipped here once already).

**Both surfaces keep fixed, flag-independent URLs**: `/index.html` is always the incumbent,
`/v3/` is always V3, `/` is whichever the flag names. The one that loses `/` is a URL away
rather than stranded — which is the fallback this section says V3 otherwise has none of.

⚠ **The flag changes what a NAVIGATION to `/` returns; it does not move a page that is
already loaded.** The kiosk holds one page for weeks. Flipping the flag therefore takes
effect on the next kiosk restart or CDP `Page.reload` — the same lag every deploy already
has (see [[project-kiosk-cdp-verification]]), but easy to misread here as "the flip didn't
work".

**The specs had to stop conflating "the incumbent" with "the default."** 26 specs navigated
to `/`; all now name `/index.html`. That coupling — not the serve change — is what would
have turned the flip into 26 red specs. One more would have gone red for an unrelated
reason: `api.spec.js`'s document-root test asserted `<!DOCTYPE html>` case-sensitively, and
Vite emits `<!doctype html>` lowercase for V3's entry. It is `/i` now, and stays on `/` on
purpose — *which* document `/` serves is this flag's business, not that test's.

**Two guards, deliberately overlapping** (`tests/root-surface.spec.js`), both proven red by
mutation (sink the root route back below the static mount):

1. a **runtime** contract — `/` is byte-for-byte the entry the flag names, and unmistakably
   not the other one;
2. a **source-order** assertion — the root route stays above the dist static mount.

🔑 **Only (2) can see the original defect from the off state.** Measured with the mutation
in place: flag-off, (1) **passes** — `/` still serves the incumbent, correctly, for the
wrong reason. A dead root route is invisible until the moment you need it to work.

**Suite green in both states, full runs:** 1061 passed flag-off, 1061 passed with
`V3_DEFAULT=1`.

**What is left before the default changes:**

- run V3 at `/` on the live kiosk (`V3_DEFAULT=1` in the Pi's `.env` + restart — no deploy),
  for long enough to include a sunset and a wake;
- §4 boot isolation, and §6 re-decided — both are about V3 being the *only* surface;
- then flip `DEFAULT_ROOT_SURFACE` to `"v3"` and update the expectation in
  `tests/root-surface.spec.js` in the same commit.

---

## P1 — Before it runs unattended

### 4. `boot()` is a 44-edge single point of failure

> ✅ **DONE 2026-08-09 (`856aad5` + this commit). `src/v3/core/boot.js`, and
> `tests/v3-boot.spec.js` — 14 assertions, five mutations.**
>
> `stage(name, fn)` wraps every `init*()`: a throw is caught, recorded, and the sequence
> continues. **`boot()` itself can no longer throw**, which also takes it out of the
> uncaught-page-error class the suite exists to catch.
>
> **The FIRST failure is the cause.** Boot is ordered, so a later stage failing is usually a
> consequence — the attention queue cannot be blamed for a feed that never registered. This
> is health.js's one-cause-not-three-symptoms rule applied to a sequence instead of to feeds,
> and it is why `bootFault()` takes the earliest failure rather than the loudest.
>
> 🔑 **The handles now register FIRST, before anything that can break.** At the bottom of
> `boot()` — where they lived — they were registered precisely when nothing had gone wrong.
> A wall that came up black was also a wall you could not ask why. Safe for the twelve specs
> that wait on `typeof window.__v3 === "function"`: `boot()` is synchronous, so no polled
> predicate can observe the page mid-sequence.
>
> **The timers got the same treatment.** `guard()` wraps each interval callback, because
> `setInterval` keeps firing after its callback throws — a broken `pushCauses` is not a
> stopped clock, it is an uncaught error every 60 s for as long as the page is up, which here
> is weeks. First is logged, the rest counted (40k identical lines a month would bury the one
> that mattered). ⚠ Three failures, not one, before it becomes a fault: **a wall that
> announces blips is ignored by the time something is actually broken.**
>
> **Visible in the room, not just the console.** `bootFault()` is read by `core/health.js`
> (the one-line notice into the attention queue, presence-gated at 72) and by
> `subjects/status.js` (the readout, which is the only place the stage NAMES appear —
> "substrate" is not a word anyone in a kitchen should need). Both already existed, so this
> adds **no new writer of any cell**. Two consequences worth recording:
> - **the surface's own boot outranks every feed** — `PRIORITY` reasons about which upstream
>   broke the others; this is a level above that argument, because the feeds describe what the
>   surface is *reporting on*. A half-booted wall telling you the calendar is late is
>   answering the wrong question with whichever subsystems are still alive;
> - **it survives an unreadable server.** `poll()` used to return early when the fetch failed
>   — correctly, since announcing from a snapshot it could not read would be inventing a
>   fault. But a boot failure is known LOCALLY, so reporting it is not inventing it, and
>   without that clause a half-booted wall is silent for exactly as long as the server is also
>   dark: the deploy that broke both.
>
> ⚠ **`?__boom=<stage>` injects a fault, and the seam THROWS FROM INSIDE THE TRY rather than
> short-circuiting around it.** This is not a detail — measured: with the early-return version,
> **three browser specs driving `?__boom=` passed against a `stage()` with no try/catch at
> all.** They recorded the identical report while never touching the catch, i.e. every spec
> for the one defect they existed to see was green. 🔑 A fixture that cannot produce the
> defect cannot catch it — the same lesson as Phase 6's one-word feed labels.
>
> 🔑 **Isolation cannot be verified by reading the code.** The property is "the wall works
> when a subsystem is dead", and the only way to check it is to kill one. That is what the
> seam is for, and it works over CDP on the kiosk exactly as it does in a spec.
>
> ⚠ **Isolation is also what would HIDE a stage that quietly started throwing in production**
> — the wall looks nearly right and nothing goes red. Hence the assertion that a healthy page
> fails **no** stage (`window.__v3Boot().failed` is `[]`), which is the guard that matters
> most once this is the only surface.
>
> Suite green in both root-surface states: **1075 / 1075**.

`src/v3/main.js` is the densest V3 node in the graph (79 edges); `boot()` at
`src/v3/main.js:184` carries 44. Every subsystem initialises through it.

Today a throw in `boot()` degrades a secondary surface. After the flip it is a **black wall
with nothing behind it**.

**Action:** ~~isolate each `init*()` call so one subsystem's throw cannot abort the rest, and
make the failure visible~~ ✅ done — `src/v3/core/health.js` and the 9th subject already
existed to say so, and `health.js` is built to report **one cause, not three symptoms**.
Both now do, for the surface as well as for the server's feeds.

### 5. Re-derive V3 test coverage properly — the graph's answer is WRONG

> ✅ **DONE 2026-08-10. The answer lives in `docs/design/V3-COVERAGE.md` — read that, and
> re-take it with `npm run verify:v3-coverage` rather than re-deriving the method.**
>
> **304 of 387 functions execute (79%); 415 of 4,177 code lines never run (10%).** All 31
> V3 files are in the `/v3/` bundle — there are no orphans, and the graph's 17 was, as
> predicted here, an artefact.
>
> The pass takes coverage from **both** runtimes, because V3 has two: 109 browser captures
> through an opt-in `page` fixture (`tests/fixtures/coverage.js`, `V3_COVERAGE=1`), and 11
> `NODE_V8_COVERAGE` dumps for the 8 modules specs import directly. Either alone lies —
> node-only sees almost nothing, browser-only reads `grammar.js` and `composer.js` as dead.
>
> ⚠⚠ **THE NODE SIDE'S OFFSETS ARE NOT OFFSETS INTO THE FILE ON DISK.** Playwright's loader
> transforms every module it imports; the script V8 measured is ~3× the file
> (`attention.js`: 51,095 bytes vs 18,146). Merging the two runtimes on `file:line:col`
> therefore merged **nothing**, and the first report claimed `initAttention`, `setDepth` and
> `poll` had never run — of a surface that boots. It read as a finding: `attention.js` came
> out at 61% when it is 94%. 🔑 **A coverage report's failure mode is a plausible answer,
> not an error** — which is why the decoder now self-checks (V8's own function name against
> the source line the map points at: 28,078/28,187, 99.6%).
>
> ⚠ **Tree-shaking must be OFF for the measurement.** Rollup deletes unexercised exports, and
> deleted code is not uncovered — it is absent. **The percentage rises as coverage falls.**
> Same class of problem as V8's lazy compilation, which never compiles a function nested
> inside one that was never entered; hence the dead-LINE column beside the function one.
>
> **The three findings that matter for this cutover**, in order:
> 1. **`substrate/canvas2d.js` is 100% dead (100 lines)** — the silent WebGL fallback, plus
>    `index.js`'s `webglcontextlost` handler and **both** `destroy()` methods. Headless
>    Chromium always has WebGL2, so no spec has ever taken that branch. After the flip, a
>    lost GL context drops the whole wall into code that has never executed once.
> 2. **Three voice dispatch entries never fire** — `show.sky` (+ `showSky`, 38 lines),
>    `show.tonight`, `show.media` (+ all of `media.js`). This is the same table whose
>    `show.status` was shadowed by `NAV_KEYWORD_MAP` in Phase 6.
> 3. **`ground.js` at 22%** — `dissolve()`, `tick()`, `oneShot()` all dark, while
>    `window.__groundDissolve`/`__groundRetry` sit there to drive exactly that and are
>    called by nothing.
>
> Also: **11 seams have no caller anywhere in the repo** (7 `__reset*`, `isPanelDark`,
> `reportUnheard`, and the two ground handles) — dead, not merely untested. And
> `presence-light.js`'s sound-presence lane is uncovered, which is the *next* flag due to be
> flipped.
>
> Structural and deliberately not chased: speech-completion callbacks (TTS is stubbed to a
> dead port) and 90-300 s interval bodies (a spec's budget is 30 s).

⚠ The graph reports 17 of 29 V3 files as having "no edge to any spec". **Do not act on
this.** Playwright specs drive a browser; they never `import` the modules, so **no static
edge can exist** and the metric is structurally incapable of being right. There are 12
V3-named specs:

```
v3-alerts  v3-attention  v3-composer  v3-display  v3-health  v3-presence-depth
v3-scrim   v3-sound-presence  v3-spread  v3-subjects  v3-voice
verify/v3-contrast
```

~~The coverage question is genuinely open — but answer it with a **runtime** coverage pass,
not this graph.~~ ✅ Answered that way — see the box above and `docs/design/V3-COVERAGE.md`.
The count of V3-named specs is now 14 (`v3-now-playing` and `v3-closure` joined since);
**13 of them reach V3 at runtime**, which is the number the pass measures.

### 6. The three deferred sub-AA contrast findings change status on flip

> ✅ **DONE 2026-08-10 (`6ac7162` + this commit). All three re-decided, and one of them
> turned out to be this gate's own defect rather than the surface's.**
>
> Worst text in V3, across all four ground × phase runs: **1.59:1 → 2.83:1**. Nodes below
> WCAG AA: **5 / 13 / 1 / 11 → 0 / 1 / 1 / 1**, each matching a registered debt whose floor
> was **raised** to the new number so the fix cannot silently stop working.
>
> **① `.presence` (z20) over `.stage` (z10) — WITHDRAWN. The defect was in the sweep.**
> `MEASURE` took one screenshot with the glyphs stripped and composited the ink token over
> each backdrop pixel, which silently assumes the ink is the LAST thing painted. The rim
> paints over the text as well as the ground, and the model credited it to the ground alone:
>
> | | day | night |
> | --- | --- | --- |
> | reported | 1.51:1 | 1.22:1 |
> | **actual** | **8.07:1** | **6.13:1** |
> | rim hidden | 12.38:1 | 9.95:1 |
>
> The rim is real and costs a third of the contrast; it was never near AA. ⚠ **The cost was
> not the wrong number, it was the floor.** Registered at 1.15:1, the entry told the gate
> that anything above 1.15 was expected — the most-looked-at prose on the wall could have
> decayed to 1.16 and four green runs would have called the debt held. 🔑 **A debt recorded
> at a number the surface never occupied is a hole shaped like one.**
>
> Contrast is now measured from **three frames of one screen** — glyphs white, black, gone.
> For any stack of translucent overlays `T(v) = A·C + (1-A)·v`, so `lit = T(255)` and
> `dark = T(0)` give `glyph = dark + (lit-dark)·ink/255` exactly, assuming nothing about what
> is above the text. ⚠⚠ **`lit - dark` is also a coverage mask that is INDEPENDENT OF THE
> BACKGROUND, and that is the load-bearing part** — locating glyphs by "where the painted
> frame differs from the stripped one" (the obvious method, tried first) loses its signal
> exactly where contrast is worst, and mistook the top scanline of a letter for the letter:
> 18 invented failures. Any text with something painted over it is now reported on every run.
>
> **② The wrapped dominant line — PAID with a veil, and it exposed a second writer.**
> A wrapped 132px line is ~280px tall, so its top reaches y=0.59 while the scrim solves for
> y ≤ 0.46 and is transparent by 0.88 **by design** — no opacity reaches it. It now takes the
> vocabulary card's flat veil at the solved opacity, full bleed, gated on
> `:has(.said[data-wrapped])`. ⚠ **The flag is a Range's line-box count, not a character
> count: 132px holds 20 characters and `SAID_LONG_MAX` is 40**, so counting cannot tell a
> one-line glance from a two-line one, and either every glance pays or the ones that need it
> do not. Glance: **2.59:1 → 13.59:1**.
>
> ⚠⚠ **And the veil did not come up on the very next surface, because `voice.js:say()` wrote
> `textContent` directly** — so the one line that matters most, what the house just SAID to
> someone standing in front of it, was the only said line in V3 exempt from the said rules:
> no `data-len` (a 60-character answer trying to hold 132px) and no veil. 🔑 **A rule
> enforced by a helper is only enforced on the callers that use it.**
>
> **③ `--ink-faint` — PAID by lifting the token, which is what the entry always said.**
> Its *ceiling* (against a fully opaque scrim — the best it could reach over any photograph
> at any opacity) was 4.29 day / 3.16 night, so no scrim was ever the answer. Both users
> (`.rail` 32px, `.heard` 48px) are large text, so the bar is **AA-large 3.0**, and both sat
> under it. Lifted **0.55 → 0.62** day and **0.48 → 0.62** night: 2.33 / 1.72 → **3.12:1**,
> ceiling 5.74. ⚠ It is now 0.04 from `--ink-dim` at night — the ramp is three steps in name
> and two on the wall, taken deliberately, because a peripheral rail that cannot be read is
> not peripheral, it is absent.
>
> **What is left, recorded rather than spent:** an unwrapped 132px line at 2.83:1 and
> `--ink-faint` under the rim at 2.93:1, both over the *synthetic white* ground, which is
> brighter than any photograph by construction. The next 0.02 of token would close the second
> and put faint 0.02 from dim.
>
> ⚠ **Found while measuring, unrelated to contrast, now fixed:** the briefing was **clipping
> a third of itself off the wall**. `.subject__prose-stack` carried `max-width: 26ch` and
> `ch` resolves against the element's OWN font-size — the 32px body floor, not the 96px
> Fraunces inside it. The "measured column" computed to **416px** with 96px text poured into
> it: eleven ragged ~5-character lines needing **1663px of an 800px stack**, `overflow:
> hidden` eating the rest. 🔑 **`ch` on a parent is not the child's measure.** Every existing
> briefing spec passed throughout because they all read `textContent`, which returns the
> whole string whether or not the screen showed it.

---

## P2 — Cleanup, no urgency

### 7. The dependency is one-directional — nothing real in the incumbent needs V3

Only 4 reverse edges exist, and they look false:

```
healthIndicator.js  initHealthIndicator() --indirect_call--> v3/core/health.js  poll()
atmoFx/runtime.js   runRain()/runTwinkle()/runFog() --indirect_call--> v3/subjects/dom.js  frame()
```

All INFERRED, all on generic names (`poll()`, `frame()`) — name collisions, not calls. Good
news: the cutover needs no untangling in that direction.

### 8. One known-false edge in the report

`src/js/modules/screensaver.js :: updateInfo()` → `tests/verify/v3-contrast.spec.js ::
line()`. A production module does not call a verify spec. It is in the 2% INFERRED tier.
Ignore it.

---

## CHECKED AND CLEAR — do not re-investigate

- **`ALERT_TTS_RATE` is not a defect.** The graph flagged it as the second-highest
  betweenness bridge (0.038), spanning *TTS Cache & Alert Routing* → *Screensaver & Wake
  Triggers* → *V3 Display & Alerts*. Reading the code clears it: it is a single exported
  constant `0.92` in `src/js/config/alertLines.js:10`, imported by `src/v3/core/alerts.js:38`
  (used at :110), `src/js/modules/doorbellAlert.js:3` (used at :38), and
  `server/services/ttsWarmer.js:1` (used at :25). One source of truth, correctly shared.
  The server cache key is `sha256(text::rate)`, so the shared constant is exactly what keeps
  the pre-warm from being wasted. **High betweenness is not evidence of a defect.**

---

## Suggested order

```
2 → 1 → 3 → 4 → 5    then 6 before it sits overnight
✅   ✅   ✅   ✅   ✅        ↑ next
```

Items **2** and **4** are the ones that produce silent wrong behaviour or a dark wall.
Item **1** is the one that bites a future session.

§3 shipped the mechanism, not the cutover: the default is still `"incumbent"`. §4 has
shipped the isolation — the flag only made a `boot()` throw switchable, it never made one
survivable; now it is.

**Still owed before `DEFAULT_ROOT_SURFACE` changes:**

- the live run at `V3_DEFAULT=1` on the kiosk, across a sunset and a wake;
- §4's live proof: `/v3/?__boom=ground` over CDP on the wall, seen still painting, and
  `__v3Boot().failed` read back from the real page. Isolation cannot be verified by reading
  the code, and this project does not call a fix done until it has been seen on the glass;
- ~~§5 (runtime coverage)~~ ✅ done — `docs/design/V3-COVERAGE.md`. It leaves three gaps
  worth closing before the wall is unattended: the WebGL fallback (100 dead lines on the
  path a lost GL context takes), the three never-fired voice dispatch entries, and
  `ground.js`'s dissolve;
- §6 (the three deferred sub-AA contrast findings, re-decided rather than inherited).

---

## Regenerating the graph this came from

```bash
graphify install --platform claude     # already done on this box
/graphify . --code-only                # 0 tokens, no API key, AST only
```

⚠ Windows: parallel AST extraction dies with `BrokenProcessPool` and falls back to
sequential unless the calling script has an `if __name__ == "__main__":` guard. Results are
complete either way. Outputs land in `graphify-out/` (gitignored).
