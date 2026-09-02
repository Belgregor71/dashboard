/* ═══════════════════════════════════════════════════════════════════════════
   HEALTH — the box telling the room it is broken.

   Phase 6 of docs/design/V3-MIGRATION.md, and like 5.1 the plan's entry for it
   was mostly already done. Measured before a line was written:

   ⚠ **THE WATCHDOG AND THE SELF-HEAL ALREADY RUN ON V3, AND ALWAYS DID.** Both
   are server-side — `server/services/healthService.js` and `recoveryService.js`
   — started from `app.listen`, driven by the Home Assistant manager, and they
   do not know or care which URL Chromium is showing. Verified live on the G11:
   both log their start line, `/api/system/health` reads `overall: "ok"`.
   **A faithful "port" of either builds nothing.**

   Two of the eight feeds are request-driven rather than server-timed — weather
   (`staleMs` 45 min) and calendar (2 h) only mark themselves healthy when their
   routes are actually hit. That is the one way a surface change could have
   starved the watchdog into a false alarm. It does not: V3's `refreshHouseCache`
   fetches `/api/weather/now` and `/api/calendar/all` every 300 s, which is 9×
   and 24× inside those thresholds.

   ── So what was actually missing ────────────────────────────────────────────

   The room. Every feed's escalation path is a phone push, and there are two
   holes in it that V3 made total rather than partial:

   1. ⚠ **`wan` is `notify: false` BY DESIGN.** A push about the internet being
      down would travel over the internet that is, by hypothesis, down — so the
      internet feed is *display-only*, and V3 had no display. The one fault that
      can only ever be seen was the one fault V3 could not show.
   2. Quiet hours suppress every push 22:00–07:00, so an overnight degradation
      is display-only too, whichever feed it is.

   ── Why this DRAWS, and no longer announces ─────────────────────────────────

   ⚠⚠ **REVERSED 2026-09-01, ON THE OWNER'S VERDICT AT THE GLASS.** Until this
   date a fault rode in through `announce()` as a score-72 candidate, won depth
   1, and set "Home Assistant isn't answering." in 132px Fraunces across the top
   half of the wall. The argument for that was that a degraded feed is a CAUSE
   and V3 already had a path for causes — which was true about the plumbing and
   wrong about the room. What it actually bought was the house's loudest
   editorial voice, the one reserved for the single thing this glance is about,
   spent on its own maintenance, on top of whatever the household had come to
   see. The verdict, verbatim: *"the big text error messages take away from the
   dashboard itself."*

   The register was the error, not the reporting. **A fault is not something the
   house is TELLING you, it is a state it is SHOWING you** — so under the one
   typographic rule this whole surface runs on (§ type.css: said is the serif,
   measured is the sans) it was in the wrong voice as well as at the wrong size.
   It is now a pill: measured, uppercase, tracked, --t-rail, top-left. The same
   idiom as `.cell__label` and `.now-playing__sub`, which is how this wall
   already says "label, not a fact competing for your attention."

   ── What was given up, and what was gained ──────────────────────────────────

   Lost with the queue: ranking, the personality voice, quiet mode, `expiresAt`
   decay. None of them were doing work here — the queue only ever carried ONE
   health candidate under one id, it was deliberately non-interrupting, and the
   decay was a 90 s re-announce loop reconstructing a state we can simply hold.

   Gained, and this is the larger half:

   1. **It no longer competes.** A fault and the morning commute were two
      candidates for one cell, so on a bad morning the wall showed you exactly
      one of the two things you needed.
   2. **It is no longer presence-gated.** Score 72 reached depth 1 only when
      someone was already standing there, which meant the wall could be broken
      for hours and say so only to whoever happened to walk past during a tick.
      A pill in the corner is a status light, not an interruption; the argument
      against a chip nobody is standing in front of ("a light left on") applies
      to a 132px sentence and not to 32px in a corner.
   3. **Still no new writer of the glance cell.** This module now owns exactly
      one node that nothing else touches, which is a stronger version of the
      guarantee the announce lane was chosen for.

   ⚠ **THE CORNER RULE IS HONOURED, NOT BROKEN.** hour BL · rail BR · title TL ·
   transcript TR — top-left is a subject's title, and a subject is depth 3, so
   the pill stands down there (compose.css). At depths 0-2 every `.cell` is
   `justify-content: flex-end`, so the top band is genuinely empty. And depth 3
   is where `subjects/status.js` puts the full readout, so the one depth that
   hides the pill is the one that answers it properly.

   ⚠ **This never speaks.** Unchanged, and for the original reason. A broken
   feed that says itself out loud once a minute on a wall that runs for weeks is
   the surface teaching the household to stop listening to it.
   ═══════════════════════════════════════════════════════════════════════════ */

import { bootFault } from "./boot.js";

const POLL_MS = 60_000;

/* ⚠ THE 90 s LIFETIME IS GONE WITH THE QUEUE, and its disappearance is the fix
   rather than a casualty of it. `announce()` has no retraction, so recovery was
   built out of decay: a fault still true re-announced every minute, a fault
   that had cleared simply stopped being re-raised and aged off the queue over
   the following ninety seconds. That is a wall that keeps saying something
   broken for a minute and a half after it is fixed. The pill is a state this
   module HOLDS, so clearing it is a poll that finds nothing — immediate, and
   with no second concept to keep in step with POLL_MS.

   One line per feed, in the house's own register: plain, present tense, one
   sentence. This is the SPOKEN half — `subjects/status.js` says it out loud
   when you ask — and docs/design/VOICE.md is its authority. */
const LINES = {
  wan: "The internet's down.",
  ha: "Home Assistant isn't answering.",
  motion: "The cameras have stopped reporting motion.",
  cameras: "The cameras aren't sending pictures.",
  weather: "The weather stopped updating.",
  calendar: "The calendar stopped updating.",
  ai: "The briefing service isn't answering.",
  tts: "I can't say anything out loud right now."
};

/* And the SHOWN half. ⚠ TWO REGISTERS FOR ONE FACT IS DELIBERATE, not a
   duplicated string table. LINES above is the house SPEAKING — a sentence, in
   the serif, when you ask the readout out loud. This is the house REPORTING —
   a state, in the sans, uppercased by the pill's own CSS. Under type.css's one
   rule they cannot be the same words: "Home Assistant isn't answering." set in
   32px tracked uppercase is a sentence wearing a label's clothes, and it does
   not fit on one line either.

   The bar each of these has to clear: readable at 3 m, in one glance, without
   the room having to work out which subsystem is meant. Feed IDS never appear,
   only the server’s own names for them — the same rule subjects/status.js states
   for stage names, that "substrate" is not a word anyone in a kitchen should
   need, and the reason the surface fault below shows no stage either. */
const LABELS = {
  wan: "Internet down",
  ha: "Home Assistant down",
  motion: "Motion reporting down",
  cameras: "Cameras not sending",
  weather: "Weather not updating",
  calendar: "Calendar not updating",
  ai: "Briefings down",
  tts: "Voice output down"
};

/* Worst first. ⚠ This order is not severity for its own sake — it is the
   healthService's own reasoning, lifted: "when the internet is down, weather +
   AI + news all fail SEPARATELY and the chip reads like three unrelated
   faults." Naming one cause is the whole job, so the wall shows the most
   upstream fault it can see and stays quiet about that fault's symptoms. */
const PRIORITY = ["wan", "ha", "motion", "cameras", "weather", "calendar", "ai", "tts"];

/* One fault, always. Two simultaneous faults are still one line on a wall that
   has room for one — `worstFault()` picks which — and one node means a changed
   fault REPLACES the fault it replaced rather than stacking beside it. */
const PILL_ID = "fault";
const PILL_LABEL_ID = "fault-label";

let timer = null;
let last = null;

/** One fault, both registers, from one feed.
 *
 *  ⚠ `text` AND `label` COME FROM THE SAME PLACE FOR THE SAME REASON THE TWO
 *  READERS OF worstFault() DO — the alertRouter precedent this file already
 *  follows. The pill and the spoken readout must never be able to name
 *  different causes on the same fault, and the way you guarantee that is to let
 *  them read one object rather than each derive its own wording.
 *
 *  The fallbacks are what a feed the server grew and this module has never
 *  heard of gets. `feed.label` is the server's own human name for it ("Camera
 *  snapshots"), which is already in the right register for both halves. */
function faultFor(id, feed) {
  const name = feed?.label ?? id;
  return {
    id,
    detail: feed?.detail ?? null,
    text: LINES[id] ?? `${name} is degraded.`,
    label: LABELS[id] ?? `${name} down`
  };
}

/**
 * The fault to name, or null. Pure over its argument — the one thing it reads
 * besides `health` is the surface's own boot, which is deliberate: see below.
 *
 * ⚠ Only `error` reaches the wall. `warn` is a feed that is merely late —
 * weather at 46 minutes is not news, and a wall that reports lateness trains
 * the room to ignore it by the time something is actually broken. That was the
 * rule when this drove an announce() and it did not change when it became a
 * pill: a pill is quieter, which makes it MORE tempting to fill with lateness,
 * not less.
 *
 * @param {{feeds?: Array<{id: string, level: string, detail: string|null}>}} health
 */
export function worstFault(health) {
  /* ⚠ THE SURFACE'S OWN BOOT OUTRANKS EVERY FEED (cutover §4). PRIORITY below
     is the healthService's reasoning about which upstream broke the others;
     this is one level above that argument entirely. The feeds describe what
     the surface is reporting ON — a half-booted wall telling you the calendar
     is late is answering the wrong question, and worse, it is doing it with
     whichever subsystems happen to still be alive.

     Both readers of this function get it for free, which is the point: the
     pill and the spoken readout cannot disagree about the cause — the
     alertRouter precedent this file already follows. */
  const surface = bootFault();
  if (surface) return surface;

  const feeds = Array.isArray(health?.feeds) ? health.feeds : [];
  const broken = new Map();
  for (const feed of feeds) {
    if (feed?.level === "error" && feed.id) broken.set(feed.id, feed);
  }
  if (broken.size === 0) return null;

  for (const id of PRIORITY) {
    const feed = broken.get(id);
    if (feed) return faultFor(id, feed);
  }

  /* A feed the server grew and this module has not heard of. Naming it plainly
     beats staying silent about a real error — the alternative is a fault class
     that is invisible precisely because it is new. */
  const [id, feed] = [...broken.entries()][0];
  return faultFor(id, feed);
}

async function poll() {
  let health = null;
  let read = false;
  try {
    const res = await fetch("/api/system/health", { signal: AbortSignal.timeout(5000) });
    if (res.ok) {
      health = await res.json();
      read = true;
    }
  } catch {
    /* ⚠ The server being unreachable is NOT a fault to report. This page is
       served BY that server, so a failed poll means either a restart in
       progress or a page that is about to stop working anyway — and raising a
       fault from a snapshot we could not read would be inventing one. Absent is
       not empty. */
  }

  /* ⚠ The one fault that survives an unreadable snapshot is the surface's own
     (cutover §4): it is known locally, so reporting it is not inventing it.
     Without this clause a boot failure would be silent for exactly as long as
     the server was also dark — which is precisely the moment a wall that came
     up wrong most needs to say so. */
  const fault = read ? worstFault(health) : bootFault();

  if (!fault) {
    /* ⚠ THE PILL COMES DOWN EVEN ON AN UNREAD POLL, and that asymmetry with
       `last` below is deliberate. Not being able to read the server is not
       evidence of a fault (see the catch above) — but neither is it evidence
       that the fault we are currently SHOWING is still true, and a stale one
       held up by a dark server is the wall lying with confidence. The surface's
       own boot survives an unreadable server because it is known locally, and
       that is the clause `fault` above already applies.

       `last`, by contrast, only records a verdict we actually took: an unread
       poll writing "no fault" would be the same confident-from-nothing reading
       the catch refuses to raise. */
    paintFault(null);
    if (read) last = { at: new Date().toISOString(), fault: null };
    return null;
  }

  paintFault(fault);

  last = {
    at: new Date().toISOString(),
    fault: fault.id,
    detail: fault.detail,
    text: fault.text,
    label: fault.label
  };
  return fault;
}

/* ── The pill ───────────────────────────────────────────────────────────────
   The one node this module owns, and the only writer of it anywhere in V3.

   ⚠ IDEMPOTENT ON PURPOSE, AND IT IS NOT A MICRO-OPTIMISATION. This runs every
   POLL_MS for the life of a page that stays up for weeks — ~40,000 times a
   month. A fault that is still true must not re-write textContent on every one
   of those passes: this wall has already paid for a repaint nobody asked for
   (the calm law's surviving clause is "never move for a reason the room can't
   see", and a pill that re-lays-out once a minute is exactly that, invisibly).
   The guard is the rendered label, not the fault id, so a feed whose wording
   changes under one id still lands.

   `hidden`, not opacity: a fault is a state with a cause the room can name, so
   it appears at once rather than fading in, and — the part that matters to the
   sweep — a hidden node reports no rect, so tests/verify/v3-contrast.spec.js
   cannot measure a pill that is not on the glass and call it unpainted.
─────────────────────────────────────────────────────────────────────────── */
function paintFault(fault) {
  const node = document.getElementById(PILL_ID);
  if (!node) return null;
  const label = document.getElementById(PILL_LABEL_ID);

  if (!fault) {
    if (!node.hidden) {
      node.hidden = true;
      if (label) label.textContent = "";
      delete node.dataset.fault;
    }
    return null;
  }

  const words = fault.label ?? fault.text ?? "";
  if (label && label.textContent !== words) label.textContent = words;
  if (node.dataset.fault !== fault.id) node.dataset.fault = fault.id;
  if (node.hidden) node.hidden = false;
  return fault.id;
}

/** The last poll's verdict, for __v3(). */
export function lastHealth() {
  return last;
}

export function initHealth() {
  if (timer) return;

  /* Force a poll without waiting out the interval, and read the verdict.
     ⚠ Registered BEFORE the first poll, not after. The first poll is a fetch,
     and anything driving this page over CDP can arrive during that gap — a
     hook that only exists once an async load has settled is the flake this
     repo has already root-caused twice. Returns the promise rather than
     awaiting it so the registration itself stays synchronous. */
  window.__v3Health = () => poll();

  /* ⚠ AND A SEAM FOR THE PILL ITSELF. The contrast sweep has to be able to put
     this node on the glass to measure it, and it cannot do that through the
     health route: the sweep drives ONE booted page through fourteen surfaces
     and cannot re-fulfil /api/system/health per surface. Without this the pill
     would be the one piece of text in V3 that ships unmeasured — over the part
     of the frame where the scrim is transparent by design, which is precisely
     where an unmeasured element has burned this project before (#ground-caption
     at 1.02:1). Returns the id it painted so a spec can assert it landed. */
  window.__v3Fault = (fault) => paintFault(fault ?? null);

  /* Poll immediately as well as on the interval: a page that has just been
     reloaded because something looked wrong should not wait a minute to say
     what it is. */
  poll();
  timer = setInterval(() => { poll(); }, POLL_MS);
}
