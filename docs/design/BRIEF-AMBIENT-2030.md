# Design brief v2 — the day, rendered

*Supersedes v1. Read the note on why before anything else.*

## Why there is a v2

v1 produced two responses, and neither answered the question.

One was a single strong idea — *promote the sun to a physical object in the render; relight
the photograph per-pixel; weather becomes a medium the light passes through rather than a
colour wash.* Keep that. It is the best thing in the submission.

The other reverted to a card grid with a weather icon, a news ticker and a **page picker** —
navigation, on a display with no touchscreen, keyboard or mouse.

The fault was the brief's. It declared light "the heart of the product," so light got all the
attention. It spent forty percent of its words on what *not* to do, which produces timid work.
And it never once asked how the house's actual information should be expressed — media,
calendar, meals, bins, commute, people. One response ignored content; the other surrendered to
cards.

**v2 is about content, motion, and time. Light is solved — inherit it and move on.**

## The two decisions that define this brief

### 1. Time is the only organising axis

Not categories. Not panels. Not a grid.

**The surface is the day.** Everything the house knows is placed on one continuous temporal
spine, and "now" is a position within it. Dinner at 6:30, bins at 7:30, a show at 8:00, the
physio appointment twelve hours out, a memory from this date in 2019 — these are not different
*kinds* of thing needing different *kinds* of container. They are all events at coordinates in
time. The only question is how near they are.

Past should feel spent. Now should be lit. Ahead should carry anticipation. Nothing is a card.

The axis extends further than today in both directions, and this is where it gets interesting:
"on this day" photographs from previous years are *the same axis, scrolled back by years*. The
household's memories and its dinner plans live on one continuum.

### 2. The calm law is on trial

> **⚖ VERDICT, 2026-08-01 — the trial is over; this section is now history.**
>
> The hardware moved to the G11 and the law was rewritten. **"0% GPU at rest" is repealed.**
> Motion may be continuous and may live on the resting ambient surface.
>
> The replacement discipline is the one this brief guessed at below: **never move for a reason
> the room can't see.** A cause must be *external to the screen* — the sun, the weather, an
> arrival, the track. The passage of time is explicitly **not** a cause, and neither is internal
> state (a fetch landing, a queue re-scoring); internal state may change, but it may not move.
> Amplitude follows the existing sun-altitude dim curve after dark. The measurable tripwire that
> replaces "verify 0%" is a three-row budget in `DESIGN_SYSTEM.md` §5.4.
>
> **"Silence is the default" survived untouched** — it governs content, not motion, and a faster
> box is not a reason for the house to say more.
>
> Authority is `DESIGN_SYSTEM.md` §0 + §5. Read §0.1 for the evidence (the old law was already
> measurably false in daylight, and the Pi was rendering `rain-heavy` at 2.7 fps).
>
> The reasoning below is preserved because it is *why* the answer came out this way — but it is
> no longer an open question, and a new design response should not re-argue it.

v1 treated "Silence is the default" and "0% motion at rest" as untouchable. In this brief they
are **not**. You may propose replacing them. Motion may be continuous. The surface may live.

But you may not simply ignore them, and here is the reasoning you must engage with:

> This screen is in a kitchen. It is seen a hundred times a day by people who are not trying
> to look at it, who are carrying a kettle or arguing about the dog. The laws exist because
> anything delightful on the first viewing and irritating on the fiftieth is a failure — and
> failure here doesn't mean a bad review, it means the screen gets turned off.

So: **if you take the discipline away, you owe a replacement discipline.** Name it explicitly
and defend it. "It's beautiful" is not a defence. What stops your design becoming wallpaper
you resent? Answer that and the laws are yours to rewrite.

A hypothesis worth testing, if it helps: perhaps the correct rule was never *stillness*, but
*legibility of cause*. Motion that a person can attribute — the light moving because the sun
moved, the surface changing because the track changed — may be endlessly tolerable, while
motion without a visible cause is what grates. If that is right, the constraint isn't "don't
move," it's "never move for a reason the room can't see."

## The synthesis: light *is* time

Do not build these as two systems.

The sun's altitude and azimuth are computed from real coordinates for any minute of the year.
That is simultaneously **the light source** and **a clock**. At 5:52pm the light comes from
low and west; that fact lights the photograph, sets the colour temperature, casts the shadows
— *and tells you what time it is,* without a numeral.

Time drives light. Light expresses time. One variable, one system. The clock becomes a
redundancy rather than a widget, and the wall agrees with the real kitchen windows — which is
the moment someone takes a second to work out that the window is a screen.

## Everything the house knows

v1's central omission. This is the raw material — design for the *whole* of it, not the
weather:

| Domain | What's live |
|---|---|
| **Calendar** | Google, Apple and TripIt feeds; events with time, place, and who |
| **Meals** | Tonight's dinner, the week's menu, full recipes with servings and steps |
| **Media** | Plex (what's playing / what's on tonight), Sonos (track, artist, room, progress), Sonarr/Radarr/Lidarr upcoming releases |
| **Cameras** | Eufy — motion, person, doorbell, live snapshots, per-camera |
| **Home state** | ~200 Home Assistant entities: lights, motion, presence, who is home |
| **Weather** | BOM + Open-Meteo, hourly and 7-day, AQI, UV, wind, rain nowcast ("rain in 14 min") |
| **Getting out** | Commute times with live traffic, leave-by for the next located event, fuel prices |
| **Household ops** | Bin night and which lid, routine-learning aggregates of when things normally happen |
| **Memory** | Immich photo library, "on this day" across years, faces named with their relationship to the household |
| **Voice** | Concierge with a house knowledge base — the only input surface |
| **World** | ABC news headlines |

Every one of these has a *time*. That is the point of decision 1.

## A precondition you should know about: the substrate is uncurated

Measured on the live wall at 07:05 on 31 July 2026. The ambient rotation served, as
full-bleed Mode 0 wallpaper with the clock composited over it, **a screenshot of a car
configurator web page** — browser tabs, a mouse cursor, a list of wheel options and prices.
The Glance view behind the hero was a close-up of a gin bottle. At seven in the morning.

This is not a rendering fault. The photo library contains screenshots, receipts and
documents alongside photographs, and the random pool serves them all equally. It matters
disproportionately here because **the substrate is the product**: no amount of per-pixel
relighting rescues a photograph of a browser window, and the entire "is that a window or a
screen?" effect collapses the moment one appears.

It is being fixed independently of this brief — assume a curated pool of real photographs.
But do not assume it silently. **State what your design needs from the substrate**, because
the requirements are now technical as well as editorial:

- If light has direction and photographs are relit per-pixel, the image must have
  *derivable depth*. A flat screenshot has none. What happens when depth estimation fails?
- What aspect ratios, subject distances and brightness ranges does your composition assume?
  The pool is a family library — vertical phone shots, group photos, landscapes, close-ups.
- Does a photograph ever need to be *rejected at render time*, and on what signal?
- Is there a wrong photograph for a moment — and if so, is that a property of the image, the
  hour, or the household's mood?

A design that specifies its own substrate requirements is buildable. One that assumes
beautiful photographs will simply be there is not.

## The hard problem, stated plainly

The thesis says **one hero, never a grid**. The table above has eleven domains.

Those two facts are in tension, and **resolving that tension is the design work.** Both v1
responses dodged it — one ignored content entirely, the other gave up and drew cards.

Do not dodge it. If your answer is that some information simply doesn't earn a place on a
kitchen wall, say which and why; that is a legitimate and interesting answer. If your answer
is that all of it can coexist on a temporal spine without becoming a list, show how it looks
at 7am on a school day and at 9pm on a Saturday — the two hardest moments.

## Non-negotiable constraints

These are physics and product truth, not aesthetics. Nothing here is on trial.

- **Panel: 32", 1920×1080, landscape, 3–4 metres away.** Not 4K. CSS px = kiosk px, 1:1.
  Nothing scales responsively. Text must be legible at 4m; assume reading glasses are in
  another room.
- **No pointer, no touch, no keyboard.** Voice is the only input. Never propose an interaction
  requiring someone to reach the screen. Presence and dwell are the only other signals.
- **The panel is physically dark 21:00–05:00.** Design "night" as dusk and pre-dawn. Do not
  build a 3am experience nobody will see.
- **The page runs for weeks without a reload.** A past audit found 709 orphaned animation
  wrappers and 230k detached DOM nodes. Every scene, timeline, shader and particle system you
  propose must have symmetric teardown on every exit path. **Design the disposal, not just the
  effect.** A continuously-animated surface makes this harder, not easier — if you argue for
  continuous motion, you own this problem.
- **Text must clear WCAG AA over live photography**, verified automatically. The backdrop is an
  arbitrary photo, not a controlled colour.
- **Hardware:** AMD Ryzen mini PC, 16GB, Radeon Vega, Chromium kiosk. **WebGL2 is the target**
  — WebGPU on Mesa/Vega is inconsistent; anything load-bearing must degrade to WebGL2.
- Home Assistant, photos and voice synthesis live on other machines on the LAN — assume
  latency and occasional absence. Nothing may render an error the wall has to display.

## Already shipped — design the delta

Do not present these as new. Say what you would do **differently**:

weather-driven surface tint, season and sun-altitude ramps, atmospheric textures (rain, fog,
heat haze), living accent colour · night sky, sun-altitude clock dimming · cinematic camera
events with glass overlay and warm crown on arrival · a scored attention queue with decay,
cooldown and expiry feeding a single focus hero · Immich ambient photography with "on this
day" and relationship-aware captions · a rationed personality/delight registry (humour is
already budgeted and rare, in a specific Australian comic register) · voice concierge.

## Deliverables, in priority order

1. **The one big idea** — one paragraph. What makes this feel unlike anything else.
2. **The temporal spine** — how the day is rendered. Its geometry, how "now" is expressed, how
   far it reaches in each direction, and what happens as time passes. This is the centre of the
   brief; give it the most work.
3. **How each domain in the table above lives on that spine** — specifically media, meals,
   calendar, cameras and memory. Not a container per domain; a way of being present that suits
   what each thing *is*. This is the deliverable v1 was missing and is the reason for v2.
4. **Motion language** — the physics of the whole surface. What moves, what causes it, what it
   feels like. Include your position on the calm law and your replacement discipline.
5. **The two hard moments, rendered** — 7am on a school day, 9pm on a Saturday.
6. **Presence behaviour** — how the surface differs when nobody is there, someone passes, and
   someone stays. Modes, not screens.
7. **The event vocabulary** — doorbell, arrival, storm, birthday: how each announces itself and
   recedes without becoming routine.
8. **Concept art descriptions** — the spine at three times of day, one event moment, one memory
   surfacing.
9. **Technology** — WebGL2-first, what runs on the GPU, and the teardown story for each.
10. **What the Pi made impossible** — be honest; separate genuine new capability from "the same,
    faster."

## The bar

Someone walks into the kitchen, and stops.

Not because something moved — because the room looks different, and it takes them a second to
work out that the window is a screen. Then they look again, and realise it is showing them
their own day.
