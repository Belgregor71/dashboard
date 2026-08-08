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

   ── Why this announces instead of drawing ───────────────────────────────────

   The incumbent's answer is a corner chip. V3's four corners already have
   owners — hour BL · rail BR · title TL · transcript TR — and that rule cost
   seven defects to establish, so a fifth tenant is not free.

   It is also the wrong shape. A degraded feed is a CAUSE, and V3 already has a
   path for causes: `announce()` into the attention queue, which is what Phase
   3.3's arrival used and for the same reason. Ranking, presence-gating, the
   personality voice, quiet mode and `expiresAt` decay all come for free, and —
   the part that matters — this adds **no new writer of the glance cell**. A
   second writer maintained from a subscription is exactly how Phase 2's
   ownership bug happened.

   ⚠ **Presence-gated, and that is correct.** Score 72 is the High band, which
   reaches depth 1 only when someone is actually there. A house alone at 3am
   does not need to be told about itself, and a chip nobody is standing in front
   of is not a signal — it is a light left on.

   ⚠ **This never speaks.** Arrival speaks because someone just walked in.
   A broken feed that says itself out loud, once a minute, on a wall that runs
   for weeks, is the surface teaching the household to stop listening to it.
   ═══════════════════════════════════════════════════════════════════════════ */

import { announce } from "./attention.js";

const POLL_MS = 60_000;

/* Longer than POLL_MS on purpose, and only just. A fault that is still true
   re-announces on the next poll and stays continuously alive; a fault that has
   cleared stops being re-announced and decays on its own within one lifetime.
   That is the whole recovery mechanism — `announce()` has no retraction, and
   giving it one to save 90 s would be new API for no behaviour. */
const LIFE_MS = 90_000;

/* High band (70–89 in candidateSources.js): earns depth 1 when someone is in
   the room, never interrupts an empty one. Deliberately NOT the interrupt band
   — a stale calendar feed is not a doorbell. */
const HEALTH_SCORE = 72;

/* One line per feed, in the house's own register: plain, present tense, one
   sentence. docs/design/VOICE.md is the authority; personality.phrase() will
   run over these for tone and caps them at 140 characters. */
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

/* Worst first. ⚠ This order is not severity for its own sake — it is the
   healthService's own reasoning, lifted: "when the internet is down, weather +
   AI + news all fail SEPARATELY and the chip reads like three unrelated
   faults." Naming one cause is the whole job, so the wall shows the most
   upstream fault it can see and stays quiet about that fault's symptoms. */
const PRIORITY = ["wan", "ha", "motion", "cameras", "weather", "calendar", "ai", "tts"];

/* One id, always. Two simultaneous faults are still one sentence on a wall that
   has room for one, and a single id means a changed fault REPLACES rather than
   queues behind the fault it replaced. */
const CANDIDATE_ID = "health";

let timer = null;
let last = null;

/**
 * The fault to name, or null. Pure, so the choice is testable without a fetch.
 *
 * ⚠ Only `error` announces. `warn` is a feed that is merely late — weather at
 * 46 minutes is not news, and a wall that reports lateness trains the room to
 * ignore it by the time something is actually broken.
 *
 * @param {{feeds?: Array<{id: string, level: string, detail: string|null}>}} health
 */
export function worstFault(health) {
  const feeds = Array.isArray(health?.feeds) ? health.feeds : [];
  const broken = new Map();
  for (const feed of feeds) {
    if (feed?.level === "error" && feed.id) broken.set(feed.id, feed);
  }
  if (broken.size === 0) return null;

  for (const id of PRIORITY) {
    const feed = broken.get(id);
    if (feed) return { id, detail: feed.detail ?? null, text: LINES[id] ?? `${feed.label ?? id} is degraded.` };
  }

  /* A feed the server grew and this module has not heard of. Naming it plainly
     beats staying silent about a real error — the alternative is a fault class
     that is invisible precisely because it is new. */
  const [id, feed] = [...broken.entries()][0];
  return { id, detail: feed.detail ?? null, text: `${feed.label ?? id} is degraded.` };
}

async function poll() {
  let health = null;
  try {
    const res = await fetch("/api/system/health", { signal: AbortSignal.timeout(5000) });
    health = res.ok ? await res.json() : null;
  } catch {
    /* ⚠ The server being unreachable is NOT a fault to announce. This page is
       served BY that server, so a failed poll means either a restart in
       progress or a page that is about to stop working anyway — and announcing
       from a snapshot we could not read would be inventing a fault. Absent is
       not empty; the last real reading simply ages out. */
    return null;
  }

  const fault = worstFault(health);
  if (!fault) {
    last = { at: new Date().toISOString(), fault: null };
    return null;
  }

  announce({
    id: CANDIDATE_ID,
    source: "health",
    icon: "⚠",
    text: fault.text,
    score: HEALTH_SCORE,
    interrupt: false,
    expiresAt: Date.now() + LIFE_MS,
    cooldownMs: 0
  });

  last = { at: new Date().toISOString(), fault: fault.id, detail: fault.detail, text: fault.text };
  return fault;
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

  /* Poll immediately as well as on the interval: a page that has just been
     reloaded because something looked wrong should not wait a minute to say
     what it is. */
  poll();
  timer = setInterval(() => { poll(); }, POLL_MS);
}

/** Test seam — stops the interval so a spec starts cold. */
export function __resetHealth() {
  if (timer) { clearInterval(timer); timer = null; }
  last = null;
}
