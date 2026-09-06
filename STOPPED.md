# STOPPED — overnight run, 2026-09-06

Queue halted at **item 1 of 2**, before any code was written. Both queued items hit a
stop condition. **Nothing was built, nothing was committed to `src/`, nothing was pushed.**
Tree is clean at `5467151`.

Neither stop is a failure of the work — both items are **stale**, and the evidence is
below. Building either one unattended would have shipped a change nobody needs.

---

## Item 2 — "the lit year label hides behind the drifting card" → **ALREADY FIXED**

**Stop condition:** the item is already done (skill step 1).

The year strip this item is about **no longer exists.** It was deleted by the one-plane
rebuild (`facb4a9`, live and default-on since 2026-09-05), and the deletion was
deliberate — `src/v3/core/archive.js:618` says so in as many words:

> ⚠⚠ THE YEAR STRIP DOES NOT EXIST IN PLANE MODE. Not hidden, not empty — never
> created … **the two shipped defects on this surface were BOTH that geometry landing a
> lit label somewhere a person could see it was wrong**, and code that cannot run cannot
> regress.

**Confirmed on the live wall** (CDP, 2026-09-06 20:05, `v3ArchivePlane: true` in both
`src/js/config.js:1668` and the kiosk's own `static/js/config.js:1668`):

```
stripPresent : false      <- the occluded element does not exist
yearPresent  : true       <- but this is the ENGRAVED year, a different node
yearRect     : top 206  left 1097  750x403
cardWrap     : top 185  left 100   394x553   (right edge 494)
cardPlane    : top 185  left 100   394x553
```

Two independent reasons the defect cannot recur:

1. **The strip is gone.** Nothing lit sits at the axis minimum any more.
2. **The wrap/plane divergence is gone.** The whole bug depended on
   `.archive__card-wrap` reaching 42–80 px higher than `.archive__card-plane`. In plane
   mode the two report **identical rects**. The trap recorded in the memory entry —
   "the plane is not what covers the label; the WRAP is" — no longer has two values to
   disagree about.
3. The surviving engraved year spans x **1097–1847**; the card spans x **100–494**. They
   do not overlap at any point in the drift, so there is nothing to sample.

**Action taken:** none in code. Memory entry corrected so this is not re-queued.

---

## Item 1 — "Archive in PORTRAIT, ~890 px of soft middle" → **OWNER CALL, NOT MINE**

**Stop condition:** ambiguous product decision (skill stop list, and the memory entry
says so explicitly: *"⚠ Owner call, not made."*).

The fix requires giving up the card's left pin for tall prints — a composition decision,
not a defect repair. `project-archive-caption-one-line.md` already recorded that a
portrait "cannot grow without MOVING", and that the premise had changed because the plate
left that side of the wall.

### What I did instead: closed the "after dark" gap, which only tonight could close

`project-archive-one-plane.md` carries **⏳ "Unverified: after dark"**, and the wall was
in `data-night="1"` with a **portrait** memory up (natural 1440×1928). Captured live over
CDP — read-only, `Page.captureScreenshot`, no navigation and no page mutation.

**The finding sharpens the decision rather than making it:**

> **The "soft middle" complaint is fully intact after dark — and worse than in daylight.**
> The night rule takes the engraved year to `opacity: 0` (measured: `yearOpacity "0"`,
> text `"2014"`). That year is the only thing occupying x1097–1847 in the daytime
> composition. So between the card's right edge (494) and the right screen edge there is,
> after dark, **nothing but the ghost** — about 1,400 px of it.

The daytime rebuttal recorded in memory ("the plate is no longer on that side, so that
gap is gone; the year fills it") **does not hold at night**, because the year is not
drawn at night. That is new information and it is the owner's to act on.

Screenshot: `night-portrait.png` (in this session's scratchpad, not committed — it is a
photo of a family member).

---

## Resume

Nothing to resume — the queue is empty of valid items. To act on item 1 in the morning:

```bash
# see the daylight composition for comparison, then decide the pin question
ssh pi-dashboard 'cd /home/dashboard/dashboard && node scripts/kiosk/kiosk-eval.cjs --state'
```

The decision to make is one sentence: **should a portrait memory keep the left pin and
stay 394 px wide, or give up the pin so tall prints can grow into the middle?** No code
should be written until that is answered.

To clear this file: `git rm STOPPED.md && git commit`.
