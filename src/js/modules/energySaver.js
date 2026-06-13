import { CONFIG } from "../core/config.js";
import { callHAService } from "../services/homeAssistant/client.js";

const DEFAULT_WAKE_TIME = "05:00";
const DEFAULT_SLEEP_TIME = "21:00";
const CHECK_INTERVAL_MS = 60_000;

let scheduleTimer = null;
let isSleeping = null;
let lastHaPowerState = null;

function parseTimeToMinutes(value, fallback) {
  const source = typeof value === "string" ? value : fallback;
  const match = /^(\d{1,2}):(\d{2})$/.exec(source || "");
  if (!match) return parseTimeToMinutes(fallback, DEFAULT_WAKE_TIME);

  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (!Number.isInteger(hours) || !Number.isInteger(minutes)) return parseTimeToMinutes(fallback, DEFAULT_WAKE_TIME);
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return parseTimeToMinutes(fallback, DEFAULT_WAKE_TIME);
  return (hours * 60) + minutes;
}

function getMinutesNow() {
  const now = new Date();
  return (now.getHours() * 60) + now.getMinutes();
}

function isWithinWakeWindow(currentMinutes, wakeMinutes, sleepMinutes) {
  if (wakeMinutes === sleepMinutes) return true;
  if (wakeMinutes < sleepMinutes) {
    return currentMinutes >= wakeMinutes && currentMinutes < sleepMinutes;
  }

  // Overnight window, e.g. wake 22:00 and sleep 06:00
  return currentMinutes >= wakeMinutes || currentMinutes < sleepMinutes;
}

async function syncMonitorPower(config, shouldSleep) {
  const entityId = config.monitorEntityId;
  if (!entityId || typeof entityId !== "string") return;

  const nextPowerState = shouldSleep ? "off" : "on";
  if (lastHaPowerState === nextPowerState) return;

  const [domain] = entityId.split(".");
  if (domain !== "switch" && domain !== "light") return;

  try {
    await callHAService({
      domain,
      service: nextPowerState === "on" ? "turn_on" : "turn_off",
      target: { entity_id: entityId }
    });
    lastHaPowerState = nextPowerState;
  } catch (error) {
    console.warn("Energy saver failed to toggle monitor power", error);
  }
}

async function applySleepState(config) {
  const wakeMinutes = parseTimeToMinutes(config.wakeTime, DEFAULT_WAKE_TIME);
  const sleepMinutes = parseTimeToMinutes(config.sleepTime, DEFAULT_SLEEP_TIME);
  const currentMinutes = getMinutesNow();
  const awake = isWithinWakeWindow(currentMinutes, wakeMinutes, sleepMinutes);
  const nextSleeping = !awake;

  if (isSleeping === nextSleeping) return;

  isSleeping = nextSleeping;
  document.body.classList.toggle("dashboard-sleeping", nextSleeping);

  await syncMonitorPower(config, nextSleeping);
}

export function initEnergySaver() {
  const config = CONFIG?.homeAssistant?.energySaver;
  if (!config?.enabled) return;

  void applySleepState(config);

  if (scheduleTimer) clearInterval(scheduleTimer);
  scheduleTimer = setInterval(() => {
    void applySleepState(config);
  }, CHECK_INTERVAL_MS);

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible") return;
    void applySleepState(config);
  });
}
