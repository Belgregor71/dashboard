function setConnectionState(state) {
  const connectionText = document.querySelector(".ha-connection__text");
  const connectionDot = document.querySelector(".ha-connection__dot");
  if (!connectionText || !connectionDot) return;

  connectionText.textContent = state;
  connectionDot.classList.toggle("is-online", state === "Connected");
  connectionDot.classList.toggle("is-offline", state !== "Connected");
}

export function initHomeAssistantTodayPanel() {
  setConnectionState("Connecting…");

  document.addEventListener("ha:connected", () => {
    setConnectionState("Connected");
  });

  document.addEventListener("ha:disconnected", () => {
    setConnectionState("Disconnected");
  });
}
