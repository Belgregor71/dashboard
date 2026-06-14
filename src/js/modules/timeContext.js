// Time windows → context names
// morning  05:00 – 09:00  commute + day-ahead focus
// work     09:00 – 17:00  balanced default
// evening  17:00 – 21:00  media + tonight focus
// night    21:00 – 05:00  wind-down, security
const WINDOWS = [
  { from: 5,  to: 9,  name: "morning" },
  { from: 9,  to: 17, name: "work"    },
  { from: 17, to: 21, name: "evening" },
];

function getContext() {
  const h = new Date().getHours();
  return WINDOWS.find(w => h >= w.from && h < w.to)?.name ?? "night";
}

export function initTimeContext() {
  function apply() {
    document.body.dataset.timeContext = getContext();
  }
  apply();
  // Re-evaluate every minute — context only changes on the hour but cheap to check
  setInterval(apply, 60_000);
}
