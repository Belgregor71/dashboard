const REFRESH_MS = 10 * 60 * 1000;

function skeletonMarkup() {
  return `
    <div class="briefing-skeleton-line briefing-skeleton-line--headline"></div>
    <div class="briefing-skeleton-grid">
      <div class="briefing-skeleton-line"></div>
      <div class="briefing-skeleton-line"></div>
      <div class="briefing-skeleton-line"></div>
      <div class="briefing-skeleton-line"></div>
    </div>
  `;
}

export function createBriefingView() {
  const root = document.getElementById("briefing-view");
  const generatedAtEl = document.getElementById("briefing-generated-at");
  const headlineEl = document.getElementById("briefing-headline");
  const weatherEl = document.getElementById("briefing-weather");
  const calendarEl = document.getElementById("briefing-calendar");
  const homeEl = document.getElementById("briefing-home");
  const tasksEl = document.getElementById("briefing-tasks");

  if (!root || !headlineEl) {
    return {
      render: () => {},
      onEnter: () => {},
      onLeave: () => {}
    };
  }

  let refreshTimer = null;
  let keyHandler = null;
  let rendered = false;

  function setSkeleton() {
    headlineEl.innerHTML = skeletonMarkup();
    weatherEl.textContent = "Loading…";
    calendarEl.textContent = "Loading…";
    homeEl.textContent = "Loading…";
    tasksEl.textContent = "Loading…";
  }

  function renderBrief(brief) {
    headlineEl.textContent = brief?.headline || "Good morning.";
    generatedAtEl.textContent = brief?.generated_at
      ? `Updated ${new Date(brief.generated_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
      : "Updated just now";

    const sections = brief?.sections || {};
    weatherEl.textContent = sections.weather || "Weather summary unavailable.";
    calendarEl.textContent = sections.calendar || "Calendar summary unavailable.";
    homeEl.textContent = sections.home || "Home status summary unavailable.";
    tasksEl.textContent = sections.tasks || "Task summary unavailable.";
  }

  async function loadBrief() {
    setSkeleton();
    try {
      const response = await fetch("/api/ai/brief", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({})
      });
      if (!response.ok) throw new Error("brief fetch failed");
      const data = await response.json();
      renderBrief(data);
    } catch (error) {
      renderBrief({
        generated_at: new Date().toISOString(),
        headline: "Briefing unavailable right now.",
        sections: {
          weather: "Unable to fetch weather context.",
          calendar: "Unable to fetch calendar context.",
          home: "Unable to fetch home context.",
          tasks: "Unable to fetch tasks context."
        }
      });
    }
  }

  function render() {
    if (rendered) return;
    rendered = true;
    generatedAtEl.textContent = "";
    setSkeleton();
  }

  function onEnter() {
    loadBrief();
    if (!refreshTimer) {
      refreshTimer = setInterval(loadBrief, REFRESH_MS);
    }
    if (!keyHandler) {
      keyHandler = (event) => {
        if (document.body?.dataset?.view !== "briefing") return;
        if (event.key?.toLowerCase() !== "r") return;
        loadBrief();
      };
      window.addEventListener("keydown", keyHandler);
    }
  }

  function onLeave() {
    if (refreshTimer) {
      clearInterval(refreshTimer);
      refreshTimer = null;
    }
    if (keyHandler) {
      window.removeEventListener("keydown", keyHandler);
      keyHandler = null;
    }
  }

  return { render, onEnter, onLeave };
}
