# V3 Duplicate Symbols — the authority record

**Cutover step 2** (`docs/design/V3-CUTOVER.md` §2). Written 2026-08-09, after reading
every pair. This settles the question the cutover plan asked: *for each symbol defined in
both trees, which copy is authoritative once V3 is the dashboard?*

---

## The method, and why it changes the answer

A duplicated name is only a hazard if **both copies can be loaded into the same page**.
Everything else is two modules that happen to have picked the same word.

So the first thing established was V3's actual import closure — every module reachable
from `src/v3/main.js`, transitively:

```
70 files, of which 40 live in src/js/
```

(The cutover plan's "~25" counted the named/direct ones; 40 is the transitive truth.
The list is reproducible — walk `from "…"` specifiers from `src/v3/main.js`.)

🔑 **`src/js/core/presence.js` is NOT in that closure.** Neither is `arrivalGreeting.js`,
`background.js`, `systemStatus.js`, `focusHero.js`, `doorbellAlert.js` or
`voiceSession.js`. Every one of those is an incumbent-only module, so most of the
"duplicates" cannot meet each other at runtime under any circumstances.

**In the closure and therefore capable of colliding:** `core/tts.js`,
`services/photoMemory.js`, `services/localIntents.js`, `services/voiceSnapshot.js`,
`services/houseSnapshot.js`, `modules/briefingData.js`, `services/alertRouter.js`.
Those are the only ones where a duplicate name needed real scrutiny — and each turned out
to be a module-scoped local, not an export, so none of them collide either.

---

## The verdict

**Of the 19, five are genuine same-concept pairs. Fourteen are name collisions between
unrelated code.** One pair carried a shippable defect. It is fixed (`2e59dd1`).

### Genuine pairs — a fix to one does NOT reach the other

| Symbol(s) | V3 | Incumbent | Authority | State |
| --- | --- | --- | --- | --- |
| `clearLinger` `initHalfDuplex` `postJson` `reportSpeaking` | `v3/core/voice.js` | `js/core/voiceSession.js` | **V3** | ⚠ **had diverged — fixed `2e59dd1`.** See below. |
| `firstName` | `v3/core/arrival.js` | `js/modules/arrivalGreeting.js` | **V3** | V3's is strictly hardened (optional chaining on `entity`, `"Someone"` fallback). The known min-away divergence lives here too — `arrivalGreeting.js:289` still has no guard. |
| `oneShot` | `v3/core/ground.js` | `js/modules/background.js` | **either — identical** | Byte-identical logic; only the stall constant is renamed (`STALL_MS` / `LOAD_STALL_MS`). Extraction candidate for the §1 `src/shared/` move, not a defect. |
| `initPresence` `onPresence` | `v3/core/presence.js` | `js/core/presence.js` | **V3** | A deliberate rewrite, documented in V3's own header: the incumbent's sets its mode off `screensaver:changed`, and V3 has no screensaver. **Not in V3's closure** — clean split. |
| `cooldowns` | `v3/core/alerts.js` | `doorbellAlert.js`, `arrivalGreeting.js` | **both — per-surface by design** | Each holds its own `Map` and passes it into the *shared* `routeAlert()`. Separate pages must not share a cooldown clock. Correct as-is. ⚠ V3 passes `{ now, cooldowns, minFreshMs }`, the incumbent passes `{ cooldowns }` — same function, two call contracts. |

### Name collisions — no action, and no shared fix to keep in step

| Symbol | The two things it names | Why it is inert |
| --- | --- | --- |
| `announce` | V3 presence's listener fan-out; V3 attention's **exported** `announce(candidate, now)`; `tts.js`'s speaking-transition reporter | Three unrelated concepts. Only one is exported and it is V3's own. `tts.js`'s is module-private. |
| `normalise` | `presence-light.js` normalises an **RMS level** 0-1; `localIntents.js` normalises **transcript text** | Nothing in common but the word. |
| `readState` | V3 `display.js` fetches `/api/display/state`; `focusHero.js` reads attention candidates | Different functions entirely. |
| `captionFor` | V3 `memories.js` → `"3 years ago · Brisbane"`; `photoMemory.js` → `"year · place · who"` | Different caption grammars for different surfaces. Both module-scoped to their caller. |
| `getJson` | V3 `subjects/dom.js`; `briefingData.js`, `houseSnapshot.js`, `voiceSnapshot.js` | Four module-local `fetch` wrappers. Trivial, private, uncoupled. |
| `formatUptime` | V3 `status.js` → `"up 3d 4h"` or **`null`**; `systemStatus.js` → `"3d 4h 12m"`, never null | ⚠ **Deliberately different output contracts.** Do not "unify" these — V3 returns null so the line can be omitted, which is the whole point of its status subject. |
| `record` `tick` `listeners` | `scrim.js` vs `routineRuntime.js`; `ground.js` vs `recipePanel.js`/`morningBriefing.js` | Generic verbs in unrelated modules. |

🔑 **The graph proposed 19 and 14 of them were noise.** Same lesson as `ALERT_TTS_RATE`
in the cutover plan: a static signal is a question, never a finding.

---

## The one that was real

`v3/core/voice.js` and `js/core/voiceSession.js` POST to the same two endpoints. The
incumbent sends both upstreams the context they take; **V3 sent neither.**

- **Converse lane.** The server accepts a bounded rolling transcript
  (`buildConverseMessages`, `MAX_TURNS` 6, bounded server-side). V3 posted `{ text }`
  alone, so *"and tomorrow?"* reached the model as the first thing anyone had ever said.
- **HA Assist.** The server threads the `conversation_id` HA minted
  (`server/routes/voice.js:40-41`). V3 sent none and kept none, so a clarification
  (*"turn on the lamp"* → *"which one?"*) could not resolve. ⚠ The id must be kept even
  when the lane reports **unhandled** — HA mints it on exactly that first exchange.
- **Opposite direction:** V3 gated the lane on `handled && speech`. HA answers a completed
  action with `response_type: "action_done"` and sometimes no speech — the lights are
  already on. That turn fell through to the house voice, which would then answer a
  question about something that had already happened.

⚠ **Why nothing caught it.** `tests/voice-session.spec.js` has asserted both invariants
since Phase 4 (`turns` bounded, *"assist id retained for follow-ups"*).
`tests/v3-voice.spec.js` had **no coverage of lanes 2 or 3 at all**. A tested invariant of
the shipped dashboard was going to vanish at the cutover with nothing going red, because
the test drives the other page. 🔑 **Duplicated code duplicates behaviour but not
coverage — and the surface with the weaker tests is the one about to win.**

Four V3 specs now cover it; three were confirmed red against the pre-fix file before being
kept. `__v3Voice()` reports `turns` and `conversationId`, matching `__voiceSession`.

---

## What step 2 leaves for step 1

The five genuine pairs are the shortlist for the `src/shared/` move (§1). `oneShot` is a
pure extraction. The rest should stay two copies **on purpose** — and this file is the
record of that being a decision rather than an oversight.

⚠ The incumbent's copies do not become dead code at the cutover. `/` changes what it
serves; the incumbent entry still builds and still runs. Anything fixed in a V3 copy that
also matters to the incumbent has to be applied twice, deliberately — starting with the
minimum-away guard still missing from `arrivalGreeting.js:289`.
