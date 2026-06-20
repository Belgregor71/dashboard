const MILESTONE_DAYS = [30, 14, 7, 3, 1];

export function computeTravelMoments(events, now = new Date()) {
  return (events || [])
    .filter(ev => ev.category?.id === "travel" && ev.start)
    .map(ev => {
      const days = Math.round((new Date(ev.start) - now) / 86_400_000);
      return MILESTONE_DAYS.includes(days)
        ? { icon: ev.category?.icon || "✈️", text: `${days} day${days === 1 ? "" : "s"} until ${ev.displayTitle || ev.title}` }
        : null;
    })
    .filter(Boolean);
}
