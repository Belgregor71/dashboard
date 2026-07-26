import { on } from "./eventBus.js";

let overlayEl = null;
let textEl = null;
let hideTimer = null;

const DEFAULT_TEXT = {
  listening: "Listening",
  processing: "Processing",
  success: "Done",
  error: "Command failed"
};

const VALID_STATES = new Set(["listening", "processing", "success", "error", "hidden"]);

function clearHideTimer() {
  if (hideTimer) {
    clearTimeout(hideTimer);
    hideTimer = null;
  }
}

export function setVoiceState(state, text) {
  if (!overlayEl || !VALID_STATES.has(state)) return;

  clearHideTimer();

  if (state === "hidden") {
    overlayEl.classList.remove("is-visible");
    overlayEl.dataset.state = "hidden";
    if (textEl) textEl.textContent = "";
    return;
  }

  overlayEl.dataset.state = state;
  overlayEl.classList.add("is-visible");
  if (textEl) {
    textEl.textContent = text ?? DEFAULT_TEXT[state] ?? "";
  }

  if (state === "success") {
    hideTimer = setTimeout(() => setVoiceState("hidden"), 1500);
  }

  if (state === "error") {
    hideTimer = setTimeout(() => setVoiceState("hidden"), 2000);
  }
}

export function initVoiceOverlay() {
  if (overlayEl) return;

  overlayEl = document.createElement("div");
  overlayEl.id = "voice_overlay";
  overlayEl.className = "voice-overlay";
  overlayEl.dataset.state = "hidden";
  overlayEl.setAttribute("aria-live", "polite");

  overlayEl.innerHTML = `
    <div class="voice-pill">
      <span class="voice-icon" aria-hidden="true"></span>
      <span class="voice-text"></span>
    </div>
  `;

  document.body.appendChild(overlayEl);
  textEl = overlayEl.querySelector(".voice-text");

  on("dashboard_command", () => setVoiceState("processing"));
  on("command:executed", ({ message } = {}) => setVoiceState("success", message));
  on("command:unknown", ({ message } = {}) => setVoiceState("error", message));
}
