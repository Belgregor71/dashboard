/* ═══════════════════════════════════════════════════════════════════════════
   THE WEEK — depth 3. "show me the next seven days."

   ── The data was already here ───────────────────────────────────────────────

   /api/weather/forecast has served a week of {date, high_c, low_c, condition,
   rain_chance_pct} since it was written; weatherService requests no
   `forecast_days` param, so Open-Meteo's default of seven applies and the
   normalizer maps every day it is given. voiceSnapshot has been caching it on a
   five-minute timer the whole time. What was missing was anything that DREW it —
   and, separately, anything that told the model it existed (houseDigest wrote
   only today's numbers, so "the next seven days" earned an honest refusal).

   The pre-V3 wall had this: a `#weekly-list` strip, removed in bdce91c when the
   seven views collapsed into four. This is that strip, as a subject.

   ── SEVEN IS NOT A PROMISE ──────────────────────────────────────────────────

   The same warning localAnswers carries, for the same reason. The Open-Meteo
   path and the BOM-via-HA fallback build the array differently, and
   weatherFallbackForecast() returns `{ days: [] }` when there are no
   coordinates at all. So this iterates whatever arrived and caps — it never
   indexes, never slices to a fixed seven, and never assumes days[1] is
   tomorrow.

   ⚠ ABSENT IS NOT EMPTY. No forecast at all returns null and the turn falls
   through to a lane that might know something. An empty array is a different
   fact and earns a sentence on the glass, because the person ASKED.
   ═══════════════════════════════════════════════════════════════════════════ */

import { frame, title, getJson } from "./dom.js";
import { getWeatherAnimationFilename } from "../../js/config/weather-animations.js";
import { loadLottieAnimation } from "../../js/helpers/lottie.js";

const TZ = "Australia/Brisbane";

/* Seven cells across a 1920px wall is ~245px each after the gutters, which is
   where the day name, the icon, the two temperatures and the rain figure all
   still clear the 32px floor. An eighth would not, so a longer feed is trimmed
   rather than squeezed — same rule as the calendar's MAX_ROWS. */
const MAX_DAYS = 7;

/* Rain worth mentioning. Below this the figure is noise on a fixed panel — a
   4% chance is a dry day, and printing it on all seven cells buries the 71%
   that is the actual reason someone asked. */
const RAIN_FLOOR_PCT = 20;

function round(n) {
  return Number.isFinite(Number(n)) ? String(Math.round(Number(n))) : null;
}

/**
 * The weekday label for a bare YYYY-MM-DD, relative to `now`.
 *
 * ⚠ PARSED AS LOCAL, NOT AS UTC. `new Date("2026-08-17")` is midnight UTC,
 * which in Brisbane (UTC+10) is 10am on the 17th — that happens to be safe, but
 * the same string west of Greenwich lands on the PREVIOUS day and every label
 * on the strip is then off by one. The parts are split and handed to the
 * three-argument constructor, which is local by definition. This is the same
 * host-local rule localAnswers' forecastDay() follows, and for the same reason:
 * the day's LABEL and the day's NUMBERS must not come off different clocks.
 */
export function dayLabel(dateStr, now = new Date()) {
  const [y, m, d] = String(dateStr ?? "").split("-").map(Number);
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return null;
  const date = new Date(y, m - 1, d);

  const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const offset = Math.round((date - midnight) / 86_400_000);
  if (offset === 0) return "Today";
  if (offset === 1) return "Tomorrow";
  return date.toLocaleDateString("en-AU", { weekday: "short", timeZone: TZ });
}

/**
 * @param {object} [opts]
 * @param {boolean} [opts.animate]  false renders the icons as static frames —
 *        used by the specs, where a rAF-driven player is a source of flake and
 *        the thing under test is the strip, not lottie-web.
 * @returns {Promise<{node, teardown}|null>}
 */
export async function showForecast({ now = new Date(), animate = true } = {}) {
  const forecast = await getJson("/api/weather/forecast");
  const days = forecast?.days;
  if (!Array.isArray(days)) return null;          // never loaded — fall through

  const { node, teardown } = frame("forecast");
  node.dataset.cell = "weather";
  node.appendChild(title("The week ahead"));

  if (days.length === 0) {
    const p = document.createElement("p");
    p.className = "subject__prose said said--2";
    p.textContent = "I can't see the forecast right now.";
    node.appendChild(p);
    return { node, teardown };
  }

  const strip = document.createElement("div");
  strip.className = "subject__week";

  /* Every animation this mounts, so teardown can destroy them. A lottie
     instance left alive keeps a rAF and its decoded SVG on a detached node, and
     depth 3 is the one per-event path in V3 — this is precisely the shape that
     produced 709 zombie wrappers. frame()'s teardown clears image srcs and knows
     nothing about lottie. */
  const anims = [];

  days.slice(0, MAX_DAYS).forEach((day, i) => {
    const cell = document.createElement("div");
    cell.className = "subject__day";

    const name = document.createElement("p");
    name.className = "subject__dayname measured measured--2";
    name.textContent = dayLabel(day?.date, now) ?? "";
    cell.appendChild(name);

    /* ⚠ condition.CODE, not condition.icon. `icon` is the normalizer's category
       string ("clear", "rain") and is not an icon name — the same trap flagged
       in main.js's cause mapping. getWeatherAnimationFilename wants the raw WMO
       number and falls back to clear-day for anything unmapped.

       isDay: true for every cell. These are DAILY highs and lows — a day has no
       time of day — and the old #weekly-list strip made the same call. */
    const icon = document.createElement("div");
    icon.className = "subject__dayicon";
    icon.id = `v3-week-icon-${i}`;
    cell.appendChild(icon);

    const temps = document.createElement("p");
    temps.className = "subject__daytemps";
    const high = round(day?.high_c);
    const low = round(day?.low_c);
    if (high != null) {
      const hi = document.createElement("span");
      hi.className = "subject__high measured measured--1";
      hi.textContent = `${high}°`;
      temps.appendChild(hi);
    }
    if (low != null) {
      const lo = document.createElement("span");
      lo.className = "subject__low measured measured--2";
      lo.textContent = `${low}°`;
      temps.appendChild(lo);
    }
    cell.appendChild(temps);

    const rain = document.createElement("p");
    rain.className = "subject__dayrain measured measured--2";
    const pct = Number(day?.rain_chance_pct);
    /* Empty rather than absent: an element that only exists on wet days makes
       the seven cells different heights, and the strip stops reading as a row. */
    rain.textContent = Number.isFinite(pct) && pct >= RAIN_FLOOR_PCT ? `${Math.round(pct)}%` : "";
    cell.appendChild(rain);

    strip.appendChild(cell);
  });

  node.appendChild(strip);

  /* Mounted by subjects/index.js AFTER this returns, and loadLottieAnimation is
     getElementById-based — so the players are started on the next frame, once
     the ids are actually in the document. A subject that never mounts leaves
     one cancelled rAF and no players, which is why the handle is captured.

     loadLottieAnimation no-ops without `window.lottie`, which v3/main.js sets at
     boot. That guard is why this import is safe on any surface and in node. */
  let startRaf = null;
  if (animate) {
    startRaf = requestAnimationFrame(() => {
      startRaf = null;
      if (!node.isConnected) return;
      days.slice(0, MAX_DAYS).forEach((day, i) => {
        const file = getWeatherAnimationFilename(Number(day?.condition?.code), true);
        const anim = loadLottieAnimation(`v3-week-icon-${i}`, file);
        if (anim) anims.push(anim);
      });
    });
  }

  return {
    node,
    teardown: () => {
      if (startRaf != null) { cancelAnimationFrame(startRaf); startRaf = null; }
      for (const anim of anims) {
        try { anim.destroy?.(); } catch { /* a broken player must not wedge depth */ }
      }
      anims.length = 0;
      teardown();
    }
  };
}
