const listeners = {};

export function on(event, handler) {
  if (!listeners[event]) {
    listeners[event] = [];
  }
  listeners[event].push(handler);
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
  const handlers = listeners[event];
  if (!handlers) return;
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
