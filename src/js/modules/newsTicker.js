const REFRESH_MS = 30 * 60 * 1000;

async function refresh() {
  const ticker = document.getElementById("news-ticker");
  if (!ticker) return;

  try {
    const res = await fetch("/api/news");
    const data = await res.json();
    const headlines = Array.isArray(data?.headlines) ? data.headlines.filter(Boolean) : [];

    if (!headlines.length) {
      ticker.classList.add("is-hidden");
      return;
    }

    document.getElementById("news-ticker-source").textContent = data.source || "NEWS";
    const run = document.getElementById("news-ticker-run");
    run.replaceChildren(
      ...headlines.concat(headlines).map(h => {
        const span = document.createElement("span");
        span.textContent = h;
        return span;
      })
    );
    ticker.classList.remove("is-hidden");
  } catch {
    ticker.classList.add("is-hidden");
  }
}

export function initNewsTicker() {
  refresh();
  setInterval(refresh, REFRESH_MS);
}
