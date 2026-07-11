# Phase 9 — "Remember on Purpose": Memory Engine & the Emotional Timeline

_Plan drafted 2026-07-11. Part of the [Home OS vision](./home-os-vision.md) roadmap. Builds on [Phase 7](./phase-7-dissolve.md) (a room quiet enough to hold a memory), [Phase 8](./phase-8-learn.md) (context confidence), [Phase 6](./phase-6-intent.md) (intent), and [Phase 3](./phase-3-anticipate.md) (the `on-this-day` candidate). Fourth phase of "the Dissolve"._

**📝 Proposed — not yet built. Handle with care — this is the phase that touches grief and nostalgia.**

## Key insight that de-risks this phase

**The plumbing is half-built; what's missing is intent and restraint.** Phase 3 already ships an `on-this-day` candidate (Low-band, ambient/dwell only). `momentsEngine.js` already computes **travel countdowns** at 30/14/7/3/1-day milestones — that _is_ anticipation, un-generalised. `occasionPopup.js` already knows birthdays/anniversaries. What the review indicted was the **selection**: matching the word `birthday` in calendar text is a string match, not a memory, and surfacing it in a footer every day is a feature, not remembering. Phase 9 replaces the regex with **structured memory the house holds** and a **rarity-budgeted, context-matched selector** — and generalises `momentsEngine`'s countdown into a full anticipation → afterglow arc.

The memory surfaces through the engine Phase 2 already built: a **Low-band candidate** (never interrupt), gated to AMBIENT/DWELL. No new render path — the discipline of the whole project.

The through-line: _a slideshow shuffles files; remembering **chooses**. Phase 9 is the difference between matching "birthday" and a house brave enough to bring a dog back on the right kind of afternoon._

## Why this phase (the reward)

The review's line was *"random is a feature; intentional is a memory."* After Phase 9, once in a long while and on the right kind of afternoon, the house thinks of something — five years ago today, the first cold morning of the year, last winter's trip on a grey day that feels like it — holds it a beat longer than an ordinary photo, and lets it go. Not a queue to clear, never a repeat until acknowledged. And it's brave enough for the ones that matter: **Brodie** loved that backyard, and a house that can only match a keyword will never know to bring him back. That gap — between a slideshow and a house that remembers a dog — is the entire reason to build this phase.

## Goal & success criteria

Replace keyword-matched memory with **structured memory objects** surfaced rarely, intentionally, and context-appropriately; and add the **emotional timeline** — day-character, seasons, anticipation that builds, afterglow that lingers. All behind `features.memoryEngine` (default off → reversible).

Done when:
1. Flag **on**: memories are drawn from structured entries (people, pets, places, first-times) with dates + emotional tags + photo refs, selected by a **rarity budget** and **context match** (a grey afternoon draws a wistful memory, not a random one), and surface as a **Low-band, non-interrupt** candidate in AMBIENT/DWELL only. Flag **off**: the Phase 3 `on-this-day` regex path is unchanged.
2. **Frequency is capped hard** — at most one memory surface per day, with a per-memory cooldown measured in **months**; no memory repeats within its window.
3. The **timeline** works: the House Model carries day-character (Sunday ≠ Monday) and season; a tagged upcoming event produces a slow **anticipation** warming (generalising `momentsEngine`); after it passes, an **afterglow** drifts its photos back for N days then decays (the `expiresAt` pattern from Phase 3).
4. Selection logic is **pure and node-unit-tested**; sensitive memories (grief-tagged, e.g. a lost pet) get the **gentlest** surface — ambient only, longer hold, no caption — enforced in code, not convention.

## The memory model (structured, not scraped)

```
{ id, kind: "person"|"pet"|"place"|"trip"|"first",
  date | recurring,          // anchor(s) in the year
  tags: ["wistful","joyful","grief","winter",…],   // drives context-match + tone
  photos: [ref,…],           // reuse the Phase 7 downscaled-photo pipeline
  sensitivity: "normal"|"tender",  // "tender" → gentlest surface, hard-gated
  cooldownMonths }           // how long before it may return
```

Entries live in `data/memories/*.json` — authored, not inferred (the house holds what the household tells it, plus dated calendar/occasion anchors). Selection is `pickMemory(entries, ctx, history) → entry | null`: it scores **context fit** (season/weather/day-character/anniversary) × **eligibility** (past cooldown, within daily budget), and returns `null` far more often than not — silence is the default.

## The emotional timeline (generalising what exists)

| Element | Today | Phase 9 |
|---|---|---|
| **Anticipation** | `momentsEngine` travel countdowns (30/14/7/3/1d) | Generalise to any tagged event: a slow warming of tone/atmosphere as the day nears, not a countdown number | Ship |
| **Afterglow** | — | After a trip/occasion, its photos drift back for N days, then `expiresAt` decay | Ship |
| **Day-character** | date only | House Model gains Sunday≠Monday + season, feeding intent tone + atmosphere | Ship |
| **Anniversary/occasion** | `occasionPopup` + regex footer | Structured entries with tags + tender-gating | Replace |

## File-by-file changes

**New — `data/memories/` (authored JSON) + a small loader**
- Structured entries per the model above; a loader that merges them with dated calendar/occasion anchors into the candidate context.

**New — `src/js/services/memoryEngine.js`**
- Pure `pickMemory(entries, ctx, history)` (rarity budget + context-match + tender-gating) and the runtime that reads history/writes cooldowns. Emits a **Low-band, non-interrupt** candidate for the Phase 2 queue — no new render path. Tender entries are hard-restricted to AMBIENT + longer hold + no caption in the selector, not left to the renderer.

**Edit — `src/js/services/momentsEngine.js`**
- Generalise `computeTravelMoments` beyond `category==="travel"` into a tagged **anticipation** arc (warming, not just a milestone string), and add the **afterglow** decay window.

**Edit — `src/js/services/houseModel.js`**
- Add `dayCharacter` (weekday/weekend/holiday) + `season` to the intent output, so tone and atmosphere can reflect the week and the year (feeds Phase 7's substrate).

**Edit — `src/js/services/attentionEngine.js`**
- Merge `memoryEngine`'s candidate into the queue behind the flag (one guarded concat, the Phase 3 pattern). Ranking/decay/cooldown already exist.

**Config — `src/js/config.js`**
- Add `features.memoryEngine: false`. Default off; flip on the Pi; then default on after verifying the rarity budget holds and tender-gating behaves.

**Debug** — `window.__forceMemory(id)` to surface a specific entry, and `window.__memoryState()` to inspect budget/cooldowns, so surfacing + gating can be checked without waiting for the right day.

## Step sequence (each independently verifiable)

1. Memory model + a couple of authored entries + loader → verify: entries parse; dated anchors merge into context.
2. `memoryEngine.pickMemory` pure selector → verify: unit tests — rarity budget caps to ≤1/day, per-memory cooldown holds, context-match prefers fitting tags, `null` is the common return, **tender entries only ever return an ambient/no-caption surface**.
3. Merge the memory candidate behind the flag → verify: flag-off byte-identical; flag-on, `__forceMemory` surfaces a Low-band candidate that never interrupts.
4. Generalise anticipation + add afterglow in `momentsEngine` → verify: unit tests — warming ramps toward a tagged date; afterglow decays past its window.
5. Add `dayCharacter`/`season` to House Model → verify: Sunday vs Monday and winter vs summer produce distinct tone inputs.
6. `tests/memory.spec.js` (pure) + a CDP smoke → verify: `npm test` green. Deploy flag OFF → flip ON on Pi → verify a forced memory surfaces gently + budget holds + `/kiosk-metrics` flat → default on.

## Testing

- **Pure (`insights.spec.js` style):** rarity budget (≤1/day), per-memory month-long cooldown, context-match scoring, and the **tender-gating invariant** (a `sensitivity:"tender"` entry can never return a captioned or interrupt surface). Anticipation warming + afterglow decay.
- **Kiosk:** `__forceMemory` surfaces a Low-band candidate in AMBIENT/DWELL only; it holds a beat longer; it does not recur within its cooldown; `/kiosk-metrics` flat (reuses the Phase 7 photo pipeline — no new decode cost).

## Rollout & risk

- **Frequency kills memory** — the whole value is rarity; surfaced daily it becomes wallpaper. Mitigated by a **hard** daily budget + months-long per-memory cooldown, enforced in the pure selector and unit-tested.
- **Tone-deaf timing / grief** — surfacing a tender memory badly is the worst failure this system can commit. Mitigated by the **context-appropriateness gate**, the **tender sensitivity class** (gentlest surface, hard-coded, tested as an invariant), and ambient-only placement. This is a place to be conservative: when unsure, stay silent.
- **Photo cost** — reuses the Phase 7 downscaled-photo pipeline; do not reintroduce full-res decode. Re-check `/kiosk-metrics`.
- **Reversibility** — `memoryEngine: false` = Phase 3's `on-this-day`; memories are additive data. One-line rollback.
- **Scope guard** — memories are **authored** (the household tells the house what it holds) + dated anchors; the engine does **not** infer relationships or scrape sentiment. It selects and surfaces — it does not invent what matters.

## Footprint

Authored memory data + 1 pure selector + generalising the existing `momentsEngine` + a House Model timeline slice + one guarded concat into the Phase 2 queue + a flag + tests. No new render path — the memory rides the Low-band candidate the engine already ranks, decays and shows. The hard part is not the code; it's the restraint.
