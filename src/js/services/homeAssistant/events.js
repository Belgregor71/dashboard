import { emit, on } from "../../core/eventBus.js";
import { switchView } from "../../core/viewManager.js";
import { registerEntityFeed } from "./entityFeed.js";
import { handleCalendarCommand } from "../calendar/commands.js";

let dashboardCommandBridgeRegistered = false;

function registerWindowDashboardCommandBridge() {
  if (dashboardCommandBridgeRegistered) return;
  dashboardCommandBridgeRegistered = true;

  window.addEventListener("dashboard_command", (event) => {
    const detail = event?.detail || {};
    emit("dashboard_command", detail);
  });
}


export function registerHAEvents() {
  registerWindowDashboardCommandBridge();

  /* The entity cache is filled by services/homeAssistant/entityFeed.js, which is
     DOM-free so V3 can share it. Registered from here rather than from app.js so
     the incumbent's single call site stays the single call site, and so the feed
     can never be forgotten on the surface that has always had it. */
  registerEntityFeed();

  /* All this module keeps of the old cache path: the DOM re-broadcast. Twelve
     modules listen for `ha:state-updated` on `document` and that stays exactly
     true. `emit()` is synchronous, so the cache write in the feed still lands
     immediately before the matching DOM event — same order as when both lived
     in one function. */
  on("ha:state-updated", (detail) => {
    document.dispatchEvent(new CustomEvent("ha:state-updated", { detail }));
  });

  on("ha:event:dashboard_command", (data) => {
    const command = data.command || data.intent || data.action;
    emit("dashboard_command", data);

    if (!command) {
      emit("command:unknown", {
        command: "",
        ok: false,
        message: "Unknown command"
      });
      return;
    }

    if (command === "switch_view") {
      switchView(data.view, { force: true }); // remote/voice command — past the Phase 7 gate
      emit("command:executed", {
        command,
        ok: true,
        message: data.view ? `Switched to ${data.view}` : "View switched"
      });
      return;
    }

    if (["system_status", "status", "system_status_view"].includes(command)) {
      switchView("status");
      emit("status:highlight", { target: data.target });
      emit("command:executed", {
        command,
        ok: true,
        message: "Showing system status"
      });
      return;
    }

    if (["status_calendar", "calendar_status", "calendar_blank"].includes(command)) {
      switchView("status");
      emit("status:highlight", { target: "calendar" });
      emit("command:executed", {
        command,
        ok: true,
        message: "Showing calendar status"
      });
      return;
    }

    if (command === "agenda_plus" || command === "agenda_filter" || command === "agenda_date") {
      switchView("timeline");
      emit("command:executed", {
        command,
        ok: true,
        message: "Showing timeline"
      });
      return;
    }

    if (command === "agenda_tomorrow") {
      switchView("timeline");
      emit("timeline:scroll", { label: "Tomorrow" });
      emit("command:executed", {
        command,
        ok: true,
        message: "Showing tomorrow"
      });
      return;
    }

    if (command === "agenda_next") {
      emit("command:executed", {
        command,
        ok: true,
        message: "Showing timeline"
      });
      return;
    }

    if (handleCalendarCommand(command, data)) {
      emit("command:executed", {
        command,
        ok: true,
        message: "Calendar command executed"
      });
      return;
    }

    emit("command:unknown", {
      command,
      ok: false,
      message: "Unknown command"
    });
  });
}