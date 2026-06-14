const POLL_LIVE_MS  = 30_000;
const POLL_TODAY_MS = 5 * 60_000;
const POLL_IDLE_MS  = 15 * 60_000;
const TRY_ANIM_MS   = 4_500;

let overlayEl      = null;
let tryBadgeEl     = null;
let tryTimer       = null;
let pollTimer      = null;
let isBroncosHome  = false;
let prevScore      = { home: null, away: null };

// ── DOM setup ──────────────────────────────────────────────────

function ensureOverlay() {
  if (overlayEl) return;

  overlayEl = document.createElement("div");
  overlayEl.id        = "nrl-overlay";
  overlayEl.className = "nrl-overlay nrl-overlay--hidden";
  overlayEl.innerHTML = `
    <div class="nrl-overlay__header">
      <span class="nrl-overlay__league">NRL</span>
      <span class="nrl-overlay__team-label">BRONCOS</span>
      <span class="nrl-overlay__live-dot" aria-hidden="true"></span>
    </div>
    <div class="nrl-overlay__body">
      <div class="nrl-overlay__scores">
        <div class="nrl-overlay__team" id="nrl-home-team">
          <span class="nrl-overlay__name"  id="nrl-home-name">—</span>
          <span class="nrl-overlay__score" id="nrl-home-score"></span>
        </div>
        <div class="nrl-overlay__vsep">–</div>
        <div class="nrl-overlay__team nrl-overlay__team--right" id="nrl-away-team">
          <span class="nrl-overlay__score" id="nrl-away-score"></span>
          <span class="nrl-overlay__name"  id="nrl-away-name">—</span>
        </div>
      </div>
      <div class="nrl-overlay__status" id="nrl-status"></div>
    </div>
    <div class="nrl-try-badge" id="nrl-try-badge" aria-hidden="true">TRY!</div>
  `;

  document.body.appendChild(overlayEl);
  tryBadgeEl = overlayEl.querySelector("#nrl-try-badge");
}

function el(id) { return document.getElementById(id); }

// Last word of team name: "Brisbane Broncos" → "Broncos"
function shortName(full) {
  const parts = full.trim().split(/\s+/);
  return parts[parts.length - 1];
}

// ── Rendering ──────────────────────────────────────────────────

function updateDOM(game) {
  ensureOverlay();

  if (!game?.home) {
    overlayEl.classList.add("nrl-overlay--hidden");
    return;
  }

  isBroncosHome = game.home.toLowerCase().includes("brisbane");

  el("nrl-home-name").textContent  = shortName(game.home);
  el("nrl-away-name").textContent  = shortName(game.away);

  const showScore = game.live || game.finished;
  el("nrl-home-score").textContent = showScore ? game.homeScore : "";
  el("nrl-away-score").textContent = showScore ? game.awayScore : "";

  // Highlight Broncos side
  el("nrl-home-team").classList.toggle("nrl-overlay__team--broncos", isBroncosHome);
  el("nrl-away-team").classList.toggle("nrl-overlay__team--broncos", !isBroncosHome);

  // Status text
  let status = "";
  if (game.live) {
    status = [game.period, game.clock].filter(Boolean).join("  ·  ");
  } else if (game.finished) {
    status = "Full Time";
  } else if (game.date) {
    const kickoff = new Date(game.date).toLocaleTimeString("en-AU", {
      hour: "numeric", minute: "2-digit", hour12: true,
      timeZone: "Australia/Brisbane"
    });
    status = `Kick off ${kickoff}`;
  }
  el("nrl-status").textContent = status;

  overlayEl.classList.toggle("nrl-overlay--live",   game.live);
  overlayEl.classList.toggle("nrl-overlay--final",  game.finished);
  overlayEl.classList.remove("nrl-overlay--hidden");
}

// ── Try detection ──────────────────────────────────────────────

function broncosScore(game) {
  return isBroncosHome ? game.homeScore : game.awayScore;
}

function checkTry(game) {
  const current = broncosScore(game);
  const prev    = isBroncosHome ? prevScore.home : prevScore.away;

  if (prev !== null && current - prev >= 4) {
    playTryAnimation();
  }
}

function playTryAnimation() {
  if (!overlayEl || !tryBadgeEl) return;

  clearTimeout(tryTimer);
  overlayEl.classList.remove("nrl-overlay--try");
  tryBadgeEl.classList.remove("nrl-try-badge--active");

  void overlayEl.offsetWidth; // force reflow to restart animation

  overlayEl.classList.add("nrl-overlay--try");
  tryBadgeEl.classList.add("nrl-try-badge--active");

  tryTimer = setTimeout(() => {
    overlayEl.classList.remove("nrl-overlay--try");
    tryBadgeEl.classList.remove("nrl-try-badge--active");
  }, TRY_ANIM_MS);
}

// ── Polling ────────────────────────────────────────────────────

async function fetchAndUpdate() {
  clearTimeout(pollTimer);

  try {
    const res  = await fetch("/api/nrl/broncos");
    const game = await res.json();

    if (game?.home) {
      isBroncosHome = game.home.toLowerCase().includes("brisbane");
      if (game.live) checkTry(game);
      prevScore = { home: game.homeScore, away: game.awayScore };
    }

    updateDOM(game?.home ? game : null);

    const nextMs = game?.live ? POLL_LIVE_MS : game?.home ? POLL_TODAY_MS : POLL_IDLE_MS;
    pollTimer = setTimeout(fetchAndUpdate, nextMs);
  } catch {
    pollTimer = setTimeout(fetchAndUpdate, POLL_IDLE_MS);
  }
}

// ── Init ───────────────────────────────────────────────────────

export function initNrlScores() {
  ensureOverlay();
  fetchAndUpdate();
}
