import express from "express";

const router = express.Router();

// Unofficial ESPN scoreboard — no key required. Swap URL here if endpoint changes.
const ESPN_URL = "https://site.api.espn.com/apis/site/v2/sports/rugby-league/nrl/scoreboard";

let _cache = null;
let _cacheUntil = 0;

function periodLabel(status) {
  const desc   = (status?.type?.shortDetail ?? status?.type?.description ?? "").toLowerCase();
  const period = status?.period ?? 0;
  if (/half.?time/i.test(desc) || desc === "ht") return "Half Time";
  if (period === 1) return "1st Half";
  if (period === 2) return "2nd Half";
  if (period > 2)  return "Extra Time";
  return "";
}

function parseGame(event) {
  const comp = event.competitions?.[0];
  if (!comp) return null;

  const home = comp.competitors?.find(c => c.homeAway === "home");
  const away = comp.competitors?.find(c => c.homeAway === "away");
  if (!home || !away) return null;

  const status = comp.status ?? {};
  const state  = status.type?.state ?? "pre";   // "pre" | "in" | "post"

  return {
    home:       home.team?.displayName ?? home.team?.name ?? "",
    away:       away.team?.displayName ?? away.team?.name ?? "",
    homeScore:  parseInt(home.score ?? "0", 10) || 0,
    awayScore:  parseInt(away.score ?? "0", 10) || 0,
    live:       state === "in",
    finished:   state === "post",
    period:     periodLabel(status),
    clock:      status.displayClock ?? "",
    date:       event.date ?? null,
  };
}

router.get("/api/nrl/broncos", async (_req, res) => {
  const now = Date.now();
  if (_cacheUntil > now) return res.json(_cache ?? {});

  try {
    const r = await fetch(ESPN_URL, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; pi-dashboard/1.0)" },
      signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) throw new Error(`ESPN HTTP ${r.status}`);

    const data   = await r.json();
    const events = data.events ?? [];

    const broncosEvent = events.find(ev =>
      (ev.competitions?.[0]?.competitors ?? []).some(c =>
        (c.team?.displayName ?? c.team?.name ?? "").toLowerCase().includes("brisbane")
      )
    );

    const game = broncosEvent ? parseGame(broncosEvent) : null;

    // Shorter cache when live so scores stay fresh
    _cache     = game;
    _cacheUntil = now + (game?.live ? 30_000 : game ? 5 * 60_000 : 10 * 60_000);

    res.json(game ?? {});
  } catch (err) {
    console.error("[NRL] fetch error:", err.message);
    res.status(502).json({});
  }
});

export default router;
