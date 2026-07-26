import { on } from "../core/eventBus.js";
import { escapeHtml } from "../core/escapeHtml.js";

const MEAL_PREFIX = /^Meal:\s*/;
const MEAL_EMOJI = [
  [/pasta|spaghetti|bolognese|lasagne/i, "🍝"],
  [/curry|butter chicken|chicken/i, "🍛"],
  [/fish|chips/i, "🍟"],
  [/pizza/i, "🍕"],
  [/taco|burrito|mexican/i, "🌮"],
  [/salad/i, "🥗"],
  [/soup/i, "🍲"],
  [/bbq|steak|grill/i, "🍖"],
  [/rice|stir.?fry/i, "🍚"]
];

function emojiFor(name) {
  const hit = MEAL_EMOJI.find(([re]) => re.test(name));
  return hit ? hit[1] : "🍽️";
}

function isSameDay(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function render() {
  const tile = document.getElementById("menu-tile");
  if (!tile) return;

  const events = Array.isArray(window.__CAL_EVENTS__) ? window.__CAL_EVENTS__ : [];
  const meals = events
    .filter(ev => MEAL_PREFIX.test(ev.rawTitle || ev.title || ""))
    .map(ev => ({
      date: new Date(ev.start),
      name: (ev.rawTitle || ev.title || "").replace(MEAL_PREFIX, "").trim()
    }))
    .filter(m => !Number.isNaN(m.date.getTime()))
    .sort((a, b) => a.date - b.date);

  const now = new Date();
  const tonight = meals.find(m => isSameDay(m.date, now));

  if (!tonight) {
    tile.classList.add("is-hidden", "is-collapsed");
    return;
  }

  const upcoming = meals.filter(m => m.date > now && !isSameDay(m.date, now)).slice(0, 2);

  tile.classList.remove("is-hidden", "is-collapsed");
  document.getElementById("menu-tile-thumb").textContent = emojiFor(tonight.name);
  document.getElementById("menu-tile-name").textContent = tonight.name || "Dinner";
  document.getElementById("menu-tile-sub").textContent = "Tonight's dinner";
  document.getElementById("menu-tile-upcoming").innerHTML = upcoming
    .map(m => `<div class="m"><b>${m.date.toLocaleDateString("en-AU", { weekday: "short" })}</b> ${escapeHtml(m.name)}</div>`)
    .join("");
}

export function initTonightsMenu() {
  on("calendar:refreshed", render);
}
