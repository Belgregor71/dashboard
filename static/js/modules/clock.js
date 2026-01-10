export function updateClock() {
  const now = new Date();
  const clockEl = document.getElementById("clock");
  const dateEl = document.getElementById("date");
  if (!clockEl || !dateEl) return;

  let time = now.toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
    hour12: true
  });

  time = time.replace(" AM", "\u202FAM").replace(" PM", "\u202FPM");
  clockEl.textContent = time;

  dateEl.textContent = now.toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric"
  });
}
