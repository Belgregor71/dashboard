const listeners = {};

// Returns an unsubscribe function (audit 2026-07-26, P3/H8). Nothing calls it
// yet and that is correct: all 39 subscriptions today sit in inits that run once
// from core/app.js — audited, not assumed. The point is that leak-free code was
// previously *unenforceable*, which on a display that runs for weeks is the
// footgun that already cost this repo 709 zombie lottie wrappers. Any future
// per-event path (a popup, a view re-init, a recovery re-arm) now has a teardown
// to be symmetric with, per CLAUDE.md's kiosk memory discipline.
export function on(event, handler) {
  if (!listeners[event]) {
    listeners[event] = [];
  }
  listeners[event].push(handler);
  return () => off(event, handler);
}

// Removes one subscription. Takes effect from the NEXT emit: emit() dispatches
// over a snapshot, so a handler removed while that same emit is in flight still
// receives the event it is already part of. That is the trade for stable
// iteration — the alternative, re-checking membership per handler, is O(n²) on
// `ha:event:state_changed`, which the audit already flags as the hottest path
// in the frontend (P1). Removal is what matters for leaks; one last delivery is
// not a leak.
export function off(event, handler) {
  const handlers = listeners[event];
  if (!handlers) return;
  const index = handlers.indexOf(handler);
  if (index !== -1) handlers.splice(index, 1);
}

// Handlers are isolated from each other (audit 2026-07-26, P2). MEASURED before
// the fix: with handlers [A, B-throws, C] on one event, A ran, C never did, and
// the throw escaped into emit()'s caller — on EVERY emit, not just the first,
// because nothing is removed from the list. Two consequences, and the second is
// the one the report doesn't name:
//   - C is starved for as long as B stays broken. `ha:states` has 13 consumers,
//     so a single bad one leaves the rest rendering stale data after a
//     reconnect — and a module whose entity rarely changes may never recover.
//   - The throw aborts the EMITTER too. Most emits sit inside an EventSource
//     onmessage (services/homeAssistant/client.js), so one bad consumer took out
//     the rest of that message handler as well.
//
// Isolation, not suppression: the error is re-thrown on a fresh task so it still
// surfaces as an uncaught page error. That matters because tests/ui.spec.js
// treats `pageerror` as the ONLY failure signal — console errors there are
// expected noise on a dev machine, and no spec watches them. Swallowing into
// console.error alone would have made every broken handler invisible to the
// suite, trading a loud bug for a silent one.
export function emit(event, payload = {}) {
  if (!listeners[event]) return;
  // Snapshot: for..of walks the live array, so a handler that calls on() for the
  // event it is handling would extend the loop it is inside — forEach silently
  // ignored those. Copying keeps dispatch stable against mutation either way.
  const handlers = [...listeners[event]];
  for (const handler of handlers) {
    try {
      handler(payload);
    } catch (error) {
      console.error(`[eventBus] handler for "${event}" threw:`, error);
      setTimeout(() => {
        throw error;
      }, 0);
    }
  }
}
