// Polls the server watchdog and shows a small corner chip when any feed
// is degraded. Hidden entirely while everything is healthy.

const POLL_MS = 60_000;

export function initHealthIndicator() {
  const el = document.getElementById("health-indicator");
  const label = document.getElementById("health-indicator-label");
  if (!el || !label) return;

  async function poll() {
    try {
      const response = await fetch("/api/system/health");
      if (!response.ok) return;
      const data = await response.json();
      const issues = (data?.feeds || []).filter((feed) => feed.level !== "ok");
      if (!issues.length) {
        el.classList.add("is-hidden");
        el.setAttribute("aria-hidden", "true");
        return;
      }
      label.textContent = issues.map((feed) => feed.label).join(" · ");
      el.classList.toggle("health-indicator--error", data.overall === "error");
      el.classList.remove("is-hidden");
      el.setAttribute("aria-hidden", "false");
    } catch {
      // Server unreachable — other UI surfaces will already show failures.
    }
  }

  poll();
  setInterval(poll, POLL_MS);
}
