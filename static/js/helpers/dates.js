// dates.js

// -----------------------------
// FORMATTING HELPERS
// -----------------------------
export const format = {
  time(date) {
    return new Date(date).toLocaleTimeString("en-AU", {
      hour: "numeric",
      minute: "2-digit"
    });
  },

  dayName(date) {
    return new Date(date).toLocaleDateString("en-AU", {
      weekday: "long"
    });
  },

  date(date) {
    return new Date(date).toLocaleDateString("en-AU", {
      day: "numeric",
      month: "long",
      year: "numeric"
    });
  }
};

// -----------------------------
// UTILITY: ADD DAYS
// -----------------------------
export function addDays(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

// -----------------------------
// UTILITY: SAME DAY CHECK
// -----------------------------
export function sameDay(a, b) {
  const d1 = new Date(a);
  const d2 = new Date(b);
  return (
    d1.getFullYear() === d2.getFullYear() &&
    d1.getMonth() === d2.getMonth() &&
    d1.getDate() === d2.getDate()
  );
}

// -----------------------------
// ALIASES FOR AGENDA COMPATIBILITY
// -----------------------------
export function formatDate(date) {
  return format.date(date);
}

export function formatTime(date) {
  return format.time(date);
}
