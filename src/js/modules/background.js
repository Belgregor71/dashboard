import { BACKGROUND_INTERVAL } from "../config/config.js";

let backgroundImages = [];
let currentBgIndex = -1;

function getTintClassForNow() {
  const hour = new Date().getHours();
  if (hour >= 5 && hour < 10) return "tint-morning";
  if (hour >= 10 && hour < 17) return "tint-day";
  if (hour >= 17 && hour < 20) return "tint-evening";
  return "tint-night";
}

export function initBackground() {
  loadBackgroundImages();
  updateTint();
  setInterval(updateTint, 10 * 60 * 1000);
}

function loadBackgroundImages() {
  fetch("/api/photos")
    .then(res => res.json())
    .then(files => {
      if (!Array.isArray(files)) {
        throw new Error("Photo API returned non-array payload");
      }

      backgroundImages = Array.from(new Set(files)).map(file => {
        const trimmed = String(file).replace(/^\/?photos\//, "");
        return `/photos/${encodeURIComponent(trimmed)}`;
      });

      if (backgroundImages.length > 0) {
        rotateBackground();
        setInterval(rotateBackground, BACKGROUND_INTERVAL);
      }
    })
    .catch(err => console.error("Error loading background images:", err));
}

function rotateBackground() {
  if (backgroundImages.length === 0) return;

  let nextIndex;
  do {
    nextIndex = Math.floor(Math.random() * backgroundImages.length);
  } while (nextIndex === currentBgIndex);

  currentBgIndex = nextIndex;

  const img = document.getElementById("background-image");
  if (!img) return;

  img.classList.remove("bg-visible", "bg-animate");

  setTimeout(() => {
    img.src = backgroundImages[currentBgIndex];
    img.onload = () => {
      img.classList.add("bg-visible", "bg-animate");
    };
  }, 500);
}

const TINT_CLASSES = ["tint-morning", "tint-day", "tint-evening", "tint-night"];

function updateTint() {
  const tint = document.getElementById("background-tint");
  const tintClass = getTintClassForNow();

  // Apply to the overlay element (controls background wash colour)
  tint?.classList.remove(...TINT_CLASSES);
  tint?.classList.add(tintClass);

  // Apply to body so CSS can target body.tint-* for accent colours
  document.body.classList.remove(...TINT_CLASSES);
  document.body.classList.add(tintClass);
}
