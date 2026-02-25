const holidayCache = new Map();

function normalizeHolidayEvent(event = {}) {
  if (!event?.start || !event?.title) return null;
  return {
    ...event,
    source: "holidays",
    allDay: true,
    isHoliday: true,
    id: event.id || `holiday:${event.start}:${event.title}`
  };
}

export async function fetchHolidaysForYear(year, region = "QLD") {
  if (!Number.isFinite(year)) return [];
  const cacheKey = `${region}:${year}`;
  if (holidayCache.has(cacheKey)) {
    return holidayCache.get(cacheKey);
  }

  try {
    const response = await fetch(`/api/calendar/holidays?region=${encodeURIComponent(region)}&year=${year}`);
    if (!response.ok) {
      throw new Error(`holiday http ${response.status}`);
    }
    const payload = await response.json();
    const holidays = Array.isArray(payload)
      ? payload.map(normalizeHolidayEvent).filter(Boolean)
      : [];
    holidayCache.set(cacheKey, holidays);
    return holidays;
  } catch (error) {
    console.warn("Holiday fetch failed, continuing without holidays", error);
    holidayCache.set(cacheKey, []);
    return [];
  }
}

export async function fetchHolidaysForMonthContext(selectedDate) {
  const base = selectedDate instanceof Date ? selectedDate : new Date();
  const years = new Set([base.getFullYear()]);
  if (base.getMonth() === 0) years.add(base.getFullYear() - 1);
  if (base.getMonth() === 11) years.add(base.getFullYear() + 1);

  const results = await Promise.all(Array.from(years).map(year => fetchHolidaysForYear(year)));
  return results.flat();
}
