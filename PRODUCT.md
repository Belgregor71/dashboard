# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

- **Primary: the household.** Everyone who lives in the house, glancing at the wall from 3–4 m
  while doing something else: hands busy, passing through, not studying the screen. Nobody
  touches it. There is no touchscreen, keyboard or mouse, and the only input is voice.
- **Secondary: the owner**, who builds, deploys and operates the wall, and whose eye on the
  live display is the final sign-off for any change.
- **Incidental:** visitors at the door (the doorbell lane) and the dogs (the dog popups). Neither
  is a design target in its own right.

## Product Purpose

A 24/7 ambient household display on a 32" landscape screen (1920×1080) in the main living
space. It shows the house what it needs to know about the day: weather, calendar, meals, bins,
commute, media, arrivals, cameras, and "on this day" photographs. It also speaks when something
is worth saying, and answers when spoken to.

Success is measured at the glance: **does this make the next glance more useful, calmer, or more
delightful?** A change succeeds only once it is verified on the live wall, not when the tests go
green.

## Positioning

An ambient wall that renders the day itself:

- **one time spine instead of panels or cards.** Past, now and ahead sit on one continuous axis,
  and "on this day" memories are the same axis scrolled back by years;
- **motion only for causes the room can see**: the sun, the weather, an arrival, the track. The
  passage of time and internal state are not causes;
- **a house with its own character** that speaks rarely, states facts first and never claims an
  action that did not happen;
- **voice instead of touch.**

Authorities: `docs/design/BRIEF-AMBIENT-2030.md` (the day as the surface),
`docs/design/DESIGN_SYSTEM.md` §0 (the three laws), `docs/design/CHARACTER.md` (who speaks),
`docs/design/VOICE.md` (how it punctuates).

## Operating Context

- Runs unattended on a GMKtec G11 mini PC (Debian 13, X11, Chromium kiosk) for weeks without a
  reload. Slow leaks are the main way it fails, so every per-event path needs symmetric teardown.
- Viewed across a room in every light: bright daylight over a real photograph through to the
  night screensaver with its sun-altitude dim curve.
- Integrations: Home Assistant (presence, sensors, cameras, bins, Sonos), Immich photos, Plex,
  calendars (including voice-write to the iCloud "Home" calendar), weather and radar, and a local
  speech pipeline (STT, Kokoro TTS, and the cast voices through a PC-side server).
- Deploys are pull-based from `origin/main`. Pushing to main is shipping to the live wall.

## Capabilities and Constraints

- **One frontend, `src/v3/`**, on vanilla JS and Vite, with `src/js/` as its runtime library.
  Node/Express backend. Fixed 1920×1080 canvas, 1:1 CSS px, designed for the wall and not
  responsive.
- **New behaviour ships behind a default-off flag** in `src/js/config.js`, and the flag-off build
  stays behaviourally identical. Flipping the flag off is the rollback path, and there is no
  other.
- **"Silence is the default."** It governs content: a faster box is not a reason for the house to
  say more.
- **CSP enforced on the live box.** External assets must be allowed by it or they go blank.
- **The repo is public.** Nothing house-identifying (addresses, precise coordinates, the house
  plan image, the cast script or clone audio, household-identifying copy) goes in a tracked
  file. `src/js/config.js` is also shipped in the public bundle.
- Copy is Australian English, with no exclamation marks, one observed beat of dry wit at most,
  never at a person's expense (`VOICE.md`).

## Brand Commitments

- **The house** is the product's persona. `CHARACTER.md` is the origin document and `VOICE.md`
  is downstream of it. The cast (`v3CastVoice`) replaces the speaking voice when on, and stands
  down on Anzac Day and Remembrance Day. Its script and persona are private in `data/cast/` and
  never enter the repo.
- Rules that outlive any character, enforced in code: facts are never changed, an unknown person
  at the door is stated plainly first, and no unperformed action is claimed.
- The established visual system lives in `docs/design/DESIGN_SYSTEM.md` and its token sources.
  This file records no visual decisions.

## Evidence on Hand

- Real household photographs come from Immich at runtime; there is no "bad photo" quality signal
  to filter on.
- Design studies are in `docs/design/*.html` and `docs/design/design_handoff_homeos_home/`.
- The house plan illustration exists only on the G11 (`data/house-plan/`), never in the repo.
- Specs use invented lines only. Never fabricate household data, people or events in tracked
  files.

## Product Principles

1. **The day is the interface.** Place things by when they are, not by what kind of thing they
   are.
2. **Calm by default, alive for a reason.** Motion and speech need a cause the room can name.
3. **Truth over charm.** A joke never changes a fact, and the house is honest about what it
   doesn't know.
4. **Glanceable from across the room.** If it needs studying, it has failed.
5. **Reversible always.** Every change can be turned off on the live wall without a rebuild.

## Accessibility & Inclusion

- Legible at 3–4 m. Keep a plain corner clock for when the reading glasses are in another room.
- Text contrast is measured against the real photograph behind it, not a flat background.
- No pointer or touch affordances. Voice is the only input, and what is spoken must agree with
  what is shown.
