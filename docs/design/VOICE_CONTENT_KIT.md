# Voice & Content Kit

Copy the household writes for the house, in the house's voice. Everything here is
**draft content with placeholder names** (Greg, Sam, "the dog") — adopt lines
deliberately, swap in real names/dates/photos, and leave out anything that doesn't
feel true. Nothing in this file changes the dashboard until it's copied into
`data/memories/seed.json` (memories) or `src/js/services/delight.js` (delight lines).

The one voice authority is `src/js/core/personality.js`. Every line below was
written to pass through its `phrase()` normaliser **unchanged** — if a line would
be edited by the house's own manners, it doesn't belong in this kit.

---

## 1. Voice in one page

The house's defining trait is **restraint**. Silence is the default setting; the
loudest line is still quiet. When it does speak: short, plain, warm underneath.

### The register (match these — they are the canon)

> Rain is likely in about 15 min.
> Bins go out tonight.
> On this day — Tasmania.
> First rain in a while — the garden's grateful.
> Welcome home, Greg!
> Power's back — the house is up and waiting.
> Welcome back, Greg — the house missed you.
> Happy birthday, Greg.
> It's Christmas Eve.

### Do

- **State the fact, gently.** "Bins go out tonight." Not a request, not a push.
- **One thought per line.** If you need a second sentence, question the first.
- **Warmth through observation, not enthusiasm.** "The garden's grateful," never
  "Yay, rain!!"
- **Use the em dash for the turn.** Fact — small warmth. It's the house's
  signature cadence: "Power's back — the house is up and waiting."
- **Name people plainly.** "Welcome home, Greg." First names only.
- **End with a full stop.** One "!" at most across the whole registry, and rarely.

### Don't (the normaliser strips these — write as if they don't exist)

| Never open with | Never end with |
|---|---|
| "Sorry…" / "Apologies…" / "Oops…" | "…again" |
| "I noticed…" / "I see that…" | "…like I said" / "…as I said" |
| "Reminder…" / "Just a quick reminder…" | "…don't forget" |
| "Don't forget…" / "FYI…" / "Heads up…" / "Hey there…" | |

Also out of register everywhere: nagging, guilt, exclamation spam, emoji in the
line text (icons live in the `icon` field), corporate cheer ("We're excited to…"),
and narrating what the house is doing ("Checking the weather…").

### Length caps (hard — over-length lines get trimmed mid-thought)

| Kind | Max characters |
|---|---|
| Celebration (delight `line`) | **90** |
| Memory caption (`On this day — {title}.`) | **110** |
| Arrival greeting | **240** |
| Everything else (insight/predictive) | **140** |

A good line is usually well under half its cap.

---

## 2. Memory entries — authoring guide

Memories live in `data/memories/seed.json` (on the Pi, gitignored — it's the
household's, not the repo's). The house surfaces **at most one memory a day**,
only when the day actually fits it (an anniversary, or the right season/weather),
and never repeats one inside its cooldown. Most days it stays silent. That rarity
is the point — don't author fifty entries hoping for daily nostalgia; author the
ones that would genuinely stop you mid-hallway.

### The schema

```json
{
  "id": "kebab-id",
  "kind": "trip | first | pet | milestone | everyday",
  "title": "reads as: On this day — {title}.",
  "date": "YYYY-MM-DD",
  "tags": ["winter", "grey", "wistful", "weekend"],
  "photos": ["folder/file.jpg"],
  "sensitivity": "normal | tender",
  "cooldownMonths": 6
}
```

- Use **either** `date` (a one-off — matches every year on that day) **or**
  `"recurring": { "month": 11, "day": 3 }` (month is 1-based).
- `cooldownMonths`: 6 is the default. 12 for anything that should stay rare.

### The title IS the caption

A normal entry surfaces as exactly **`On this day — {title}.`** — nothing else.
So write the title to sing inside that frame, and keep the whole caption under
110 characters (title under ~95). Read every title aloud as
"On this day — ___." before committing it. Lowercase-start titles read most
naturally after the dash ("the cold week", not "The Cold Week"), except proper
nouns.

### Tags — what actually matters (Brisbane = Southern Hemisphere)

Tags decide *which* day an entry fits. Only these vocabularies score:

- **Season** — `summer` (Dec–Feb) · `autumn` (Mar–May) · `winter` (Jun–Aug) ·
  `spring` (Sep–Nov). Tag the season the memory *happened in*, local seasons.
  Tasmania in July is `winter`. Christmas at the beach is `summer`.
- **Weather-mood** — `wistful` (surfaces on rainy days) · `grey` (cloud/fog) ·
  `bright` (clear/sunny). Match the *feel* of the memory to the sky it should
  return under.
- **Day-character** — `weekend`, `weekday`, `holiday` are the three the house can
  actually match. Other tags (`joyful`, `milestone`) are harmless but inert —
  fine as human notes, they just don't affect timing.

An anniversary date clears the surfacing bar on its own; tags are how an
*undated-feeling* memory earns an ordinary afternoon that suits it.

### Example entries (placeholders throughout — replace names, dates, photo paths)

```json
[
  {
    "id": "tasmania-cold-week",
    "kind": "trip",
    "title": "Tasmania — the cold week",
    "date": "2021-07-14",
    "tags": ["winter", "grey", "wistful"],
    "photos": ["trips/tasmania-2021/lake-morning.jpg"],
    "sensitivity": "normal",
    "cooldownMonths": 6
  },
  {
    "id": "noosa-first-morning",
    "kind": "trip",
    "title": "that first morning at Noosa",
    "date": "2023-01-08",
    "tags": ["summer", "bright", "weekend"],
    "photos": ["trips/noosa-2023/beach-sunrise.jpg"],
    "sensitivity": "normal",
    "cooldownMonths": 6
  },
  {
    "id": "sam-first-day-school",
    "kind": "first",
    "title": "Sam's first day of school",
    "date": "2019-01-29",
    "tags": ["summer", "bright", "weekday"],
    "photos": ["family/sam-school-gate.jpg"],
    "sensitivity": "normal",
    "cooldownMonths": 12
  },
  {
    "id": "house-keys-day",
    "kind": "milestone",
    "title": "the day we got the keys",
    "date": "2015-11-03",
    "tags": ["spring", "bright"],
    "photos": ["house/front-door-keys.jpg"],
    "sensitivity": "normal",
    "cooldownMonths": 12
  },
  {
    "id": "wedding-anniversary",
    "kind": "milestone",
    "title": "Greg and Sam, married in the autumn",
    "recurring": { "month": 4, "day": 18 },
    "tags": ["autumn"],
    "photos": ["family/wedding-confetti.jpg"],
    "sensitivity": "normal",
    "cooldownMonths": 11
  },
  {
    "id": "dog-first-beach-run",
    "kind": "pet",
    "title": "the dog's first beach run",
    "date": "2020-09-12",
    "tags": ["spring", "bright", "weekend", "joyful"],
    "photos": ["pets/dog-beach-zoomies.jpg"],
    "sensitivity": "normal",
    "cooldownMonths": 6
  },
  {
    "id": "rainy-sunday-pancakes",
    "kind": "everyday",
    "title": "pancakes and rain on a slow Sunday",
    "date": "2022-06-19",
    "tags": ["winter", "wistful", "weekend"],
    "photos": ["everyday/kitchen-pancakes.jpg"],
    "sensitivity": "normal",
    "cooldownMonths": 6
  },
  {
    "id": "jacaranda-out-front",
    "kind": "everyday",
    "title": "the jacaranda in full bloom out front",
    "recurring": { "month": 11, "day": 5 },
    "tags": ["spring", "bright"],
    "photos": ["house/jacaranda-street.jpg"],
    "sensitivity": "normal",
    "cooldownMonths": 11
  },
  {
    "id": "old-dog-goodbye",
    "kind": "pet",
    "date": "2018-07-22",
    "title": "the old dog",
    "tags": ["winter", "grey", "wistful"],
    "photos": ["pets/old-dog-favourite-spot.jpg"],
    "sensitivity": "tender",
    "cooldownMonths": 12
  },
  {
    "id": "nanna",
    "kind": "milestone",
    "recurring": { "month": 8, "day": 30 },
    "title": "Nanna",
    "tags": ["winter", "grey", "wistful"],
    "photos": ["family/nanna-verandah.jpg"],
    "sensitivity": "tender",
    "cooldownMonths": 12
  }
]
```

Caption check (all under 110): "On this day — Tasmania — the cold week." ·
"On this day — that first morning at Noosa." · "On this day — Sam's first day of
school." · "On this day — the day we got the keys." · "On this day — Greg and
Sam, married in the autumn." · "On this day — the dog's first beach run." ·
"On this day — pancakes and rain on a slow Sunday." · "On this day — the
jacaranda in full bloom out front."

### How to add a tender entry, gently

A tender entry (`"sensitivity": "tender"`) is for a lost pet or a grief anchor.
The house treats it differently, by design, and **there is no caption to write**:

- It surfaces **wordless** — only on the quiet ambient screensaver, never on the
  awake dashboard. The photo fills the frame, held long, with a faint candle mark
  in the corner. No text. The house does not narrate grief.
- Your craft is entirely in **photo choice** (one photo that holds the whole
  feeling — their spot on the verandah, not the vet's waiting room), **tags**
  (usually `winter`, `grey`, `wistful` — it returns on soft, quiet days), and a
  **long cooldown** (`12` months, so it comes back about once a year, around its
  anniversary or on the kind of afternoon that suits remembering).
- The `title` is still required for the entry's identity — keep it to just the
  name. It is never shown.
- Add tender entries **together, and only when ready**. If anyone in the house
  isn't ready to be surprised by that photo on a grey Tuesday, wait. It can
  always be added later; it's much worse to need it removed.

---

## 3. Delight copy set

Delight moments (`src/js/services/delight.js`) fire **a few times a year at
most** — each trigger is budgeted so it cannot fire twice for the same occasion.
Each has `{ icon, title, line }`; the `line` passes through `phrase()` with the
90-character celebration cap. Below: the current line, plus voice-matched
alternates so the house can be re-worded season to season without drifting off
register. Pick **one** line per trigger at a time — the registry holds a single
`line`, not a rotation.

### power-restored 🔌 — "Back on"

- *Current:* Power's back — the house is up and waiting.
- Power's back. Everything came up on its own.
- The lights are back — all quiet and accounted for.
- Back on. The house picked up where it left off.

### home-after-away 🏡 — "Home again"

The name is filled in by the runtime (`ctx.awayName`); write lines with `${name}`
where it goes, and keep a no-name fallback in the same shape.

- *Current:* Welcome back, Greg — the house missed you.
- Welcome back, Greg — the house kept everything warm.
- Welcome back, Greg. It wasn't the same without you.
- Home at last, Greg — everything's just as you left it.

### birthday-morning 🎂 — "{Name}'s birthday"

Name comes from `ctx.birthdayName` — the household needs to confirm where
birthdays are configured before this fires for real people.

- *Current:* Happy birthday, Greg.
- Happy birthday, Greg — the day's all yours.
- It's your day, Greg. Happy birthday.

### first-rain-after-dry 🌧️ — "First rain"

- *Current:* First rain in a while — the garden's grateful.
- Rain at last. The garden's been waiting.
- The dry spell just broke — listen to that.

### christmas-eve 🎄 — "Christmas Eve"

- *Current:* It's Christmas Eve.
- Christmas Eve — the quiet before the morning.
- It's Christmas Eve. The house is ready.

### dst-sunrise 🌅 — "Longer days"

**Inert in Queensland** (no daylight saving) — alternates kept only in case the
household ever moves.

- *Current:* The clocks changed — longer evenings from here.
- An hour shifted overnight — the evenings stretch out now.

### New-trigger PROPOSALS (flagged — not in the registry; household to approve)

Both ride signals the house plainly already has (the date). No new sensors.

1. **`winter-solstice`** — *signal: date only (June 21–22).*
   Icon 🌗, title "Shortest day".
   Line: **"Shortest day of the year — brighter from here."** (49 chars)
   Alternate: "The shortest day. The light turns around tomorrow." (50 chars)
2. **`new-year-morning`** — *signal: date + the existing morning window (Jan 1,
   4am–11am).* Icon 🎆, title "New year".
   Line: **"Morning — and a brand-new year with it."** (39 chars)
   Alternate: "The first morning of the year. It's a good one to be home for." (63 chars)

---

## 4. Arrival greeting variants

The awake, full-glass welcome (arrival card, 240-char cap — though the best ones
are a tenth of that). Plain and warm; the name is the warmth. Swap placeholder
names for real presence-mapped ones.

1. Welcome home, Greg.
2. Welcome home, Sam — the house is warm.
3. Good to have you back, Greg.
4. Welcome home, Greg. The evening's sorted itself out.
5. Evening, Sam. Welcome home.
6. Welcome home — the dog beat you to the couch.
7. Welcome home, Greg — dinner's the only decision left.
8. You're home — the best part of the house's day.

**Warm variant** (after a ≥2-day absence, rides the `home-after-away` budget —
agenda drops away, crown warms):

9. Welcome back, Greg — the house missed you.
10. Welcome back, Sam. It's been quiet without you.

---

## Needs real household input before any of this goes live

- **Names**: Greg / Sam / "the dog" are placeholders — map to real presence
  entities (`person.*`) and the arrival card's name source.
- **Birthdays**: confirm where `ctx.birthdayName` is configured, and whose
  birthdays are in it, before adopting birthday lines.
- **Memory entries**: every date, title, and story above is invented — the
  household authors the real ones directly into the Pi's
  `data/memories/seed.json` (gitignored; currently empty).
- **Photo paths**: placeholders — resolve against the real Immich library
  (authored-entry Immich album resolution is a known open follow-up).
- **Tender entries**: require explicit, unhurried agreement from everyone in the
  house — see the "gently" note above.
- **New triggers** (`winter-solstice`, `new-year-morning`): proposals only;
  approve wording and whether they're wanted at all before any code is written.
