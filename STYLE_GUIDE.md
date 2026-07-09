# Dashboard Style Guide

This documents the design system that emerged from redesigning the dashboard into
an ambient living display. It's descriptive (what the code actually does today)
as well as prescriptive (what new work should follow) — when in doubt, match an
existing pattern here rather than inventing a new one.

## Design philosophy

- **Ambient, not a control panel.** Information earns its screen space. If a
  panel has nothing to say right now, it shouldn't be visible — not blank, not
  stretched, just absent (see [Layout](#layout--grid) below).
- **Glanceability over interaction.** No touchscreen exists. Every view should
  be readable from across the room without anyone touching anything.
- **Minimal text, occasional voice.** Prefer one good line over a paragraph.
  The one AI-text destination that survives as a full page (Briefing) is
  deliberately off the primary navigation for this reason.
- **Motion only when it means something.** Every animation in this codebase
  either communicates a state change (fade between views) or serves a real
  purpose (the screensaver's position drift exists for OLED burn-in
  protection, not decoration). No motion for its own sake.
- **Self-hosted over cloud where it's free to do so.** Local Kokoro-TTS for
  voice; local Ollama as the always-available AI fallback. The one deliberate
  cloud exception is briefing/concierge text generation (Claude Haiku via
  `/api/ai/brief`, ~$0.001 per briefing) — quality there proved worth paying
  for, and Ollama still takes over automatically whenever the API or the
  internet is down. Direct third-party calls (Open-Meteo, RainViewer, OSM
  tiles) are fine
  when the provider explicitly supports it; anything that looks like
  sustained automated scraping against a provider's stated policy (BOM's
  radar imagery) is avoided even if it would technically work.

## Typography

Three font families, used consistently everywhere — never introduce a fourth or
hardcode a font stack literally; always reference the variables.

```css
--font-display: "Barlow Condensed", "Inter", sans-serif;  /* headlines, numbers */
--font-body:    "Inter", Arial, sans-serif;                /* everything else */
--font-mono:    "JetBrains Mono", monospace;               /* debug/technical readouts */
```

| Use case | Font | Example |
|---|---|---|
| Clock, hero temp, metric-card values, panel/view titles | `--font-display` | `8:44am`, `18°`, "Timeline" |
| Eyebrow labels, meta text, body copy, descriptions | `--font-body` | "NUDGEE · TODAY", "Feels like 21°" |
| Debug overlays, technical status readouts | `--font-mono` | camera debug badge |

The rule of thumb: if it's the biggest, most prominent number or word in a
component, it's display. If it's supporting/secondary text, it's body. This
was the exact bug fixed when Weather's hero temp was found rendering in the
body font — every numeric "headline" element must explicitly set
`font-family: var(--font-display)`; nothing inherits the right font by luck.

Google Fonts must explicitly load every weight used. Current URL imports
Barlow Condensed at 200–700 and Inter at 300–600. If a new weight is needed,
update the `<link>` in `index.html` alongside the CSS — missing weights fail
silently (the browser substitutes the nearest available weight).

Sizing uses `clamp()` almost everywhere rather than fixed px/rem, so panels
scale gracefully across viewport sizes without a separate mobile breakpoint
system. Shared size tokens:

```css
--fs-jumbo:      clamp(6rem, 13vw, 10.5rem);  /* screensaver clock */
--fs-hero:       clamp(4rem, 8vw,  9rem);     /* weather hero temp */
--fs-display:    clamp(2rem, 4.8vw, 4rem);
--fs-title:      clamp(1.25rem, 2.2vw, 2rem);
--fs-view-title: clamp(1.8rem, 2.6vw, 2.6rem);
--fs-eyebrow:    0.78rem;
--fs-body:       1rem;
--fs-small:      0.85rem;
--ls-eyebrow:    0.16em;   /* eyebrow letter-spacing */
```

## Color system

### Time-of-day accent (the "living" color)

One CSS variable, set by `background.js` via a body class, consumed
everywhere — the clock, view-header eyebrows/titles, and panel backgrounds
all quietly shift together across the day instead of each having their own
clock logic.

```css
body.tint-morning { --accent: rgba(255, 205, 140, 0.96); }
body.tint-day     { --accent: rgba(255, 255, 255, 0.95); }
body.tint-evening { --accent: rgba(255, 185, 130, 0.94); }
body.tint-night   { --accent: rgba(130, 215, 255, 0.92); }
```

Background wash colors (separate from `--accent`, applied to `#background-tint`):

```css
.tint-morning { background-color: rgba(255, 200, 120, 0.18); }
.tint-day     { background-color: rgba(255, 255, 255, 0.05); }
.tint-evening { background-color: rgba(255, 130, 60,  0.20); }
.tint-night   { background-color: rgba(2,   6,  20,  0.62); }
```

### Living background (season / weather / holiday)

Layered on top of the time-of-day system as additional body classes, all
GPU-cheap static `filter`/`box-shadow` swaps — no new animations:

```css
body.season-summer #background-tint  { filter: saturate(1.1); }
body.season-winter #background-tint  { filter: saturate(0.85) brightness(0.95); }
body.weather-bg-storm #background-image { filter: saturate(0.6) contrast(1.1) brightness(0.7); }
body.weather-bg-rain  #background-image { filter: saturate(0.8) contrast(1.0) brightness(0.85); }
body.is-holiday #background-tint     { box-shadow: inset 0 0 220px rgba(250, 204, 21, 0.10); }
```

No moon-phase styling — deliberately excluded, not a gap.

### Ink hierarchy (text on dark surfaces)

The dashboard background is always dark. Use the ink token that matches the
visual weight you want — never write a literal `rgba(255,255,255,X)` for text.

```css
--ink:       #eef3fb;   /* primary text — full-brightness white-blue */
--ink-dim:   #9fb0d4;   /* secondary / supporting text */
--ink-faint: #5e6f96;   /* tertiary / disabled / quiet meta labels */
```

`color: #fff` is only appropriate when text sits directly on a saturated
coloured background (a `--status-ok` green badge, a `--status-error` red
badge, etc.) where `--ink` would not provide sufficient contrast. On all
glass surfaces and standard dark backgrounds, use `var(--ink)`.

### Status semantics

Shared meaning for ok/warn/error/info across Cameras, Status, and media
automation — never define a one-off green/red in a component file.

```css
--status-ok:    #4dd57b;
--status-warn:  #ffb347;
--status-error: #ff6b6b;
--status-info:  #79b8ff;
```

Use `color-mix(in oklch, var(--status-X) N%, transparent)` for tinted badge
backgrounds rather than hard-coded rgba values — this keeps the palette
consistent if a status token ever changes.

### Glass surface tokens

Every panel/card uses these — don't write a one-off `backdrop-filter`/
`background` combination in a component file.

```css
--glass-blur:      blur(18px) brightness(0.87);
--glass-bg:        linear-gradient(180deg, rgba(24, 28, 40, 0.48), rgba(10, 12, 18, 0.34));
--glass-border:    1px solid rgba(255, 255, 255, 0.10);
--glass-radius:    18px;
--glass-radius-sm: 14px;
--radius-pill:     999px;
--radius-modal:    22px;   /* standard modal/overlay card */
--radius-modal-xl: 32px;   /* large occasion/holiday cards */
--glass-shadow:    0 8px 28px rgba(0, 0, 0, 0.30);
--glass-sheen:     inset 0 1px 0 rgba(255, 255, 255, 0.07);
```

The five-property pattern for any glass surface is always:
`background`, `border`, `backdrop-filter`, `box-shadow` (shadow + sheen),
`border-radius`. Never apply them piecemeal — either use all five or none.

The Weather view's `.weather-glass` is a deliberate, brighter exception (it
sits over a cinematic video background and needs more contrast) — don't
"fix" it to match `--glass-bg`, and don't copy its values elsewhere either.

### Layout tokens

```css
--layout-gutter: 40px;   /* horizontal page margin (left/right of view content) */
--layout-gap:    20px;   /* standard gap between grid cells / stacked panels */
```

### Spacing tokens

```css
--space-xs: 0.35rem;
--space-sm: 0.6rem;
--space-md: 1rem;
--space-lg: 1.5rem;
--space-xl: 2rem;
```

## Layout & grid

**The hard-learned rule: never use `align-content: stretch` / default grid
stretch on a container whose row count can shrink to one.** A multi-row grid
with `stretch` distributes evenly; collapse it to a single row (which
happened twice during this redesign — Home's panel grid, and it'll happen
again to anything built the same way) and that one row inflates to fill 100%
of the container, dragging every panel inside it along to fill that space
too. Default to `align-content: start; align-items: start;` on any grid
where the row/column count is content-dependent, and let leftover space stay
empty — that's the correct ambient behavior, not a bug to paper over.

Panels that have nothing to show (`is-hidden is-collapsed`) should be
`display: none`, not present-but-empty. Never reserve permanent visual space
("meta" sub-label lines, empty cards) for a value that's frequently absent —
either wire it to something real or remove the slot. This was the concrete
finding on Weather's metric cards: three "meta" lines were hardcoded to `""`
forever, reserving blank space for nothing.

## Navigation model

Four views in the click-cycle, in this fixed order:
`home → weather → cameras → timeline → home`.

- **Home is the one ambient anchor.** Every other navigation path
  (click-cycle, voice command, HA `dashboard_command`, scheduled briefings,
  doorbell/camera alerts) eventually lands back on Home — it's not "one view
  among four," it's the resting state everything returns to.
- **Voice-first, click as fallback.** With no touchscreen, voice commands
  ("show weather", "show cameras") are the intended way to reach Explore
  views; click-cycle exists as the always-available fallback.
- **Auto-return.** Any non-Home view reverts to Home after 90 seconds of no
  interaction (`EXPLORE_RETURN_MS` in `viewManager.js`) — shorter than the
  5-minute screensaver idle timeout, so the dashboard settles back to ambient
  well before the screensaver itself would engage.
- **Status and Briefing are intentionally unreachable by click or voice
  click-cycle** — they still exist and work via `switchView()` directly
  (diagnostics, scheduled AI briefing), they're just not part of the ambient
  experience.
- **The screensaver always exits to Home**, regardless of which view was
  showing when it engaged — same "Home is the anchor" principle applied to
  the idle state.

## Voice & AI personality

**Tone: dry, deadpan Australian humour — a sarcastic mate giving the
rundown, not a cheerful chatbot or a stand-up comedian.** Never forced, never
a string of puns, no "g'day" cliché overload.

This is implemented two different ways depending on how much context exists
to riff on, and that distinction matters — don't reach for an AI call by
default:

- **Rich context (morning/evening briefs)** → AI-generated, via
  `server/routes/ai.js`'s `SYSTEM_PROMPTS`. Claude Haiku is the primary
  generator with local Ollama as automatic fallback. Every prompt includes a
  **concrete example response** to anchor the voice — small local models
  (`llama3.2:1b`) need it to follow the tone at all, and it keeps the two
  generators sounding like the same house voice.
- **Thin/no context (doorbell alerts)** → a **curated static list**, picked
  client-side with no AI round-trip at all (`doorbellAlert.js`). Two reasons:
  the alert needs to fire instantly, and there's nothing for an AI to
  meaningfully riff on beyond "someone's at the door" — a tiny model with
  too little context is exactly when hallucination risk is highest (it
  invented "kids home from school" and other fabricated household details in
  testing, contradicting this project's explicit no-assumed-children stance).
  When in doubt about whether a moment has "enough context," default to a
  curated list.
- **The ambient concierge** (Focus Hero's idle fallback line) is the
  least reliable of the three even with guardrails — accept occasional flat
  or odd lines there rather than fighting the model further; it's
  low-stakes, ambient-only content. `focusHero.js` fetches `/api/weather/now`
  directly for this (not the home view's DOM text) so the model has real
  temp/condition/range to work from — without it, it previously invented
  forecasts ("tomorrow's gonna be hot") out of thin air.

TTS: self-hosted Kokoro (`bf_emma` voice, British English — Piper/Kokoro have
no Australian voice, and `tts.js`'s existing preference order already
treated en-GB as the closest fallback before this was even self-hosted).
Falls back to the browser's native `speechSynthesis` if the Kokoro container
is unreachable, rather than going silent — never let a voice feature degrade
to nothing.

## Motion

GPU-cheap (`transform`/`opacity`/static `filter` only) and always tied to a
reason:

| Motion | Purpose | Where |
|---|---|---|
| Screensaver content drift (4 min cycle, 8s ease) | OLED/burn-in protection | `screensaver.js` |
| Screensaver photo Ken Burns (zoom/pan over 30s, varied per photo) | Ambient "alive" feel + OLED burn-in protection | `screensaver.css` `ss-kb-*` |
| View fade transitions | State change feedback | `panels.css` |
| Focus Hero / Timeline Moments | None — static, no animation | — |

If a new motion idea doesn't have a one-sentence reason beyond "looks nice,"
it's probably not in keeping with this dashboard — re-read the Design
philosophy section above.

### Shared keyframes

`@keyframes` used across more than one file live in `src/css/utils/helpers.css`,
not in a component or view file. The current shared keyframes:

```css
@keyframes status-lamp-pulse { … }   /* used by .ha-connection__dot in home-panels.css */
```

Never define a keyframe in a component file if it's already (or might be)
consumed by another component — move it to `helpers.css` instead.

### CSS class states, not inline styles

Animating an element from JS must be done by toggling CSS classes, not by
mutating `element.style.*`. Inline style mutations bypass the cascade and
make transitions impossible to override or inspect.

The lightning flash pattern is the canonical example:

```js
// Correct — class toggle
flash.classList.remove("is-fading");
flash.classList.add("is-flashing");
requestAnimationFrame(() => {
  flash.classList.remove("is-flashing");
  flash.classList.add("is-fading");
});
```

```css
/* Correct — states defined in CSS */
.wx-flash.is-flashing { background: rgba(255, 255, 255, 0.55); transition: none; }
.wx-flash.is-fading   { background: transparent; transition: background 180ms ease-out; }
```

## Performance notes (Pi 4 / NAS split)

- Heavy compute (AI text generation, TTS synthesis) runs on a NAS over the
  LAN, never on the Pi itself — the Pi only renders.
- External image/tile fetches (radar, basemap) are server-proxied and
  cached (24h for static basemap tiles, 5min for data that actually changes)
  rather than re-fetched on every page paint.
- Prefer `transform`/`opacity` animations over anything that triggers layout
  or paint on every frame.
