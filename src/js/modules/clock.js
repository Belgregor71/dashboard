export function updateClock() {
  const now    = new Date();
  const clockEl = document.getElementById("clock");
  const dateEl  = document.getElementById("date");
  if (!clockEl || !dateEl) return;

  // Build time string with en-AU locale
  let time = now.toLocaleTimeString("en-AU", {
    hour:   "numeric",
    minute: "2-digit",
    hour12: true,
  });

  // Wrap AM/PM in its own span for separate font-size / opacity styling
  time = time.replace(
    /\s*(AM|PM)$/i,
    (_, ap) => `<span class="clock-ampm"> ${ap}</span>`
  );
  clockEl.innerHTML = time;

  dateEl.textContent = now.toLocaleDateString("en-AU", {
    weekday: "long",
    month:   "long",
    day:     "numeric",
  });
}
