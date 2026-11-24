---
name: Kiosk Dashboard (V3)
description: A 24/7 household wall at 1920×1080, read from 3–4 m, that says almost nothing until it has a reason to.
colors:
  surface: "oklch(0.16 0.012 65)"
  surface-lift: "oklch(0.21 0.012 65)"
  surface-sunk: "oklch(0.12 0.012 65)"
  scrim-base: "oklch(0.08 0.01 65)"
  ink: "oklch(0.93 0.010 85)"
  ink-dim: "oklch(0.74 0.012 85)"
  ink-faint: "oklch(0.62 0.014 85)"
  ink-night: "oklch(0.86 0.014 55)"
  ink-dim-night: "oklch(0.66 0.016 55)"
  ink-faint-night: "oklch(0.62 0.018 55)"
  accent: "oklch(0.78 0.09 65)"
  accent-night: "oklch(0.70 0.09 40)"
  warm: "oklch(0.82 0.13 68)"
  ok: "oklch(0.78 0.15 150)"
  warn: "oklch(0.82 0.14 75)"
  error: "oklch(0.70 0.17 27)"
typography:
  hour:
    fontFamily: "Roboto Flex, system-ui, sans-serif"
    fontSize: "168px"
    fontWeight: 200
    lineHeight: 0.9
    letterSpacing: "-0.03em"
    fontFeature: "tnum"
    fontVariation: "\"GRAD\" 0"
  display:
    fontFamily: "Figtree, system-ui, sans-serif"
    fontSize: "132px"
    fontWeight: 300
    lineHeight: 1.06
    letterSpacing: "-0.026em"
  headline:
    fontFamily: "Figtree, system-ui, sans-serif"
    fontSize: "96px"
    fontWeight: 300
    lineHeight: 1.06
    letterSpacing: "-0.026em"
  title:
    fontFamily: "Roboto Flex, system-ui, sans-serif"
    fontSize: "72px"
    fontWeight: 400
    lineHeight: 1.24
    letterSpacing: "0.004em"
    fontFeature: "tnum"
    fontVariation: "\"GRAD\" 0"
  body:
    fontFamily: "Roboto Flex, system-ui, sans-serif"
    fontSize: "48px"
    fontWeight: 400
    lineHeight: 1.24
    letterSpacing: "0.004em"
    fontFeature: "tnum"
    fontVariation: "\"GRAD\" 0"
  rail:
    fontFamily: "Figtree, system-ui, sans-serif"
    fontSize: "32px"
    fontWeight: 300
    letterSpacing: "0.01em"
  label:
    fontFamily: "Roboto Flex, system-ui, sans-serif"
    fontSize: "32px"
    fontWeight: 400
    lineHeight: 1
    letterSpacing: "0.06em"
  label-fyi:
    fontFamily: "Roboto Flex, system-ui, sans-serif"
    fontSize: "24px"
    fontWeight: 400
    lineHeight: 1
    letterSpacing: "0.06em"
  engraved-year:
    fontFamily: "Roboto Flex, system-ui, sans-serif"
    fontSize: "400px"
    fontWeight: 100
    letterSpacing: "0.02em"
    fontFeature: "tnum"
rounded:
  hair: "2px"
  tile: "6px"
  card: "12px"
  pill: "999px"
spacing:
  gap: "16px"
  gutter: "28px"
  safe: "96px"
components:
  said-line:
    textColor: "{colors.ink}"
    typography: "{typography.display}"
  measured-readout:
    textColor: "{colors.ink}"
    typography: "{typography.title}"
  measured-support:
    textColor: "{colors.ink-dim}"
    typography: "{typography.body}"
  vocabulary-rail:
    textColor: "{colors.ink-faint}"
    typography: "{typography.rail}"
  heard-transcript:
    textColor: "{colors.ink-faint}"
    typography: "{typography.body}"
  fault-pill:
    backgroundColor: "{colors.surface-sunk}"
    textColor: "{colors.ink-dim}"
    typography: "{typography.label-fyi}"
    rounded: "{rounded.pill}"
    padding: "6px 14px"
  timer-pill:
    backgroundColor: "{colors.surface-sunk}"
    textColor: "{colors.ink-dim}"
    typography: "{typography.label}"
    rounded: "{rounded.pill}"
    padding: "8px 20px"
  archive-card:
    backgroundColor: "{colors.surface-sunk}"
  locator-plate:
    rounded: "{rounded.card}"
    width: "422px"
---

# Design System: Kiosk Dashboard (V3)

## Overview

**Creative North Star: "The Quiet Window"**

The wall is a window onto the house's day and its photo album, hung in the kitchen and passed
a hundred times a day by people who aren't looking at it. Most of the time it shows a
photograph, the hour and the light of the actual sky, and nothing else. When it has a reason to
speak (someone arrives, a bin goes out tonight, a question was asked), one thing comes forward
in large, light type. When the reason passes, the thing goes back. Nobody touches it. Voice is
the only input, so the screen has no buttons, no hover states and no cursor.

There are no pages or panels. There is one composition at four depths: **field** (nobody
present), **glance** (exactly one thing), **spread** (one dominant cell and two to four
supporting ones) and **subject** (one named thing, full bleed). Depth is the only navigation,
and the wall always settles back downhill on its own. Content sits in a fixed 12×7 lattice of
six legal rectangles, because a layout that never moves is one the household can learn.

Every value comes from the viewing distance, not from taste. At ~69 PPI seen from 3 m, text
below ~30px doesn't reach the eye, so 32px is the floor. Colour is one OKLCH lightness ramp
whose hue follows the weather and the sun while its lightness stays fixed, so a change of tint
can never break a contrast guarantee.

**Key Characteristics:**
- Mostly photograph and silence. Words appear only when they've earned it.
- Two typefaces, and the face itself says who is talking: Figtree when the house is **saying**
  something, Roboto Flex when it is **measuring** something.
- Warm, dim and never pure: no `#000` ground and no `#fff` ink.
- Light instead of chrome. Weather tints the surface, the house shows up as a glow, and nothing
  sits in a frosted box.
- Motion only for causes the room can see: the sun, weather, an arrival, the track, a new photograph.

## Colors

The palette is near-monochrome and warm: one dark ground and one ink ramp, both on a hue that
moves with the day, plus a single warm signal held in reserve.

### Primary
- **Weather-Lit Accent** (`accent`): the living accent. Lightness and chroma are fixed (L 0.78,
  C 0.09 by day; L 0.70 at night) and only the hue moves with the weather, so its contrast
  against the ground is a system invariant. It's used for progress rings and record artwork
  strokes on the media surfaces. It is never text and never chrome.

### Secondary
- **House-Light Amber** (`warm`): the one warm signal. It's reserved for the house's own light
  (the presence rim), sun glyphs, lightning and the parcel illustration. Never body text, never
  borders on ordinary furniture.

### Neutral
- **Kitchen Dark** (`surface`): the ground behind everything. It's L 0.16, not black, because
  pure black under near-white ink halates.
- **Lifted Dark** (`surface-lift`): one step up, for illustration fills that need to read as
  nearer.
- **Sunk Dark** (`surface-sunk`): one step down, for the grounds that elements carry themselves:
  the pills, the archive card, the year plate.
- **Scrim Dark** (`scrim-base`): the colour of the gradient scrim under text on photographs,
  and of the house plan's full-bleed ground.
- **Warm Paper Ink** (`ink`): primary text. Warm rather than blue-white, so the screen is dim
  at night and not cold.
- **Dimmed Ink** (`ink-dim`): supporting readouts and pill text.
- **Faint Ink** (`ink-faint`): the vocabulary rail and the heard transcript. It was lifted to
  L 0.62 because nothing lower clears AA-large over a white photograph at any scrim opacity.
- **Night Inks** (`ink-night`, `ink-dim-night`, `ink-faint-night`): dimmer and warmer (hue 55)
  for after dark. Faint Ink keeps L 0.62 at night, so the night ramp is effectively two steps.

### Status
- **Well** (`ok`), **Heads-up** (`warn`), **Fault** (`error`): each desaturated about 15% from
  its naive value so it keeps its weight on a dark ground. Fault is the dot on the fault pill and
  the strike through a misheard transcript.

### Illustration colours
The house plan, the day-lapse and the robot layer are drawn over an illustration and use that
illustration's own sRGB colours (`--plan-*`, `--lapse-*`, `--robot-*`, `--bin-*` in
`src/v3/css/tokens.css`). They belong to the illustration, not to the wall's inks, and must not
spread to text or furniture.

### Named Rules
**The Held Lightness Rule.** Atmosphere may rotate `--atmo-hue` (65 by day, 40 at night),
tint the archive mat, grade the photograph, tint the scrim and drive the Living Window overlay.
Nothing else. Anything that moves a lightness has to be measured against the real photograph
with the weather forced before it ships.

**The Never-Pure Rule.** No `#000`, no `#fff`. The darkest ground is L 0.08 and the brightest
ink is L 0.93.

**The Reserved Warmth Rule.** House-Light Amber means the house itself, the sun or lightning. If
it's on a label, it's wrong.

## Typography

**Said Font:** Figtree (with system-ui, sans-serif)
**Measured Font:** Roboto Flex (with system-ui, sans-serif)

**Character:** A geometric sans set large, light and tight for the house's voice, against a
neutral grotesque at reading weights for numbers and states. Both are sans, so the difference
rests on size and weight. Setting the two at similar size and weight erases the system's one
typographic rule.

### Hierarchy
- **Hour** (Roboto Flex 200, 168px, line-height 0.9, −0.03em, tabular): the time, glanced at
  from the far side of the room. At depth 1 it scales down to 72/168 with a transform, never
  with a font-size change.
- **Display** (Figtree 300, 132px, 1.06, −0.026em, balanced wrap): the one thing this glance
  is about.
- **Headline** (Figtree 300, 96px): the same voice when the line is long. A long line steps
  down to this size; it never wraps to a third line.
- **Title** (Roboto Flex 400, 72px, 1.24, tabular, full Ink): the primary readout and the
  comfortable reading size at 3 m.
- **Body** (Roboto Flex 400, 48px, Dimmed Ink): supporting readouts and the heard transcript
  (set at 300 in Faint Ink).
- **Rail** (Figtree 300 italic, 32px, Faint Ink, in curly quotes): the vocabulary rail, which
  shows the exact words to say. This is the floor.
- **Label** (Roboto Flex 400, 32px, 0.06em, UPPERCASE): states the house reports on its own
  ground, such as the timer pill.
- **Label FYI** (Roboto Flex 400, 24px, 0.06em, UPPERCASE): the fault pill only. It is the
  one sanctioned size under the floor, because it carries its own ground at ~6.7:1 and its
  dot does the across-the-room work.
- **Large set pieces:** the engraved year (Roboto Flex 100, 400px, tabular, ink at ~5.5%, a
  hairline stroke), the plane's word (150px) and the journey's year (128px).

### Named Rules
**The Said-or-Measured Rule.** If the house is speaking, it's Figtree. If it's reporting a
number or a state, it's Roboto Flex. No line mixes them. What the recogniser heard is measured,
because it isn't the house talking.

**The Floor Rule.** Nothing renders below 32px except the FYI pill. When something doesn't
fit, delete it. Never shrink it.

**The Grade-Not-Weight Rule.** At night the measured voice raises `GRAD` (0 to 80) to
thicken strokes at constant metrics. Never compensate with weight, which reflows the line.

**The Tabular Rule.** Every number that ticks uses tabular figures. The wall runs for weeks,
and proportional digits shift the layout every minute.

**The True-Italic Rule.** The rail is real Figtree italic. Any replacement face must ship a
true italic; count the faces the font API returns, because it answers 200 for an italic that
doesn't exist.

## Layout

The layout is a fixed 1920×1080 canvas at 1:1 CSS px. It is not responsive and has no scroll.
Content sits inside a **96px safe inset** on a **12-column × 7-row lattice** with a **28px
gutter**. The composer can only place content in six legal rectangles:

- **full**: the whole lattice
- **dominant**: columns 1–7, rows 1–5
- **tall**: columns 8–12, rows 1–5
- **wide**: columns 1–7, rows 6–7
- **side**: columns 8–12, rows 6–7
- **rail**: the bottom row, aligned to the end

Cells stack bottom-up (`justify-content: flex-end`) with a 16px internal gap. At depth 3 the
lattice drops its inset and the subject takes the whole screen, applying the single 96px inset
itself, so a subject is the screen rather than a card on it.

Corners have owners. The fault pill takes top-left and stands down at depth 3, where a
subject's title owns that corner. When one element takes a corner, whatever was there moves
or stands down. Nothing overlaps.

## Elevation & Depth

Depth comes from **light, scrim and tonal grounds**, with a few real shadows on objects that
sit above the photograph. Blur is not a material. `backdrop-filter` re-reads the layer beneath
it every frame, and a shaped gradient scrim is both cheaper and more legible.

Text over a photograph is made legible twice. A bottom-up gradient scrim (`--scrim`) has its
opacity solved per photograph by `core/scrim.js`, which samples the image and finds the smallest
opacity that clears the contrast target. On top of that, every text element carries a two-layer
ink shadow for the highlight the scrim didn't anticipate.

### Shadow Vocabulary
- **Ink shadow** (`0 2px 18px oklch(0.05 0 0 / 0.75), 0 1px 3px oklch(0.05 0 0 / 0.55)`): on
  all said, measured, rail and heard text.
- **Lift 1** (`0 6px 20px oklch(0.05 0 0 / 0.55), 0 1px 2px oklch(0.05 0 0 / 0.6)`): media
  frames and artwork tiles.
- **Lift 2** (`0 18px 60px oklch(0.05 0 0 / 0.6), 0 2px 6px oklch(0.05 0 0 / 0.5)`): the
  record at depth 3.
- **Archive card** (`0 48px 110px oklch(0.05 0 0 / 0.62)` and a 1px outline of Warm Paper Ink
  at 18%): the photograph held up off the mat.

### Named Rules
**The No-Glass Rule.** No `backdrop-filter`, no frosted panels. An element that needs a ground
brings an opaque one (Sunk Dark at 92%), composited once.

**The Real-Sun Rule.** Light on the surface points where the actual sun is. `--sun-az` is
written from suncalc, and the plan's shading and the field follow it.

## Shapes

Form language is quiet and mostly square. The ambient surface has almost no shapes at all:
words, a photograph and light. Where a shape is needed, it uses one of four radii:

- **Hair** (2px): thin progress bars and caption rules.
- **Tile** (6px): artwork, media frames and map tiles.
- **Card** (12px): the house-plan locator, parcel and day-lapse plates.
- **Pill** (999px): states the house reports (fault, timers).

The archive card itself is square, held by an outline and a shadow rather than rounded corners.
Every radius must be one of these tokens, and `tests/v3-token-lint.spec.js` refuses a literal.

## Components

There are no buttons, inputs or navigation; voice replaces all three. The components are
utterances, readouts and the few objects that sit on the photograph.

### The Said Line
Large, light and few words. Figtree 300 at 132px (96px when long), Warm Paper Ink with the ink
shadow, balanced wrap. A wrapped line breaks at its first ` · ` and the dot travels with the
break. One per glance.

### The Measured Readout
Roboto Flex at 72px (primary, full Ink) or 48px (supporting, Dimmed Ink), tabular, with GRAD
bound to the night grade. Numbers and states only, never an editorial sentence.

### Pills (fault, timer)
- **Style:** Sunk Dark at 92% as its own ground, pill radius, Roboto Flex uppercase at 0.06em,
  Dimmed Ink, one line with ellipsis.
- **Fault:** 24px, 6px 14px padding, a 1px border of Fault at 30%, and an 8px Fault dot that
  reads before the words do. Top-left. Only `error` level reaches it. Hidden at depth 3.
- **Timer:** the same idiom at the 32px label size with 8px 20px padding. While ringing (at
  most 90 s) its border takes House-Light Amber at 70% and it pulses between full and 0.75
  opacity; reduced motion stops the pulse.

### The Vocabulary Rail
Figtree 300 italic at 32px in Faint Ink, wrapped in curly quotes. It shows the literal phrase to
say, not a description of a capability. It's peripheral and meant to be absorbed over weeks.

### The Heard Transcript
What the house believes it heard, in the measured voice at 48px weight 300, Faint Ink. "Heard
but not understood" gets a 2px Fault-coloured strike while the words lift to Dimmed Ink, so the
two failures never look alike.

### The Archive Card (signature)
An "on this day" photograph held above a matted field: Sunk Dark behind, the archive shadow and
hairline outline, square corners, left-pinned at 130px so a portrait simply reaches less far.
Its size is set instantly on each photograph exchange, never animated. It turns slowly in 3D on
an 84s alternate. Ghost cards drift behind it, and an engraved 400px year sits faint under the
whole field.

### The Presence Rim (signature)
The house has no orb, waveform or avatar. Its presence is a 260px band of warm light along the
bottom edge. It gathers with real microphone level while listening and sweeps across the width
with TTS playback while speaking. It uses opacity and transform only, with `contain: strict`.

## Do's and Don'ts

### Do:
- **Do** take every colour, size, radius and duration from `src/v3/css/tokens.css`. A literal
  that isn't a token fails the token lint.
- **Do** hold lightness and chroma fixed and move only hue for atmosphere.
- **Do** set speech in Figtree and numbers in Roboto Flex, with tabular figures on anything
  that ticks.
- **Do** give text over a photograph both the solved scrim and the ink shadow.
- **Do** use the motion set: 150 / 250 / 350ms, 700ms for a scene, `cubic-bezier(0.22, 1, 0.36, 1)`
  to arrive and `cubic-bezier(0.55, 0, 0.8, 0.3)` to leave. Animate transform and opacity only,
  and keep depth exchanges opacity-only.
- **Do** scale motion amplitude down after dark. Rain at midnight still falls, faintly.
- **Do** honour `prefers-reduced-motion` fully. The presence rim still changes state; it just
  stops animating between states.

### Don't:
- **Don't** set anything below 32px, except the fault pill's 24px FYI.
- **Don't** use `#000`, `#fff`, a blue-white ink or a cool night.
- **Don't** use `backdrop-filter` or frosted glass anywhere.
- **Don't** add a weather icon. The weather lights the surface instead.
- **Don't** add idle loops, breathing, shimmer or anything that moves without a cause the
  room can name. Time passing is not a cause, and neither is a fetch completing.
- **Don't** animate `width`, `height`, `top`, `left` or `font-size`.
- **Don't** put House-Light Amber on labels, borders or body text. The one border exception is a
  timer that is ringing, which is the house's own event firing.
- **Don't** add pointer affordances (hover, selection, cursor). There is no pointer.
- **Don't** place content outside the six legal lattice rectangles.
