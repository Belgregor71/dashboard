const REFRESH_MS = 15 * 60 * 1000;
const SECS_PER_HEADLINE = 7;

export function initNewsTicker() {
  const ticker = document.getElementById("news-ticker");
  const labelEl = document.getElementById("news-ticker-label");
  const contentEl = document.getElementById("news-ticker-content");
  if (!ticker || !contentEl) return;

  async function load() {
    try {
      const res = await fetch("/api/news");
      if (!res.ok) return;
      const { headlines, source } = await res.json();
      if (!headlines?.length) return;

      if (labelEl) labelEl.textContent = source || "NEWS";

      // Duplicate text so the second copy starts exactly where the first ends —
      // when translateX(-50%) is reached the loop restarts invisibly.
      const joined = headlines.join("   •   ");
      contentEl.textContent = joined + "   •   " + joined;

      const duration = Math.max(30, headlines.length * SECS_PER_HEADLINE);
      contentEl.style.animationDuration = `${duration}s`;
    } catch {
      // silent — ticker just stays blank
    }
  }

  load();
  setInterval(load, REFRESH_MS);
}
