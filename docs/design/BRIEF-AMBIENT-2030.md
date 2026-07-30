# Design brief — the living window, unconstrained

## What this is

A 32" display permanently mounted in a kitchen, running 24 hours a day. It is not a
dashboard. It should feel like a living window into the home rather than software.

When someone walks into the kitchen they should not think *"I'm looking at a dashboard."*
They should think *"the house is alive."*

This is **not a greenfield invention.** The product already exists, has a locked thesis, a
shipped design system, and about 300 commits behind it. Your job is to design the next
generation **of this**, using headroom that has just become available — not to start over.
Work that cannot be reconciled with the thesis below is not usable, however beautiful.

## The thesis you are extending (locked 2026-07-11, do not overturn)

**Stop building a dashboard. Build a presence.** A wall display earns nothing by showing
more. It earns its place by knowing what deserves attention right now — and by disappearing
when nothing does.

**There is no navigation. There are no pages, tabs, cards, grids or widgets.** The display
has exactly one job at any moment, and presence decides what that job is. Four modes:

| Mode | Trigger | Behaviour |
|---|---|---|
| **0 · Architecture** | Nobody near | The screen becomes part of the wall. Slow photography, weather-tinted light, a dim clock, the occasional earned memory. Almost no text. |
| **1 · Glance** | Motion, <2s | Answer one question — "what do I need to know right now?" One hero, never a grid. |
| **2 · Lean-in** | Dwell 30s+ | Reveal depth: agenda, tonight's meal, a camera preview. The next three things, never everything. |
| **3 · Conversation** | Voice | Full attention, direct answers, then gracefully recede back down the ladder. |

The screen stays calm ~95% of the time by letting almost everything lose.

### Three laws — non-negotiable

1. **Stillness at rest.** No looping animation on any resting surface. *(See "the currency
   has changed" below — this law survives, its justification does not.)*
2. **Borrowed light, not chrome.** Weather lights the whole surface via a full-bleed tint and
   a living accent. **There is no weather icon.** The wall renders the condition.
3. **Silence is the default.** Most of the time the surface says almost nothing. Restraint is
   the aesthetic; every element must earn its place at 4 metres.

## What has changed: the currency, not the law

Until now the hardware was a Raspberry Pi 4, and "stillness at rest" was justified on cost —
any continuous animation re-composited the whole 1080p page at 60fps and pinned a GPU core.
That cost is gone.

**The law stays. Its currency changes from watts to attention.**

Read it now as **0% *perceptible* motion at rest.** The question is no longer "can the GPU
afford this?" but "would this pull the eye of someone who is not looking at it?" A drifting
gradient that costs nothing and is invisible at 4m is now permitted. Anything that reads as
*motion* to someone carrying a kettle is still forbidden, at any frame rate.

This distinction is the single most important thing in this brief. The hardware was
accidentally enforcing the design discipline; do not mistake its removal for permission.

Specifically still forbidden, because they pull the eye by design:
particles, floating dust, fireflies, shooting stars, sparkles, anything that twinkles,
anything that loops visibly, anything a passer-by would notice moving.

## Hardware and surface — get these right

- **Panel: 32", 1920×1080, landscape, viewed at 3–4 metres.** Not 4K. All sizes are
  **CSS px = kiosk px, 1:1** — nothing scales responsively. Design for the wall.
- Compute: AMD Ryzen mini PC, 16GB RAM, Radeon Vega, hardware-accelerated rendering.
- **WebGL2 is the safe target.** WebGPU on Mesa/Vega is still inconsistent — you may propose
  it, but anything load-bearing must degrade to WebGL2.
- Chromium in kiosk mode, Node/Express server, Home Assistant backend.
- **There is no pointer, no touch, no keyboard.** Voice is the only input surface. Never
  propose an interaction that requires reaching the screen.

### Constraints that have NOT lifted

- **The page runs for weeks without a reload.** Slow leaks are the primary failure mode — a
  past audit found 709 zombie animation wrappers and 230k detached DOM nodes. Any scene graph,
  particle system, shader or timeline you propose must have explicit, symmetric teardown on
  every path. Design the disposal, not just the effect.
- **The panel is physically dark 21:00–05:00.** "Night" as a design state really means dusk
  (~17:00–21:00) and pre-dawn. Do not build an elaborate 3am experience nobody will see.
- **Text must clear WCAG AA at worst case over live photography** — there is an automated
  contrast gate. Assume the backdrop is an arbitrary photo, not a controlled colour.
- Upstream latency is unchanged: Home Assistant, photos and voice synthesis all live on other
  machines on the LAN.

## What is already shipped — design the delta, not a duplicate

Do not present these as new ideas. Say what you would do **differently or better**:

- **Weather-driven full-surface tint**, season and sun-altitude ramps, atmospheric textures
  (rain, fog, heat haze), a living accent colour that follows the weather.
- **Night sky treatment**, sun-altitude dim curve on the clock.
- **Cinematic camera events** — glass overlay, background recession, warm crown on arrival.
- **A scored attention queue** with decay, cooldowns and expiry, feeding a single focus hero.
- **Immich photography** as the ambient substrate, with "on this day" memories and captions
  that name people and their relationship to the household.
- **A rationed delight/personality registry** — humour is already budgeted and rare.
- **Voice concierge** with a house knowledge base.

The interesting question is not "what could an ambient display do?" It is **"what does this
one still get wrong, and what is now possible that wasn't?"**

## Emotional goal

The display should create emotion, quietly.

Morning hopeful · rain cosy · storms dramatic · evenings warm · night peaceful.

Drama is permitted in **response to a real event** — a storm arriving, someone at the door,
a birthday. It is never permitted as ambience. The difference between cinematic and
exhausting is that cinema ends.

## Aesthetic direction

Premium, calm, organic, natural, timeless. Nothing flashy. Every animation has purpose.

**Draw from:** Apple Vision Pro's spatial materials · Nothing OS's restraint · Studio Ghibli
and Pixar for *light and weather as emotion* · luxury hotel lobby displays · Japanese ambient
design · architectural lighting · gallery-scale digital art installations.

**Reject:** cyberpunk · gamer aesthetics · RGB · dashboard maximalism · Material density
defaults (tuned for a phone at 30cm, wrong for a wall at 4m) · anything that needs
onboarding.

### Materials

Glass, frosted acrylic, layered depth, soft shadows, thin highlights, dynamic blur, soft
gradients. No flat rectangles. No hard borders. Panels have mass; animations obey inertia;
nothing snaps; nothing instantly appears.

**Newly affordable:** blur radius was previously capped at 18px purely on cost, and two
surfaces disable backdrop blur entirely for the same reason. Real depth is now available —
use it with restraint, not because you can.

### Typography and colour

There is an existing token system you must extend rather than replace: one ink at a fixed
alpha ladder, text never pure white, only the accent and warm hue move. If you propose
changing it, argue the case explicitly — do not silently diverge.

## Your task

Rethink the interface, working from the presence ladder outward. Challenge every assumption
inherited from smartphones, tablets and web dashboards. If something exists only because
"that's how dashboards are designed," replace it with something more natural, ambient and
architectural. Design as if this were a premium installation in a luxury home in 2030.

**Deliver, in priority order:**

1. **The one big idea** — the reframe that makes this feel different, in a paragraph.
2. **The four presence modes**, designed as states of one continuous surface: what the wall
   looks like in each, and how it moves between them. These replace "screen layouts" — there
   are no screens.
3. **Light and weather as one system** — how condition, sun position, season and time compose
   into a single surface treatment. This is the heart of the product.
4. **Motion language** — the physics: mass, inertia, settle. Include the rest state and how
   you guarantee stillness.
5. **Material and depth system**, expressed as tokens that extend the existing ladder.
6. **The event vocabulary** — how a doorbell, an arrival, a storm and a birthday each
   announce themselves and recede, without any of them becoming routine.
7. **Concept art descriptions** for: Mode 0 at three different weathers, Mode 1, Mode 2, and
   one event moment.
8. **Technology recommendations** — WebGL2 first, what you would render on the GPU and why,
   with the teardown story for each.
9. **What is now possible that a Raspberry Pi made impossible** — be specific and honest;
   separate genuine capability from "more of the same, faster."

For every proposal, state which of the three laws it tests and how it stays within them.
Where you believe a law should bend, say so explicitly and argue it — do not quietly ignore it.

## The bar

When someone walks into the kitchen, they should stop. Not because something moved — because
the room looks different, and it takes them a second to work out that the window is a screen.
