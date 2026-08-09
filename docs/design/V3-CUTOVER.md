# V3 Cutover Plan

**Written 2026-08-09.** Derived from a `graphify --code-only` knowledge graph of the repo
(2,649 nodes / 6,056 edges / 163 communities, 98% EXTRACTED). Every finding below was
**verified by reading the code**, not taken from the graph alone — the graph proposed the
questions, the files answered them.

Scope: **V3 only.** Findings that affect the incumbent surface alone are deliberately out.

---

## 0. What "becoming default" actually is

- `server.js:167` serves `dist/index.html` for `/` — that is the **incumbent**.
- V3 is served at `/v3/`. Both are real Vite entry points (`vite.config.js:18-21`:
  `index → src/index.html`, `v3 → src/v3/index.html`).
- So the flip is a **one-line serve change**. That is exactly why the coupling in §1 has to
  be settled first: the change is trivial, the consequences are not.

Note `server.js:165-166` already says a missing `dist/index.html` is "a build failure to
surface, not to paper over with the retired legacy app (Phase 5 removed
`static/index.html`)". There is no third fallback.

---

## P0 — Do before the flip

### 1. V3 is NOT standalone — it imports ~25 incumbent modules (118 edges)

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

**Action:** make the boundary visible in the filesystem. Either move the genuinely shared
modules to `src/shared/`, or add a load-bearing header comment to each of the ~25. The
comment is cheap; the move is durable. Do one, not neither.

### 2. Nineteen symbols exist in BOTH trees — and have already diverged

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

Project rule, and there is no fallback surface once `/` is V3. Put serve-path selection
behind a flag; the off state must serve the incumbent byte-identically. ⚠ Verify the suite
passes in **both** states — flag flips have broken tests here that assumed the old default.

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
```

Items **2** and **4** are the ones that produce silent wrong behaviour or a dark wall.
Item **1** is the one that bites a future session.

---

## Regenerating the graph this came from

```bash
graphify install --platform claude     # already done on this box
/graphify . --code-only                # 0 tokens, no API key, AST only
```

⚠ Windows: parallel AST extraction dies with `BrokenProcessPool` and falls back to
sequential unless the calling script has an `if __name__ == "__main__":` guard. Results are
complete either way. Outputs land in `graphify-out/` (gitignored).
