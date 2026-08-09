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
- The kiosk opens a **bare `http://localhost:3000`** (`dashboard-kiosk.service` on the G11,
  confirmed 2026-08-09). Nothing on the Pi names a surface, so `/` alone is the wall.

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

`src/v3/main.js` is the densest V3 node in the graph (79 edges); `boot()` at
`src/v3/main.js:184` carries 44. Every subsystem initialises through it.

Today a throw in `boot()` degrades a secondary surface. After the flip it is a **black wall
with nothing behind it**.

**Action:** isolate each `init*()` call so one subsystem's throw cannot abort the rest, and
make the failure visible — `src/v3/core/health.js` and the 9th subject already exist to say
so, and `health.js` is built to report **one cause, not three symptoms**.

### 5. Re-derive V3 test coverage properly — the graph's answer is WRONG

⚠ The graph reports 17 of 29 V3 files as having "no edge to any spec". **Do not act on
this.** Playwright specs drive a browser; they never `import` the modules, so **no static
edge can exist** and the metric is structurally incapable of being right. There are 12
V3-named specs:

```
v3-alerts  v3-attention  v3-composer  v3-display  v3-health  v3-presence-depth
v3-scrim   v3-sound-presence  v3-spread  v3-subjects  v3-voice
verify/v3-contrast
```

The coverage question is genuinely open — but answer it with a **runtime** coverage pass,
not this graph.

### 6. The three deferred sub-AA contrast findings change status on flip

`KNOWN_OPEN` carries: the wrapped dominant line, `.presence` z20 painting **over** `.stage`
z10, and `--ink-faint`. These were deferred while V3 was the *secondary* surface. Same
defects, different blast radius once it is the only one. **Re-decide rather than inherit the
deferral.**

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
2 → 1 → 3 → 4    then 5 and 6 before it sits overnight
✅   ✅   ✅   ↑ next
```

Items **2** and **4** are the ones that produce silent wrong behaviour or a dark wall.
Item **1** is the one that bites a future session.

§3 shipped the mechanism, not the cutover: the default is still `"incumbent"`. The live
run at `V3_DEFAULT=1` is owed, and §4 is next regardless — the flag makes a `boot()` throw
switchable, it does not make it survivable.

---

## Regenerating the graph this came from

```bash
graphify install --platform claude     # already done on this box
/graphify . --code-only                # 0 tokens, no API key, AST only
```

⚠ Windows: parallel AST extraction dies with `BrokenProcessPool` and falls back to
sequential unless the calling script has an `if __name__ == "__main__":` guard. Results are
complete either way. Outputs land in `graphify-out/` (gitignored).
