import { CONFIG } from "../core/config.js";

const AUTO_DISMISS_MS = 60_000;
const STORAGE_KEY = "dashboard:occasion-shown";

// ── Date helpers ───────────────────────────────────────────────

function calcEaster(year) {
  const a = year % 19;
  const b = Math.floor(year / 100), c = year % 100;
  const d = Math.floor(b / 4), e = b % 4;
  const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return { month, day };
}

function addDays(year, month, day, offset) {
  const d = new Date(year, month - 1, day);
  d.setDate(d.getDate() + offset);
  return { month: d.getMonth() + 1, day: d.getDate() };
}

function nthWeekday(year, month, nth, weekday) {
  const firstDay = new Date(year, month - 1, 1).getDay();
  const offset = (weekday - firstDay + 7) % 7;
  return 1 + offset + (nth - 1) * 7;
}

// ── Occasion detection ─────────────────────────────────────────

function detectOccasion(now) {
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  const day = now.getDate();

  const cfg = CONFIG.occasions || {};
  const birthdays = cfg.birthdays || [];
  const schoolHolidays = cfg.schoolHolidays || [];

  const easter = calcEaster(year);
  const goodFriday = addDays(year, easter.month, easter.day, -2);
  const easterSat = addDays(year, easter.month, easter.day, -1);
  const mothersDay = nthWeekday(year, 5, 2, 0);  // AU: 2nd Sunday May
  const fathersDay = nthWeekday(year, 9, 1, 0);  // AU: 1st Sunday September

  const matchingBirthdays = birthdays.filter(b => b.month === month && b.day === day);
  const matchingHoliday = schoolHolidays.find(h => {
    const d = new Date(h.date);
    return d.getFullYear() === year && d.getMonth() + 1 === month && d.getDate() === day;
  });

  if (matchingBirthdays.length)                                         return { type: "birthday",       names: matchingBirthdays.map(b => b.name) };
  if (month === 12 && day === 25)                                       return { type: "christmas" };
  if (month === 1  && day === 1)                                        return { type: "newyear" };
  if (month === easter.month && day === easter.day)                     return { type: "easter" };
  if (month === 10 && day === 31)                                       return { type: "halloween" };
  if (month === 12 && day === 24)                                       return { type: "christmaseve" };
  if (month === 12 && day === 31)                                       return { type: "newyeareve" };
  if (month === goodFriday.month && day === goodFriday.day)             return { type: "goodfriday" };
  if (month === easterSat.month && day === easterSat.day)               return { type: "eastersaturday" };
  if (month === 5  && day === mothersDay)                               return { type: "mothers" };
  if (month === 9  && day === fathersDay)                               return { type: "fathers" };
  if (month === 2  && day === 14)                                       return { type: "valentine" };
  if (month === 4  && day === 25)                                       return { type: "anzac" };
  if (matchingHoliday)                                                  return { type: "holidays", label: matchingHoliday.label };

  return null;
}

// ── Scene element helpers ──────────────────────────────────────

function mk(tag, cls, cssText) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (cssText) e.style.cssText = cssText;
  return e;
}

const BALLOON_EMOJIS   = ["🎈", "🎈", "🎉", "🎈", "🎊", "🎈", "🎉", "🎈"];
const CONFETTI_COLORS  = ["#ff4d4d", "#ffd93d", "#6bcb77", "#4d96ff", "#ff6b6b", "#c77dff"];
const SNOWFLAKE_CHARS  = ["❄", "❅", "❆", "✦", "✧"];
const EGG_EMOJIS       = ["🥚", "🐣", "🥚", "🐣", "🥚"];
const FLOWER_EMOJIS    = ["🌸", "🌼", "🌸", "🌻", "🌷", "🌼", "🌸", "🌻", "🌷"];

// ── Scene builders ─────────────────────────────────────────────

function buildBirthdayScene(scene) {
  for (let i = 0; i < 8; i++) {
    const b = mk("span", "occ-balloon", `left:${8 + i * 11}%; animation-delay:${(i * 0.45).toFixed(1)}s; animation-duration:${(3.2 + (i % 3) * 0.5).toFixed(1)}s`);
    b.textContent = BALLOON_EMOJIS[i];
    scene.appendChild(b);
  }
  for (let i = 0; i < 28; i++) {
    const w = 6 + (i % 6) * 2, h = 4 + (i % 4);
    const c = mk("div", "occ-confetti", `left:${(i * 3.7 + 1) % 96}%; width:${w}px; height:${h}px; background:${CONFETTI_COLORS[i % CONFETTI_COLORS.length]}; border-radius:2px; animation-delay:${(i * 0.22).toFixed(1)}s; animation-duration:${(2.6 + (i % 5) * 0.3).toFixed(1)}s`);
    scene.appendChild(c);
  }
  const hero = mk("span", "occ-hero-emoji occ-bounce");
  hero.textContent = "🎂";
  scene.appendChild(hero);
}

function buildChristmasScene(scene) {
  for (let i = 0; i < 20; i++) {
    const size = (0.9 + (i % 4) * 0.3).toFixed(1);
    const s = mk("span", "occ-snowflake", `left:${(i * 5.1) % 96}%; font-size:${size}rem; animation-delay:${(i * 0.28).toFixed(1)}s; animation-duration:${(3.5 + (i % 6) * 0.4).toFixed(1)}s`);
    s.textContent = SNOWFLAKE_CHARS[i % SNOWFLAKE_CHARS.length];
    scene.appendChild(s);
  }
  const santa = mk("span", "occ-santa");
  santa.textContent = "🎅🦌";
  scene.appendChild(santa);
  const hero = mk("span", "occ-hero-emoji occ-sway");
  hero.textContent = "🎄";
  scene.appendChild(hero);
}

function buildEasterScene(scene) {
  for (let i = 0; i < 5; i++) {
    const e = mk("span", "occ-egg", `left:${10 + i * 18}%; animation-delay:${(i * 0.3).toFixed(1)}s,${(i * 0.3 + 0.7).toFixed(1)}s; animation-duration:0.6s,${(2.0 + i * 0.15).toFixed(1)}s`);
    e.textContent = EGG_EMOJIS[i];
    scene.appendChild(e);
  }
  for (let i = 0; i < 9; i++) {
    const size = (1.3 + (i % 3) * 0.3).toFixed(1);
    const f = mk("span", "occ-flower", `left:${(i * 11 + 2) % 94}%; font-size:${size}rem; animation-delay:${(0.1 + i * 0.14).toFixed(2)}s`);
    f.textContent = FLOWER_EMOJIS[i];
    scene.appendChild(f);
  }
  const hero = mk("span", "occ-hero-emoji occ-bunny-bounce");
  hero.textContent = "🐰";
  scene.appendChild(hero);
}

function buildNewYearScene(scene) {
  const FW_COLORS = ["#ff4d4d", "#ffd93d", "#6bcb77", "#4d96ff", "#ff9f43", "#c77dff", "#00d2ff"];
  for (let i = 0; i < 7; i++) {
    const fw = mk("div", "occ-firework", `top:${15 + (i % 3) * 28}%; left:${5 + i * 13}%; color:${FW_COLORS[i % FW_COLORS.length]}; animation-delay:${(i * 0.38).toFixed(1)}s; animation-duration:${(1.5 + (i % 3) * 0.3).toFixed(1)}s`);
    scene.appendChild(fw);
  }
  for (let i = 0; i < 15; i++) {
    const size = (0.7 + (i % 5) * 0.22).toFixed(2);
    const s = mk("span", "occ-star", `top:${(i * 13 + 5) % 82}%; left:${(i * 6.8 + 2) % 94}%; font-size:${size}rem; animation-delay:${(i * 0.18).toFixed(1)}s; animation-duration:${(1.2 + (i % 4) * 0.25).toFixed(1)}s`);
    s.textContent = "✦";
    scene.appendChild(s);
  }
  const hero = mk("span", "occ-hero-emoji occ-pulse");
  hero.textContent = "🥂";
  scene.appendChild(hero);
}

function buildHalloweenScene(scene) {
  for (let i = 0; i < 5; i++) {
    const size = (1.5 + (i % 3) * 0.4).toFixed(1);
    const b = mk("span", "occ-bat", `top:${8 + i * 17}%; font-size:${size}rem; animation-delay:${(i * 0.9).toFixed(1)}s; animation-duration:${(5.5 + i * 0.8).toFixed(1)}s`);
    b.textContent = "🦇";
    scene.appendChild(b);
  }
  const spider = mk("span", "occ-spider");
  spider.textContent = "🕷️";
  scene.appendChild(spider);
  const MOON_ITEMS = ["🌙", "✦", "✦", "✦", "✦", "✦"];
  for (let i = 0; i < 6; i++) {
    const size = i === 0 ? "1.8" : (0.7 + (i % 3) * 0.2).toFixed(1);
    const s = mk("span", "occ-star", `top:${4 + (i * 14) % 38}%; left:${(i * 14 + 4) % 45}%; font-size:${size}rem; animation-delay:${(i * 0.3).toFixed(1)}s; animation-duration:${(1.8 + (i % 3) * 0.4).toFixed(1)}s`);
    s.textContent = MOON_ITEMS[i];
    scene.appendChild(s);
  }
  const hero = mk("span", "occ-hero-emoji occ-glow-orange");
  hero.textContent = "🎃";
  scene.appendChild(hero);
}

function buildHolidaysScene(scene) {
  const sun = mk("span", "occ-sun");
  sun.textContent = "☀️";
  scene.appendChild(sun);
  const STAR_EMOJIS = ["⭐", "🌟", "✦", "⭐", "✦", "🌟"];
  for (let i = 0; i < 10; i++) {
    const size = (1.0 + (i % 4) * 0.28).toFixed(2);
    const s = mk("span", "occ-star", `top:${(i * 17 + 5) % 78}%; left:${(i * 9.2 + 3) % 88}%; font-size:${size}rem; animation-delay:${(i * 0.22).toFixed(1)}s; animation-duration:${(1.4 + (i % 5) * 0.3).toFixed(1)}s`);
    s.textContent = STAR_EMOJIS[i % STAR_EMOJIS.length];
    scene.appendChild(s);
  }
  for (let i = 0; i < 14; i++) {
    const w = 6 + (i % 5) * 2, h = 5 + (i % 3);
    const c = mk("div", "occ-confetti", `left:${(i * 7.1 + 1) % 94}%; width:${w}px; height:${h}px; background:${CONFETTI_COLORS[i % CONFETTI_COLORS.length]}; border-radius:2px; animation-delay:${(i * 0.3).toFixed(1)}s; animation-duration:${(3.0 + (i % 4) * 0.35).toFixed(1)}s`);
    scene.appendChild(c);
  }
  const hero = mk("span", "occ-hero-emoji occ-bounce");
  hero.textContent = "🏖️";
  scene.appendChild(hero);
}

function buildValentineScene(scene) {
  const HEARTS = ["❤️", "💕", "❤️", "💖", "❤️", "💕", "💝", "❤️", "💖", "💕", "❤️", "💕"];
  for (let i = 0; i < 12; i++) {
    const size = (1.2 + (i % 4) * 0.28).toFixed(2);
    const h = mk("span", "occ-heart", `left:${(i * 8.2 + 2) % 92}%; font-size:${size}rem; animation-delay:${(i * 0.42).toFixed(1)}s; animation-duration:${(3.8 + (i % 4) * 0.5).toFixed(1)}s`);
    h.textContent = HEARTS[i];
    scene.appendChild(h);
  }
  const hero = mk("span", "occ-hero-emoji occ-pulse");
  hero.textContent = "💝";
  scene.appendChild(hero);
}

function buildMothersScene(scene) {
  for (let i = 0; i < 9; i++) {
    const size = (1.5 + (i % 3) * 0.35).toFixed(2);
    const f = mk("span", "occ-flower", `left:${(i * 10 + 4) % 90}%; font-size:${size}rem; animation-delay:${(i * 0.18).toFixed(2)}s`);
    f.textContent = FLOWER_EMOJIS[i];
    scene.appendChild(f);
  }
  const hero = mk("span", "occ-hero-emoji occ-bounce");
  hero.textContent = "💐";
  scene.appendChild(hero);
}

function buildFathersScene(scene) {
  const DAD_ITEMS = ["⭐", "🏆", "🌟", "⭐", "✨", "🌟", "⭐"];
  for (let i = 0; i < 7; i++) {
    const size = (1.4 + (i % 4) * 0.3).toFixed(1);
    const s = mk("span", "occ-twinkle", `top:${(i * 23 + 8) % 78}%; left:${(i * 13 + 5) % 88}%; font-size:${size}rem; animation-delay:${(i * 0.35).toFixed(1)}s; animation-duration:${(1.6 + (i % 4) * 0.3).toFixed(1)}s`);
    s.textContent = DAD_ITEMS[i];
    scene.appendChild(s);
  }
  const hero = mk("span", "occ-hero-emoji occ-sway");
  hero.textContent = "🏆";
  scene.appendChild(hero);
}

function buildANZACScene(scene) {
  for (let i = 0; i < 7; i++) {
    const size = (1.3 + (i % 3) * 0.25).toFixed(2);
    const p = mk("span", "occ-flower", `left:${(i * 13 + 3) % 91}%; font-size:${size}rem; animation-delay:${(i * 0.2).toFixed(1)}s`);
    p.textContent = "🌺";
    scene.appendChild(p);
  }
  const hero = mk("span", "occ-hero-emoji occ-still");
  hero.textContent = "🌺";
  scene.appendChild(hero);
}

const SCENE_BUILDERS = {
  birthday:      buildBirthdayScene,
  christmas:     buildChristmasScene,
  christmaseve:  buildChristmasScene,
  easter:        buildEasterScene,
  eastersaturday: buildEasterScene,
  goodfriday:    buildEasterScene,
  newyear:       buildNewYearScene,
  newyeareve:    buildNewYearScene,
  halloween:     buildHalloweenScene,
  holidays:      buildHolidaysScene,
  valentine:     buildValentineScene,
  mothers:       buildMothersScene,
  fathers:       buildFathersScene,
  anzac:         buildANZACScene,
};

// ── Occasion metadata ──────────────────────────────────────────

function getOccasionMeta(detected) {
  const { type, names = [], label } = detected;
  switch (type) {
    case "birthday": {
      const nameStr = names.join(" & ");
      return {
        theme: "birthday",
        title: nameStr ? `Happy Birthday, ${nameStr}!` : "Happy Birthday!",
        subtitle: "Wishing you a wonderful day filled with joy 🎉",
      };
    }
    case "christmas":      return { theme: "christmas",  title: "Merry Christmas!",      subtitle: "Wishing your family a magical day ✨" };
    case "christmaseve":   return { theme: "christmas",  title: "Christmas Eve!",         subtitle: "Santa is on his way tonight 🎅" };
    case "easter":         return { theme: "easter",     title: "Happy Easter!",          subtitle: "Hope your day is egg-stra special 🐣" };
    case "eastersaturday": return { theme: "easter",     title: "Easter Saturday",        subtitle: "The egg hunt begins tomorrow 🥚" };
    case "goodfriday":     return { theme: "easter",     title: "Good Friday",            subtitle: "Easter weekend is here 🌺" };
    case "newyear":        return { theme: "newyear",    title: "Happy New Year!",        subtitle: "Here's to a fantastic year ahead 🥂" };
    case "newyeareve":     return { theme: "newyear",    title: "New Year's Eve!",        subtitle: "Tonight we ring in the new year 🎆" };
    case "halloween":      return { theme: "halloween",  title: "Happy Halloween!",       subtitle: "Trick or treat? 👻" };
    case "holidays":       return { theme: "holidays",   title: label || "School Holidays!", subtitle: "Time to relax and have fun! 🌞" };
    case "valentine":      return { theme: "valentine",  title: "Happy Valentine's Day!", subtitle: "Love is in the air 💕" };
    case "mothers":        return { theme: "mothers",    title: "Happy Mother's Day!",    subtitle: "Celebrating the incredible mums in our lives 💐" };
    case "fathers":        return { theme: "fathers",    title: "Happy Father's Day!",    subtitle: "Celebrating the amazing dads 🏆" };
    case "anzac":          return { theme: "anzac",      title: "ANZAC Day",              subtitle: "Lest We Forget 🌺" };
    default:               return null;
  }
}

// ── Popup lifecycle ────────────────────────────────────────────

let overlayEl = null;
let progressInterval = null;
let dismissTimer = null;

function buildPopup(detected) {
  const meta = getOccasionMeta(detected);
  if (!meta) return null;

  const overlay = document.createElement("div");
  overlay.className = "occasion-popup";

  const card = document.createElement("div");
  card.className = `occasion-popup__card occasion-popup__card--${meta.theme}`;

  const sceneWrap = document.createElement("div");
  sceneWrap.className = "occasion-popup__scene-wrap";
  const scene = document.createElement("div");
  scene.className = "occ-scene";
  sceneWrap.appendChild(scene);

  const builder = SCENE_BUILDERS[detected.type];
  if (builder) builder(scene);

  const closeBtn = document.createElement("button");
  closeBtn.className = "occasion-popup__close";
  closeBtn.setAttribute("aria-label", "Close");
  closeBtn.textContent = "×";
  closeBtn.addEventListener("click", dismissPopup);

  const titleEl = document.createElement("div");
  titleEl.className = "occasion-popup__title";
  titleEl.textContent = meta.title;

  const subtitleEl = document.createElement("div");
  subtitleEl.className = "occasion-popup__subtitle";
  subtitleEl.textContent = meta.subtitle;

  const footer = document.createElement("div");
  footer.className = "occasion-popup__footer";
  const progress = document.createElement("div");
  progress.className = "occasion-popup__progress";
  footer.appendChild(progress);

  card.appendChild(sceneWrap);
  card.appendChild(closeBtn);
  card.appendChild(titleEl);
  card.appendChild(subtitleEl);
  card.appendChild(footer);
  overlay.appendChild(card);

  overlay.addEventListener("click", (e) => { if (e.target === overlay) dismissPopup(); });

  return { overlay, progress };
}

function showPopup(detected) {
  const built = buildPopup(detected);
  if (!built) return;

  const { overlay, progress } = built;
  overlayEl = overlay;
  document.body.appendChild(overlay);

  requestAnimationFrame(() => requestAnimationFrame(() => overlay.classList.add("is-active")));

  const startMs = Date.now();
  progressInterval = setInterval(() => {
    const pct = Math.min(100, ((Date.now() - startMs) / AUTO_DISMISS_MS) * 100);
    progress.style.width = `${pct}%`;
    if (pct >= 100) clearInterval(progressInterval);
  }, 250);

  dismissTimer = setTimeout(dismissPopup, AUTO_DISMISS_MS);
}

function dismissPopup() {
  if (!overlayEl) return;
  clearInterval(progressInterval);
  clearTimeout(dismissTimer);
  overlayEl.classList.remove("is-active");
  const el = overlayEl;
  overlayEl = null;
  setTimeout(() => el.remove(), 450);
}

// ── Storage helpers ────────────────────────────────────────────

function wasShownToday(type) {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
    return stored.date === new Date().toDateString() && stored.type === type;
  } catch { return false; }
}

function markShownToday(type) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ date: new Date().toDateString(), type }));
  } catch {}
}

// ── Entry point ────────────────────────────────────────────────

export function initOccasionPopup() {
  function check() {
    const params = new URLSearchParams(window.location.search);
    const forceType = params.get("occasion");
    const forceName = params.get("name");

    let detected;
    if (forceType) {
      detected = { type: forceType, names: forceName ? [forceName] : ["Test"], label: "Test Holidays" };
    } else {
      detected = detectOccasion(new Date());
    }

    if (!detected) return;
    if (!forceType && wasShownToday(detected.type)) return;

    setTimeout(() => {
      if (!forceType) markShownToday(detected.type);
      showPopup(detected);
    }, forceType ? 500 : 3000);
  }

  check();

  // Re-check just after midnight for dashboards that run continuously
  const now = new Date();
  const msToMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).getTime() - now.getTime() + 5000;
  setTimeout(() => {
    check();
    setInterval(check, 24 * 60 * 60 * 1000);
  }, msToMidnight);
}
