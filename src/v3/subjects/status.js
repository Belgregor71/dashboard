/* ═══════════════════════════════════════════════════════════════════════════
   THE STATUS — depth 3. "show me the status."

   Phase 6's second half. `core/health.js` is the one-line notice that something
   broke; this is the surface for asking what, and it is the only place in V3
   where the house talks about itself rather than about the household.

   The incumbent reaches the same question through `modules/systemStatus.js`
   (432 lines) and a whole registered view. Almost none of that ports: the view
   exists because the incumbent navigates, and V3 does not — it names a thing
   and that thing fills the screen. What is left after the navigation, the
   panels and the collapse/expand chrome come out is a readout, which is one
   frame and a column of rows.

   ⚠ **THIS SUBJECT CARRIES ITS OWN `speech`, and that is not a style choice.**
   Every other subject answers through `localAnswers.js`, which is pure and
   reads the voice snapshot — and the health of the box is not in the snapshot
   and does not belong there (it is a server reading, not a house fact). The
   briefing set the precedent: `speech` exists for a subject whose words do not
   exist until it has fetched them.

   ⚠ Which fault matters is decided by `worstFault()` in core/health.js, not
   here. Two consumers, one answer — the `alertRouter` precedent. If this file
   ranked faults itself, the wall's one-line notice and the wall's full readout
   could name different causes on the same fault, which is worse than either.
   ═══════════════════════════════════════════════════════════════════════════ */

import { frame, title, getJson } from "./dom.js";
import { worstFault } from "../core/health.js";
import { bootFault } from "../core/boot.js";

/* ⚠ SEEN ON THE GLASS 2026-08-09 — this does NOT use the shared column().
   Two reasons, both invisible to a textContent read and both obvious in a
   screenshot:

   1. `column()` lays a flex row out around a lead that sizes to its content.
      Every other subject's leads are TIMES — "09:30", "18:30" — so they align
      for free. Feed names do not: "Box" and "Camera snapshots" differ by
      fourteen characters, and the values came down the screen in a staircase.
   2. `column()` sets its value half in the SAID voice at 96px. The house is
      not telling you this, you asked it — a feed's state is measured. Rendered
      as-is, the least interesting word on the surface ("fine", eight times)
      was by a wide margin the largest thing on it.

   The class NAMES are kept (`subject__row`/`__lead`/`__text`) so the contrast
   sweep, the leak assertions and every existing selector keep working — only
   the register and the geometry change. */
function readout(rows) {
  const list = document.createElement("ul");
  list.className = "subject__list";
  for (const row of rows) {
    const li = document.createElement("li");
    li.className = "subject__row";
    // The one thing worth FINDING on this surface, so the one thing CSS lifts
    // out of the dim register.
    if (row.level) li.dataset.level = row.level;

    const lead = document.createElement("span");
    lead.className = "subject__lead measured measured--2";
    lead.textContent = row.lead;

    const text = document.createElement("span");
    text.className = "subject__text measured measured--2";
    text.textContent = row.text;

    li.append(lead, text);
    list.appendChild(li);
  }
  return list;
}

/* Eight feeds, a box line and a recovery or two. */
const MAX_RECOVERIES = 2;

/* ⚠ MEASURED ON THE GLASS 2026-08-09, and it is TEN — the "twelve rows at this
   size" this comment used to claim was a guess, and it was wrong.
   At 1920×1080 the frame's content box ends at 984px; ten rows put the last
   baseline at 980, and the eleventh at 1018. `overflow: hidden` is a guarantee
   on this wall rather than a fallback (there is no pointer, so nothing can
   scroll a row into view), which makes an eleventh row not "small" — it is a
   row that does not exist as far as the room is concerned.

   The live house already sits at ten: nine feeds plus the box line. So §4's
   surface row is the eleventh, and it clipped the box line clean off the bottom
   — invisible to every textContent assertion, obvious in one screenshot. The
   ninth defect this project has paid for that way.

   ⚠ There is no "1 more" line, deliberately: on a one-row overflow it would
   cost exactly the row it is reporting on. What gets dropped is the box's
   temperature, which this file already calls the least important row here, in
   favour of a row saying part of the screen never started. */
const MAX_ROWS = 10;

/** Plain words for a level. The server's own `detail` is used wherever it has
 *  one, because it is already written in this register ("no success for 26h",
 *  "connected but no events for 12m") and re-phrasing it here would be a second
 *  vocabulary for the same fact. */
function feedLine(feed) {
  if (feed.level === "ok") return "fine";
  return feed.detail || (feed.level === "error" ? "down" : "late");
}

function formatUptime(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  if (days > 0) return `up ${days}d ${hours}h`;
  const minutes = Math.floor((seconds % 3600) / 60);
  return hours > 0 ? `up ${hours}h ${minutes}m` : `up ${minutes}m`;
}

/** The box's own line — host, temperature, uptime. ⚠ `tempC` is null on a host
 *  where it cannot be read rather than 0: the G11 has no `vcgencmd` and no
 *  `/sys/class/thermal`, so this reads k10temp via the metrics route or nothing
 *  at all. A zero here would be a confident lie about a cold CPU. */
function boxLine(metrics) {
  if (!metrics) return null;
  const parts = [];
  if (metrics.hostname) parts.push(String(metrics.hostname));
  if (Number.isFinite(metrics.tempC)) parts.push(`${Math.round(metrics.tempC)}°C`);
  if (Number.isFinite(metrics.cpuLoadPercent)) parts.push(`${metrics.cpuLoadPercent}% cpu`);
  const up = formatUptime(metrics.uptimeSeconds);
  if (up) parts.push(up);
  return parts.length ? parts.join(" · ") : null;
}

/** What to say while the readout is on screen. One sentence: the screen has the
 *  detail, and a voice reciting eight feeds is the failure the fast lane exists
 *  to avoid. */
function speechFor(health) {
  const fault = worstFault(health);
  if (fault) return fault.text;
  if (!health) return "I can't read my own health right now.";
  const warnings = (health.feeds ?? []).filter((f) => f?.level === "warn").length;
  if (warnings > 0) return `Everything's working, ${warnings === 1 ? "one feed is" : `${warnings} feeds are`} running late.`;
  return "Everything's healthy.";
}

/**
 * @returns {Promise<{node, teardown, speech}|null>}
 */
export async function showStatus() {
  /* Both in one pass. Metrics is allowed to fail on its own — the box's
     temperature is the least important row here, and a subject that refuses to
     render because it could not read a CPU sensor would be answering a question
     about health by being unhealthy. */
  const [health, metrics] = await Promise.all([
    getJson("/api/system/health"),
    getJson("/api/system/metrics")
  ]);

  /* ⚠ NOT LOADED IS NOT EMPTY — the bug class this codebase has produced four
     times, and the zero-length clause is the fifth. No health reading means we
     cannot say the house is fine; it means we cannot say anything, so no
     subject mounts and the turn falls through.

     ⚠ The `length === 0` is NOT belt and braces. A 200 carrying `feeds: []` —
     a watchdog that started but has evaluated nothing, or a route half-way
     through a deploy — sails past a null check, mounts a titled panel with no
     rows in it, and says "Everything's healthy" out loud. A confident empty
     panel is worse than no panel, and this exact shape (an empty array read as
     an answer rather than as silence) is what todosFrom, eventsForDay and the
     calendar lane each shipped before it. */
  if (!health || !Array.isArray(health.feeds) || health.feeds.length === 0) return null;

  const { node, teardown } = frame("status");
  node.appendChild(title("The house"));

  const rows = health.feeds.map((feed) => ({
    lead: String(feed.label ?? feed.id ?? ""),
    text: feedLine(feed),
    level: feed.level === "ok" ? null : feed.level
  }));

  /* ⚠ The surface's own boot, FIRST (cutover §4). Everything below this row is
     the server's reading of the house; this row is whether the thing rendering
     those readings came up whole. It is at the top because it is the only row
     that can make the others untrustworthy — a subsystem that never started
     cannot be reporting on anything.

     This is the one place the stage NAMES are shown. The one-line notice keeps
     them out of the room's earshot on purpose ("substrate" is not a word
     anyone in a kitchen should need); a readout you deliberately asked for is
     exactly where they belong. */
  const surface = bootFault();
  if (surface) rows.unshift({ lead: "Surface", text: surface.detail, level: "error" });

  const box = boxLine(metrics);
  if (box) rows.push({ lead: "Box", text: box });

  /* Recent self-heals, newest first — the log is already in that order. Worth
     showing because a repair that keeps happening is a fault that keeps
     happening, and that is invisible in the feed levels: the whole point of
     recoveryService is that it puts the feed back to green. */
  const recoveries = Array.isArray(health.recoveries) ? health.recoveries.slice(0, MAX_RECOVERIES) : [];
  for (const entry of recoveries) {
    rows.push({
      lead: "Repaired",
      text: `${entry.action ?? entry.kind ?? "action"}${entry.ok === false ? " — failed" : ""}`
    });
  }

  /* The budget, applied last and in one place. `rows` is already in priority
     order — the surface's own fault, then every feed, then the box line, then
     the repairs — so the cheapest correct thing is to cut from the end.

     ⚠ Feeds are never what gets dropped while anything less important is still
     in the list, which is the whole reason the order above is not arbitrary. If
     the server ever grows enough feeds to fill the panel on its own, then the
     ceiling really has been reached and truncating is the honest answer. */
  node.appendChild(readout(rows.slice(0, MAX_ROWS)));

  return { node, teardown, speech: speechFor(health) };
}
