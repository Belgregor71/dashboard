# The House Knowledge Base

The dashboard can answer spoken questions about *this house* from notes the
household writes in [Obsidian](https://obsidian.md). This document is the
authority on how those notes are read.

## Why a vault, and why it is not "Obsidian on the Pi"

An Obsidian vault is a folder of markdown files with YAML frontmatter. Obsidian
is the **editor**; it is not a database and it is not a server. So the Pi reads
the folder directly — exactly as it already reads `data/memories/*.json` — and
Obsidian never runs on it.

Two approaches were considered and rejected:

- **The Local REST API plugin.** It only serves while the desktop app is open,
  so it would put an Electron app in the dependency chain of a 24/7 kiosk.
- **Running Obsidian on the Pi.** An official ARM64 AppImage exists, but an
  Electron editor alongside the kiosk Chromium contradicts the GPU and memory
  discipline in `CLAUDE.md`.

What this lane fixes: before it, `server/routes/voice.js` instructed the
concierge to say *"I don't know anything about this specific house"* — and there
was nothing it could have said instead, because the concierge had no knowledge
base at all.

## Scope

This is **additive and read-only**. It does not replace, migrate, or touch:

- `data/memories/` (Phase 9) and the Memory Studio portal
- `data/recipe-cache/` and the Recipes portal
- the copy pools in `src/js/config/alertLines.js`, `services/occasions.js`,
  `services/delight.js`

The vault's write path is Obsidian itself, so there is exactly one authority for
note content and nothing in the dashboard can conflict with it.

## Note conventions

Put notes anywhere under `data/vault/`. Subfolders are walked recursively and
the vault-relative path is the note's id (`trips/tasmania-2019.md` →
`trips/tasmania-2019`).

```markdown
---
title: Hot water system
tags: [house, maintenance]
kind: system
private: false
---
The tank is a Rheem 315L in the garage, installed March 2021. The isolation
valve is behind the laundry door. Plumber is Dave at Southside Plumbing.
```

Only seven keys are read. Everything else is ignored, so Obsidian Bases and
Dataview properties can live in the same frontmatter freely.

| Key | Type | Meaning |
|---|---|---|
| `title` | string | What the note is called. Falls back to the filename. |
| `tags` | list | Retrieval keywords. `#trip` and `Trip` both normalise to `trip`. Syntax rules below. |
| `kind` | string | Free-form label. Carried through, not currently scored. |
| `private` | boolean | **`true` excludes the note from the index entirely.** |
| `date` | `YYYY-MM-DD` | The day this note is *about*. Opens a span — see below. |
| `until` | `YYYY-MM-DD` | The last day of that span, **inclusive**. Omit for a single day. |
| `label` | string | The short name the glass says. **Write it without a year.** |

## The date grain — what puts a note under a photograph

Before this, every date in the vault was prose: `trips/thailand-2026.md` says
*"29 March to 12 April 2026"* and nothing could read it. `date` + `until` make
that span machine-readable, and `label` gives it something short enough to
print.

A photograph whose local date falls inside a labelled span is captioned by the
occasion instead of by a bare number:

```
Playa del Carmen · 2017          →   Playa del Carmen · Mexico 2017
```

```markdown
---
title: Mexico 2017 - Jeffrey Sweet's wedding at Playa del Carmen
tags: [trip, travel, mexico, playa-del-carmen, wedding]
kind: trip
date: 2017-08-12
until: 2017-08-21
label: Mexico
---
```

Four rules, each of which someone will otherwise get wrong once:

- **`label` carries no year.** The year is appended from the *photograph*, not
  from the note, so the two can never disagree and a trip across New Year
  captions each photo with its own year. Writing `label: Mexico 2017` puts the
  year in twice.
- **`until` is inclusive.** "29 March to 12 April" means the 12th is a day of
  the trip. An `until` earlier than `date` collapses to a single day rather
  than silently matching nothing.
- **The shortest span wins** where two overlap. `thailand-2026` (29 Mar – 12
  Apr) contains `thailand-2026-chiang-mai` (5 – 8 Apr), so a photo from the 6th
  is captioned by Chiang Mai — the more specific note is the one saying
  something the photograph does not already say. Ties break on the note id, so
  the answer is stable across a reindex; a caption that changed every ten
  minutes would read as a fault.
- **A note with `date` but no `label` claims nothing.** It has a span (useful on
  its own) but nothing to print, so the caption is left as it was.

Dates are matched as **local calendar days**, never UTC. Thailand is UTC+7 and a
9am Bangkok photograph converted to UTC lands on the previous day — which would
drop every morning of a trip out of its own span, at both ends.

The reach is not uniform and is worth knowing before authoring: of 100 live
on-this-day assets sampled 2026-08-15, **62 carried a city and only 4 carried a
named face** — but **24 fell inside a single trip span**. Dates are the widest
net the vault has.

Both YAML list forms work — `tags: [a, b]` and the indented `- a` block that
Obsidian's property editor writes.

### Tag syntax — Obsidian is stricter than this parser

Two rules, both of them Obsidian's rather than ours:

- **One word per tag, hyphenated if compound** — `chiang-mai`, never
  `chiang mai`. An Obsidian tag cannot contain a space.
- **Never a bare number** — `2026` is not a valid Obsidian tag. Put the year in
  the `title`, which scores higher than a tag anyway (5 against 3), so the tag
  was buying nothing.

Neither rule costs retrieval anything. Hyphenating is free because `tokenize()`
splits the *query* on non-alphanumerics: "chiang mai" becomes `chiang` + `mai`,
and both substring-match inside `chiang-mai` for the identical score.

**These mistakes are invisible to the test suite, and that is the point worth
remembering.** `parseScalar()` splits `[a, b]` on commas only, and `scoreNote()`
substring-matches `tags.join(" ")` — so a tag with a space in it retrieves
perfectly well here. This was live (2026-07-28): fifteen trip notes shipped
tagged `chiang mai` and `2026`, every retrieval probe passed, and the breakage
showed up only in the editor. Retrieval tests can never catch this class, so
check tag syntax by eye.

The existing notes are the reference — they have used single-word tags with
hyphenated compounds (`in-laws`, `dee-lewis`) from the start. Read a couple of
`tags:` lines before authoring new ones.

The **body is what gets quoted** to the model, so write it as prose a person
would say out loud. `[[Wikilinks]]` are not resolved; they are passed through as
literal text, which reads fine in a sentence but is not a lookup.

### How matching works, and what it can't do

Query terms are matched as **substrings**, with one stemming step: a trailing
`s` is stripped from query words of 4+ characters, so "dogs" finds a note
tagged `dog` and "teddys" finds a note titled `Teddy`. Short words are left
alone so "gas" can't match "garage".

There is **no synonym handling**. A note saying *born* will not answer a
question asking *birthday*; a note saying *fixed* will not answer *repaired*.
Write the words people actually say, and put the obvious alternatives in `tags`:

```markdown
Born 20 May 2022, so his birthday is 20 May.
```

Both live misses that prompted this were of that shape — worth a moment's
thought per note, because a miss is silent: the house just says it doesn't know.

## Privacy — read this before writing anything sensitive

Retrieved note text is **sent to Anthropic** on the concierge's Claude leg.

`private: true` is the opt-out, and it is enforced in `buildIndex()`: a private
note is dropped as it is read, so it never enters the index and cannot be
retrieved by any caller. `tests/vault.spec.js` pins this as a regression test.

But **the default is exposure**, and that was a deliberate decision
(2026-07-27), not an oversight: this vault is scoped to household logistics —
bin nights, the plumber, where the good salt lives — where convenience wins and
nothing in it would matter upstream. `data/memories/` was deliberately kept
on-device because grief and nostalgia are a different category; the vault is
not that.

**The condition that reverses this decision:** the moment the vault holds
credentials, medical details, or financial records, invert the convention so
only `share: true` notes are indexed. That is a small change to `buildIndex()`
plus its test — cheap now, tedious once there are a hundred notes to re-tag.

## Bounds

All in `server/services/vaultIndex.js`. These exist because this runs for weeks
on a Pi and feeds a metered API:

| Bound | Value | Protects |
|---|---|---|
| `MAX_FILES` | 500 | the recursive walk |
| `MAX_FILE_BYTES` | 64 KB | any one note |
| `MAX_NOTES_RETURNED` | 3 | notes quoted per question |
| `MAX_CONTEXT_CHARS` | 4000 | total prompt context, split evenly per note |
| `SCORE_FLOOR` | 2 | one matched non-stopword term |

The index rebuilds every 10 minutes on an init-once interval, with an mtime
check — an unchanged vault costs one `stat` per file and zero reads.

`SCORE_FLOOR` is tuned toward **recall**. A live probe of "who is the plumber"
against a note whose body named the plumber returned nothing under a stricter
floor: the house answering "I don't know" to a question it had written down is
the failure that makes this lane worthless. Over-retrieval is cheap by
comparison — the prompt tells the model to ignore notes that don't cover the
question, and only the top 3 are quoted.

## Sync

The vault is a **separate private git repo cloned into `data/vault/`**.
`.gitignore` lists `data/vault/` explicitly (it has no blanket `data/` rule), so
the nested clone never appears as a stray gitlink in the dashboard repo.

On the Pi, `dashboard-deploy.service` pulls it alongside the dashboard:

```sh
git -C /home/dashboard/dashboard/data/vault pull --ff-only
```

This reuses the pull-based deploy already in place rather than adding a daemon
(Syncthing, Obsidian's headless sync client) to a 24/7 kiosk. The trade-off is
that you commit to publish — a note is not on the glass until it is pushed.

`GET /api/vault/status` returns `{ notes, indexedAt }` and is the signal for
"did the vault actually reach the Pi". It is LAN-safe because it carries counts
only, never content.

## Routes

| Route | Gate | Purpose |
|---|---|---|
| `GET /api/vault/search?q=` | loopback only | note content — the kiosk is the only legitimate caller |
| `GET /api/vault/status` | LAN-safe | counts only, no content |

Both are mounted only when `VAULT_ENABLED=1`.

## Enabling and rolling back

Set `VAULT_ENABLED=1` in the Pi's `.env` and restart. Unset it to roll back:
the routes are not mounted, the index is never built, no vault I/O happens, and
`buildConverseSystem()` returns the pre-vault prompt byte for byte — pinned by
a test in `tests/vault.spec.js`.
