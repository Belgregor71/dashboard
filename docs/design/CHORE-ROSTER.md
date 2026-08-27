# The Chore Roster

**Shipped 2026-08-27, flag-gated `choreRoster`, default OFF.**
Owner's rules, given verbatim:

> Starting from tonight — alternate nights to feed the dogs starting with Brett
> tonight and then Greg tomorrow night and so on. Red and Green Bin night Brett
> takes the bins out. Red and Yellow Bin nights Greg does.

## Two chores, two different rules

This is the whole design, and the reason it is a module rather than a sentence
somewhere:

| Chore | Alternates by | Turns over | Source |
|---|---|---|---|
| The dogs | **night** | every day, at midnight | date math against a fixed anchor |
| The bins | **colour** | every 7 days | which bins the council is taking |

> ⚠ **They are not the same parity and must never be collapsed.** A dog night
> flips daily; a bin colour flips weekly. They coincide by accident, and the
> accident lasts a fortnight at a time — long enough for an "obvious"
> simplification to look right in every test written in one sitting.

The dog anchor is **2026-08-27 = Brett**. Everything before and after that date
alternates from it, in both directions — `dogFeederOn` is defined for the past
as well, because a briefing regenerated after midnight asks about yesterday.

The bin rule reads the **second** bin. Red is on every collection (see
[`binSchedule.js`](../../server/services/binSchedule.js): the council always
takes Rubbish plus Recycling *or* Garden), so red decides nothing — green means
Brett, yellow means Greg.

## One roster, three readers

`server/services/choreRoster.js` is the only place the rules exist.
`GET /api/chores` is the only way anything reads them:

- **The briefing** — `briefingData` fetches it into `ctx.chores`; `aiBriefing`
  turns it into a `Chores:` line on the prompt. That line names **who** and
  nothing else: the `Bins:` line already states which bins and when, and a model
  handed two ways to say one thing takes both.
- **The fast lane** — `house.chores` in `localIntents`/`localAnswers`, answered
  from the snapshot in ~250 ms. "Whose turn is it to feed the dogs."
- **The conversational lane** — `houseDigest` writes a `chores` line carrying
  tonight's name, the next bin night, **and the alternation rule**, so a model
  asked about Saturday can count rather than guess.

A client-side copy of the date math would be a fourth answer waiting to
disagree with the other three. There isn't one.

## The things that were nearly wrong

- **`days % 2` is negative before the anchor**, and `-1 !== 1`, so a plain
  remainder inverts the whole roster for every past date — silently, on the half
  of the calendar nobody writes a test for. `((n % 2) + 2) % 2` is the fix and
  `tests/chore-roster.spec.js` pins it in both directions.
- **The bins go out the night BEFORE the truck.** Every sentence anyone says
  about a bin night is about that eve, not the collection date, so the route
  names it (`next.eve`) rather than leaving each caller to do the minus-one.
- **"Next" is not "the next row in the list."** After 7 am on collection day the
  truck has been, and calling that morning "next" puts a bin night in the future
  that has already happened. The boundary is *borrowed* from `binSchedule`
  (`LAST_CHANCE_UNTIL_HOUR`), never restated — two modules disagreeing about
  when the truck came is the drift this prevents.
- **A named day is a real question.** "Whose turn tomorrow" answered with
  tonight's name is fast, confident and wrong — the F7 defect, one chore over.
  The dog roster honours today and tomorrow and **declines** anything further;
  a bin question about a night that is not the out-night declines too.
- **Nobody named means nobody said.** A schedule degraded to red-only names no
  one, and the roster says nothing rather than "someone".

## The flag

`choreRoster`, default **off**, gates the three *readers* — not the route.

Off: `briefingData` and `voiceSnapshot` never fetch `/api/chores` (no fetch, not
a discarded one), the intent row is skipped at the matcher so the sentence falls
through exactly as it did before, and the vocabulary card's truth filter drops
the phrase. The route stays mounted and answers a GET nobody makes.

Both states are asserted in `tests/chore-roster.spec.js` — including the two
phrasings that were *already* claimed by something else with the flag off
("who's on the bins" → `house.bins`, "whose turn is it to do the bins" →
`list.todo`), which is the half of a rollback nobody checks.

## Changing the roster

Edit `DOG_ROSTER` / `BIN_ROSTER` in `server/services/choreRoster.js`. They are
deliberately constants and not env vars: `rosterRules()` generates the spoken
rule from the same two objects, so the sentence the model is told can never
drift from the rule the code applies.
