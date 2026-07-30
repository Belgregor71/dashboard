# Voice & Copy Expansion — Candidates

## How to use this

Everything below is a **candidate list**, not a patch. Nothing here is wired
into the app. Pick the lines you like, drop the rest, edit freely — then
hand-paste the winners into the real source files (`src/js/config/alertLines.js`,
`src/js/services/occasions.js`, `src/js/services/delight.js`) yourself, in a
separate change. Every line below was written against `docs/design/VOICE.md`
(the copy authority) — its key rules, quoted for reference while you judge:

> "Short and plain. One thing per line. The fact first."
> "Dry wit, rationed. At most one raised eyebrow per line, and most lines
> have none... never a punchline, never sarcasm, never at a person's expense."
> "The family-tease licence [applies only to] known household members
> identified by name... Guests and unknowns never do."
> "Naturally Australian... never forced slang. 'Mate' and 'ya' are not policy."
> "Security is information, not theatre... nothing speculative... the house
> doesn't editorialise."
> "Solemn days get no wit."
> "Full stops, not exclamation marks."
> "Spoken alert lines ≤ ~12 words."

Australian English, Brisbane household, winter context where the calendar
date matters (it mostly doesn't, for this copy).

---

## Sources read

| Surface | File |
|---|---|
| Copy authority | `docs/design/VOICE.md` |
| Alert lines (doorbell/side-gate) | `src/js/config/alertLines.js` |
| Occasion lines | `src/js/services/occasions.js` |
| Delight/celebration lines | `src/js/services/delight.js` |
| Delight runtime (debug samples only, not real copy) | `src/js/core/personalityRuntime.js` |
| Phrasing normaliser | `src/js/core/personality.js` |
| Memory caption template | `src/js/services/memoryEngine.js` |
| Photo-memory caption (factual, not prose) | `src/js/services/photoMemory.js` |
| Arrival greeting speech | `src/js/modules/arrivalGreeting.js` |
| Goodnight routine speech | `src/js/modules/goodnightRoutine.js` |
| AI briefing prompts (tone anchors) | `server/routes/ai.js` |
| Predictive/insight nudge templates (found, not in scope — see note) | `src/js/services/predictiveRules.js`, `src/js/services/insightRules.js` |
| Voice-command replies (found, not in scope) | `src/js/core/voiceCommands.js` |

---

## 1. Alert lines (doorbell, side gate)

**Current: 16 lines total** — 4 pools of 4 (`src/js/config/alertLines.js`).
Name-free lines are TTS pre-warmed (`PREWARM_LINES`); name-bearing lines are
built per-ring and never cached. Baseline examples:

- Name-free, front door: *"Someone's at the front door."* / *"Someone's at the front door. Probably a parcel."*
- Name-bearing, front door: *"${name}'s at the door."*
- Name-free, side gate: *"There's movement at the side gate."*
- Name-bearing, side gate: *"It's ${name}, round the side as usual."*

### 1a. Front door — name-free (prewarmed) — 8 new candidates

1. "There's a knock at the front door."
2. "Someone's on the front porch."
3. "The doorbell's gone — front door."
4. "Someone's out the front."
5. "Front door — someone's waiting."
6. "There's a visitor at the front door."
7. "Doorbell. Someone's at the front."
8. "Someone's at the door — might be a delivery." *(the pool's one eyebrow; the existing pool already has "Probably a parcel," so pick one or the other, not both)*

### 1b. Front door — name-bearing (`${name}`, never cached) — 8 new candidates

1. `${name}'s home.`
2. `${name}'s out the front.`
3. `It's ${name}.`
4. `${name}'s at the front door.`
5. `${name}'s here — front door.`
6. `${name}'s back.`
7. `Look who it is — ${name}.`
8. `${name}'s knocking — as if they need to.` *(the pool's one family-tease rib)*

### 1c. Side gate — name-free (prewarmed) — 8 new candidates

Matter-of-fact only, per rule 7 — no eyebrows in this set at all.

1. "There's someone at the side gate."
2. "Someone's near the side gate."
3. "The side gate — someone's there."
4. "Someone's come through the side gate."
5. "Side gate — motion detected."
6. "Someone's at the side of the house."
7. "There's activity at the side gate."
8. "Movement — side gate."

### 1d. Side gate — name-bearing (`${name}`, never cached) — 8 new candidates

1. `${name}'s at the side gate.`
2. `${name}'s coming through the side gate.`
3. `${name}'s at the side, not the front.`
4. `${name}'s round the side.`
5. `That's ${name} at the side gate.`
6. `${name}'s home, coming round the side.`
7. `${name}'s taking their usual side-gate shortcut.` *(family-tease, mild)*
8. `${name}'s at the side gate, as always.`

**New total proposed: 32** (across the 4 pools), on top of the existing 16.

---

## 2. Occasion lines

**Current: 11 occasions, 1 line each** (`src/js/services/occasions.js`).
Baseline examples: *"Good Friday — the long weekend's here."* (the house
style model), *"ANZAC Day — lest we forget."* (solemn, no wit), *"Merry
Christmas."* (plain greeting, nothing to add).

Two alternates per occasion below. ANZAC and Christmas stay deliberately
plain per rules 8/9 — no wit added even in the alternates.

| Occasion | Current | Alt 1 | Alt 2 |
|---|---|---|---|
| New Year | Happy New Year — clean slate. | Happy New Year — a fresh page. | Happy New Year. |
| Valentine's Day | Happy Valentine's Day. | Happy Valentine's Day — go on, say it. | Happy Valentine's Day. |
| Good Friday | Good Friday — the long weekend's here. | Good Friday — four days to enjoy. | Good Friday. Long weekend starts now. |
| Easter Saturday | Easter Saturday — the quiet middle of the long weekend. | Easter Saturday — a day with nowhere to be. | Easter Saturday — the pause before Sunday. |
| Easter | Happy Easter — the eggs won't find themselves. | Happy Easter — hope the Easter Bunny found the good hiding spots. | Happy Easter. |
| ANZAC Day | ANZAC Day — lest we forget. | ANZAC Day. | Lest we forget. |
| Mother's Day | Happy Mother's Day — breakfast is someone else's job today. | Happy Mother's Day — put your feet up. | Happy Mother's Day. |
| Father's Day | Happy Father's Day — go on, make a fuss. | Happy Father's Day — today's yours. | Happy Father's Day. |
| Halloween | Halloween tonight — expect small visitors. | Halloween tonight — the lolly bowl's earning its keep. | Halloween tonight. |
| New Year's Eve | Last night of the year. | Last night of the year — see it out. | New Year's Eve. |
| Christmas | Merry Christmas. | Merry Christmas — the big day's here. | Merry Christmas. |

**New total proposed: 22** (2 alternates × 11 occasions).

---

## 3. Personality / delight lines

**Current: 7 triggers, 1 line each** (some with name/no-name variants)
(`src/js/services/delight.js`). These are the house's two-or-three-times-a-
year moments — rarest surface, so every candidate below was held to the
highest bar. Baseline examples: *"Power's back — the house is up and
waiting."*, *"Welcome back, ${name} — the house missed you."*, *"First rain
in a while — the garden's grateful."*

| Trigger | Current | Alt 1 | Alt 2 |
|---|---|---|---|
| power-restored | Power's back — the house is up and waiting. | Power's back on — the house is awake again. | Power's back. The house missed a beat, that's all. |
| home-after-away (no name) | Welcome back — the house missed you. | Welcome back — it's good to have you home. | Welcome home — the house has missed the noise. |
| home-after-away (`${name}`) | Welcome back, ${name} — the house missed you. | Good to have you home, ${name}. | ${name}'s home — the house missed the noise. |
| birthday-morning (`${name}`) | Happy birthday, ${name}. | Happy birthday, ${name} — make it a good one. | It's ${name}'s birthday today. |
| birthday-morning (no name) | Happy birthday. | Happy birthday — make it a good one. | Happy birthday to whoever's celebrating today. |
| first-rain-after-dry | First rain in a while — the garden's grateful. | First rain in a while — the garden needed that. | It's raining, finally — the garden's been waiting. |
| christmas-eve | Christmas Eve — nearly there. | Christmas Eve — the countdown's nearly done. | One more sleep. |
| dst-sunrise | The clocks changed — longer evenings from here. | Clocks changed overnight — the evenings stretch out from here. | Daylight saving's here — longer evenings ahead. |

*(`calendar-occasion` reuses `occasions.js` directly — covered in section 2.)*

**New total proposed: 16** (2 alternates × 8 line-variants).

---

## 4. Memory whispers

Found two related surfaces, and they behave very differently on purpose:

**a) Tender memories (Mode-0 ambient lane)** — `memoryEngine.toSurface()`
hard-codes `caption: null, text: ""` whenever `entry.sensitivity === "tender"`.
This is a tested invariant, not an oversight: *"we do not narrate grief"* —
the photo carries it, wordlessly. **I'm proposing zero candidate lines for
this lane** — writing any words for it would work against the design the
code deliberately enforces. Flagging this so the human doesn't read the
silence below as me having missed the surface.

**b) Normal "on this day" memory caption** — a single hard-coded template,
not a pool: `` `On this day — ${title}.` `` (falls back to `"On this day."`
with no title). This is a good candidate for becoming a small pool. New
candidates:

1. `On this day — ${title}.` *(current, keep as baseline)*
2. `From this day — ${title}.`
3. `A memory from today — ${title}.`
4. `Today, once — ${title}.`
5. `${title} — on this day.`
6. `On this day.` *(no-title fallback, current — keep)*
7. `A memory for today.` *(alt no-title fallback)*

**New total proposed: 5** (beyond the 2 existing templates kept as baseline).

---

## 5. Briefing phrasings

**Current: 3 tone-anchor example lines**, one per briefing type
(`server/routes/ai.js` `SYSTEM_PROMPTS`). These aren't spoken to the user —
they're the few-shot style example baked into the Haiku/Ollama prompt, so
the model's actual output stays in-voice. Baseline:

- Morning: *"Quiet one today — nothing on the calendar. UV hits 8 by lunch, so hat and sunscreen if you're out. Bins go out tonight."*
- Evening: *"Nothing left on the books tonight. Tomorrow's mid-twenties and sunny — an easy one. Bins go out tonight."*
- Concierge (one-liner): *"Warm already, and it's not even nine."*

### Morning — 3 new tone-anchor alternates

1. "Light one on the calendar today. Top's low twenties, plenty of sun. Bins go out tonight."
2. "A full one today — three things on before lunch. Cool start, warms up by arvo."
3. "Nothing on this morning. Overcast most of the day, and the bins are due tonight."

### Evening — 3 new tone-anchor alternates

1. "Quiet rest of the night. Tomorrow starts cool, clears by mid-morning. Bins go out tonight."
2. "One thing left tonight, then it's clear. Tomorrow's a top of twenty-six, fine all day."
3. "Nothing left on the books. Tomorrow's cooler and cloudy — worth a jacket on the way out."

### Concierge (one-liner, ≤12 words) — 4 new tone-anchor alternates

1. "Cool start — the fog hasn't lifted off the hills yet."
2. "Clear and still. A proper winter morning."
3. "Overcast all day, but dry — no need for the umbrella."
4. "Getting on for evening, and the light's gone gold."

**New total proposed: 10** (3 + 3 + 4).

### Also found, not in scope for this pass

- `src/js/services/predictiveRules.js` and `src/js/services/insightRules.js`
  hold deterministic, factual nudge templates (rain-incoming, bin night,
  leave-by, fuel price). They already read as in-voice (short, factual, one
  clause) and weren't named in the brief — flagging their existence rather
  than expanding them.
- `src/js/core/voiceCommands.js` holds functional voice-reply strings (view
  switches, status readouts). Also not named in the brief; skipped.

---

## VOICE.md tensions noticed in existing code (flagged, not fixed)

1. **`src/js/modules/goodnightRoutine.js` `buildMessage()`** opens with
   `"Goodnight!"` — an exclamation mark, which `VOICE.md`'s Mechanics section
   explicitly rules out ("Full stops, not exclamation marks."). The message
   is also built as a raw string and spoken directly — it never passes
   through `phrase()` the way the arrival greeting does (Phase 10), so it
   sits entirely outside the one normalisation seam the rest of the house
   routes through.
2. **`VISITOR_KNOWN_LINES` in `alertLines.js`**: `` `${name}'s at the door. Act natural.` ``
   reads closer to a punchline aimed at the household than an "observation"
   — rule 2 is explicit that an eyebrow is "never a punchline." It's
   arguably licensed under the family-tease rule (rule 3), but it's a
   judgment call worth a second look, not a clear pass.
