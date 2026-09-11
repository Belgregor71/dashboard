# F1 census — what the 42 `INERT-ON-V3` flags are, and whether V3 has them

2026-09-11. Precondition for audit F1 parts (b) wire-a-V3-gate and (c) retire
(`AUDIT-2026-09-10.md` §9.1). Part (a) is `0c2c015`: the 42 flags are marked in
`src/js/config.js` and `tests/flag-surface.spec.js` keeps the marks true.

**Method.** Static evidence only: each flag's incumbent reader, what it gates, and
a search of `src/v3/**` plus the shared `src/js` modules V3 imports for anything
doing the same job. Evidence was gathered by four read-only scouts; **every verdict
below is the main session's**, and the rows where a scout's reading was overturned
on re-check are marked ⚠. Nothing here was verified on the live glass — a row that
says a thing is "on the wall" means the code path exists and runs unconditionally,
not that it was seen.

## Verdicts

| Verdict | Meaning | Count |
|---|---|---|
| **EQUIVALENT** | V3 does the same thing, hardwired on. The feature is on the wall; the flag is not its lever. | 8 |
| **REPLACED** | V3 does the same job a different way — 4 of them behind a V3 flag of their own. | 13 |
| **SHARED-UNGATED** | The behaviour lives in a module V3 shares, and V3 runs it with no gate. | 4 |
| **PARTIAL** | Some of it is on V3; the missing part is named. | 2 |
| **ABSENT** | Not on V3 at all. The feature has not been on the wall since the cutover. | 10 |
| **N/A-BY-DESIGN** | Styles incumbent chrome (the hero, the top row, the stack) that V3's design has no counterpart for. | 5 |

## The table

| Flag | What it switches on (incumbent) | On V3 | Evidence (V3) | Gap vs incumbent |
|---|---|---|---|---|
| `background` | rotating background photos + tint | REPLACED | `v3/main.js:661` `initGround()`, unconditional | tint comes from the substrate, not a CSS class |
| `clock` | 1 s clock | EQUIVALENT | `v3/main.js:88` `paintHour`, `:688` every 20 s | minute precision, not seconds |
| `commute` | drive-time panel + car lottie | SHARED-UNGATED | `houseSnapshot.js:107` fetch → `candidateSources.js:194` `commuteCandidate` | no panel; reaches the glass only as an attention line |
| `weather` | weather renderer + radar, 10 min | REPLACED | `v3/main.js:167` `loadWeather` → substrate causes; `v3/subjects/forecast.js` | **no radar** |
| `calendar` | calendar + next-event panel | REPLACED | `v3/subjects/calendar.js`; next-event line in `houseSnapshot` | no persistent next-event panel |
| `homeAssistant` | `connectHA()` + HA events | EQUIVALENT | `v3/main.js:420-423`, unconditional | V3 has no HA-off path at all |
| `plex` | Plex status panel | REPLACED — own flag **`v3NowPlaying`** | `v3/core/now-playing.js:133-140`, gate `:255` | — |
| `presenceRuntime` | presence modes, no click-cycle | REPLACED | `v3/main.js:276` presence, `:545` attention | different state model (depth) |
| `attentionEngine` | scored queue on the focus hero | EQUIVALENT | `v3/main.js:545`, `v3/core/attention.js:231` `collectSources` | no off state |
| `ambientAtmospherics` ⚠ | weather/light tint on Mode 0 | REPLACED | `v3/substrate/index.js` `toCauses()` — sun, wind, cloud, rain drive the field | scout read this ABSENT ("a grid visualisation"); it is the weather field |
| `ambientSubstrate` | carry the mood across all depths | REPLACED | `v3/index.html:46` body-level `#substrate`, `v3/main.js:624` | architectural on V3, not a switch |
| `heroType` | hero size tiers by length | N/A-BY-DESIGN | no `#focus-hero` on V3 | — |
| `ambientClock` ⚠ | clock dims with sun altitude, meridiem style | **ABSENT** | `v3/main.js:129` writes `--sun-alt`; **no V3 stylesheet reads it** (only its default, `v3/css/tokens.css:82`) | scout read this as present; the variable is written and never consumed |
| `leanInStack` | glass on the DWELL stack | N/A-BY-DESIGN | V3's depth 2 is the spread composer, no stack | — |
| `stackCards` | rich stack cards, severity stripe, +N | REPLACED | `v3/core/composer.js` / `spread.js` cells | no severity stripe, no hero-glass |
| `arrivalCard` | arrival card overlay, warm crown, drain | REPLACED | `v3/core/arrival.js:135-136` interrupt candidate on the glance | no card, no drain animation, no warmth variant |
| `arrivalBottom` | repositions that card bottom-centre | N/A-BY-DESIGN | depends on `arrivalCard`'s card | — |
| `bareTopRow` | strips the incumbent top row | N/A-BY-DESIGN | V3 has no top row | — |
| `bareHero` | un-chromes the incumbent hero | N/A-BY-DESIGN | no hero container on V3 | — |
| `mediaCandidate` | folds now-playing/Plex into the queue | SHARED-UNGATED | `houseSnapshot.js:583-584, 614-623` → `candidateSources.js:250-266` | — |
| `foldHomeTiles` | folds tonight's menu into the queue | SHARED-UNGATED | `houseSnapshot.js:589, 629-630` → `candidateSources.js:301-320` | — |
| `cameraCandidate` | folds the camera trigger into the queue | SHARED-UNGATED | `houseSnapshot.js:590, 632-635` → `candidateSources.js:323-350` | contrast: `robotCandidate` **is** gated, `houseSnapshot.js:580` |
| `dailyMemories` | frozen per-day on-this-day set + map tile | REPLACED — own flag **`groundMemories`** | `v3/core/ground.js:139, 148` (`/api/immich/on-this-day`) | rotates every 10 min, not frozen; no travel-map tile |
| `ambientMemory` | tender memory, wordless, Mode 0 only | **ABSENT** (deliberately) | `v3/main.js:459-463`: on a tender day V3 shows no memory | — |
| `awakeGround` | awake modes hold one photo | EQUIVALENT | `v3/core/ground.js` — the ground photo at every depth | — |
| `livingAccent` ⚠ | accent follows the weather tint | **ABSENT** | `v3/css/tokens.css:26, 216` — `--atmo-hue` is a fixed 65 day / 40 night; **nothing in V3 writes it** | scout read this as weather-driven; it is day/night only |
| `awakePhotoDissolve` | day-boundary photo cross-dissolve | EQUIVALENT | `v3/core/ground.js:917` | — |
| `memoryWhisper` | "ON THIS DAY" whisper, Mode 0 | REPLACED | `v3/core/ground.js:535-541` caption under `groundMemories` | year/place caption, no whisper eyebrow |
| `weatherFxRain` | rain droplet/streak episodes | PARTIAL | `v3/substrate/gl.js:143` `uRain` darkens the field | **no droplets or streaks** |
| `weatherFxLightning` | lightning strike on the horizon | **ABSENT** | no lightning/thunder anywhere in `src/v3` | — |
| `reactiveGlass` | glass recolours by weather | **ABSENT** | V3 glass tokens are fixed | — |
| `skyRamp` | sunrise/sunset warmth ramp | PARTIAL | `toCauses({ sunAltitudeDeg })` drives the field's glow | no warmth colour ramp |
| `nightSky` | clear-night starfield + twinkles | **ABSENT** | no stars in `v3/substrate` or `v3/css` | — |
| `atmoTextures` | fog / heat / frost / seasonal textures | **ABSENT** | none of `fx-fog`/`fx-heat`/`fx-cold`/`season-*` on V3 | — |
| `voiceSession` | the voice session | EQUIVALENT | `v3/main.js:277` `initVoice({ enabled: true })` | — |
| `recipePanel` | recipe panel before a `Meal:` event | REPLACED — own flag **`v3DinnerPanel`** | `v3/core/dinner.js`, stage "dinner" in `v3/main.js` | — |
| `voiceRail` | rotating "you can say" rail | EQUIVALENT | `v3/main.js:191-199` `paintRail`, `#rail` | — |
| `temporalSpine` | "The Day, Rendered" timeline line | **ABSENT** | no counterpart in `src/v3` | — |
| `ambientArchive` | Mode 0 as the archive | REPLACED — own flag **`v3Archive`** | `v3/core/archive.js:78` | — |
| `ambientArchiveMotion` | Live Photo motion burst | **ABSENT** | no `<video>` in `v3/core/archive.js` | — |
| `archiveMotionLoop` | loop that burst (default OFF) | **ABSENT** | depends on the motion burst | — |
| `archiveFitToPrint` | card takes the photo's own aspect | EQUIVALENT | `v3/core/archive.js:960-963`, always | — |

## What it means for (b) and (c) — the owner's calls, grouped

1. **Four have a lever already, under another name** — `plex`→`v3NowPlaying`,
   `dailyMemories`→`groundMemories`, `recipePanel`→`v3DinnerPanel`,
   `ambientArchive`→`v3Archive`. No code: extend the mark to name the V3 lever.
2. **Four are the one real (b) target** — `commute`, `mediaCandidate`,
   `foldHomeTiles`, `cameraCandidate` are candidate lanes in shared code that V3 runs
   ungated. `robotCandidate` shows the pattern: a one-line `flag(...)` guard in
   `houseSnapshot.js`. All four are `true`, so wiring the gate changes nothing on the
   wall and creates a real rollback lever.
3. **Seventeen are on the wall hardwired** (8 EQUIVALENT + 9 REPLACED without a V3
   flag). The choice is whether each needs a kill switch at all — for the clock, HA
   and the attention engine almost certainly not.
4. **Twelve are not on the wall** (10 ABSENT + 2 PARTIAL). Port or retire. ⚠ Seven
   of them are the Living Window atmosphere — rain streaks, lightning, night sky,
   textures, reactive glass, the sky ramp, the living accent — plus the temporal
   spine and the ambient clock. **These have not been on the wall since the V3
   cutover**, whatever their flags say.
5. **Five retire with the incumbent** (N/A-BY-DESIGN).

⚠ **Retiring is not free while the incumbent is the rollback surface.** `V3_DEFAULT=0`
puts the incumbent back on the wall, and every flag in this table gates it there.
Deleting an incumbent-only flag degrades the rollback, not just dead weight.
