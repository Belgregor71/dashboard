const STATE = {
  commuteActive:   false,
  nextEventActive: false,
  fuelActive:      false,
  current:         null,
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

// Priority: commute > next-event > fuel
function choosePanel() {
  if (STATE.commuteActive)   return "commute";
  if (STATE.nextEventActive) return "next-event";
  if (STATE.fuelActive)      return "fuel";
  return null;
}

function apply() {
  const commutePanel   = document.getElementById("commute-panel");
  const nextEventPanel = document.getElementById("next-event-panel");
  const fuelPanel      = document.getElementById("fuel-panel");
  const target         = choosePanel();

  if (target === STATE.current) return;
  STATE.current = target;

  if (target === "commute") {
    showPanel(commutePanel);
    hidePanel(nextEventPanel);
    hidePanel(fuelPanel);
    return;
  }

  if (target === "next-event") {
    hidePanel(commutePanel);
    showPanel(nextEventPanel);
    hidePanel(fuelPanel);
    return;
  }

  if (target === "fuel") {
    hidePanel(commutePanel);
    hidePanel(nextEventPanel);
    showPanel(fuelPanel);
    return;
  }

  hidePanel(commutePanel);
  hidePanel(nextEventPanel);
  hidePanel(fuelPanel);
}

export function setCommuteActive(active) {
  STATE.commuteActive = active === true;
  apply();
}

export function setNextEventActive(active) {
  STATE.nextEventActive = active === true;
  apply();
}

export function setFuelActive(active) {
  STATE.fuelActive = active === true;
  apply();
}

export function initMiddleSlot() {
  apply();
}
