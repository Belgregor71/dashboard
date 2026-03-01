const STATE = {
  commuteActive: false,
  nextEventActive: false,
  current: null
};

function hidePanel(panel) {
  if (!panel || panel.classList.contains("is-hidden")) return;
  panel.classList.add("is-hidden");
  panel.addEventListener(
    "transitionend",
    () => {
      if (panel.classList.contains("is-hidden")) {
        panel.classList.add("is-collapsed");
      }
    },
    { once: true }
  );
}

function showPanel(panel) {
  if (!panel) return;
  panel.classList.remove("is-collapsed");
  requestAnimationFrame(() => {
    panel.classList.remove("is-hidden");
  });
}

function choosePanel() {
  if (STATE.commuteActive) return "commute";
  if (STATE.nextEventActive) return "next-event";
  return null;
}

function apply() {
  const commutePanel = document.getElementById("commute-panel");
  const nextEventPanel = document.getElementById("next-event-panel");
  const target = choosePanel();

  if (target === STATE.current) return;
  STATE.current = target;

  if (target === "commute") {
    showPanel(commutePanel);
    hidePanel(nextEventPanel);
    return;
  }

  if (target === "next-event") {
    hidePanel(commutePanel);
    showPanel(nextEventPanel);
    return;
  }

  hidePanel(commutePanel);
  hidePanel(nextEventPanel);
}

export function setCommuteActive(active) {
  STATE.commuteActive = active === true;
  apply();
}

export function setNextEventActive(active) {
  STATE.nextEventActive = active === true;
  apply();
}

export function initMiddleSlot() {
  apply();
}
