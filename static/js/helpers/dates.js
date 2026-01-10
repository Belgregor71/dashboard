export function addDays(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

export function sameDay(a, b) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

export function formatDate(d) {
  return d.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric"
  });
}

export function formatTime(d) {
  return d
    .toLocaleTimeString([], {
      hour: "numeric",
      minute: "2-digit",
      hour12: true
    })
    .replace(" AM", "\u202FAM")
    .replace(" PM", "\u202FPM");
}
