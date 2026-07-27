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

Only four keys are read. Everything else is ignored, so Obsidian Bases and
Dataview properties can live in the same frontmatter freely.

| Key | Type | Meaning |
|---|---|---|
| `title` | string | What the note is called. Falls back to the filename. |
| `tags` | list | Retrieval keywords. `#trip` and `Trip` both normalise to `trip`. |
| `kind` | string | Free-form label. Carried through, not currently scored. |
| `private` | boolean | **`true` excludes the note from the index entirely.** |

Both YAML list forms work — `tags: [a, b]` and the indented `- a` block that
Obsidian's property editor writes.

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
