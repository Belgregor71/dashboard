import { test, expect } from "@playwright/test";
import { on, off, emit } from "../src/js/core/eventBus.js";

// Pure unit tests for core/eventBus.js (no DOM — runs in plain node), covering
// audit 2026-07-26 P2/H3: one throwing handler must not starve the handlers
// registered after it, and must not abort the code that called emit().
//
// The bus re-throws a failed handler on a fresh task on purpose, so the failure
// still reaches the page as an uncaught error — tests/ui.spec.js treats
// `pageerror` as its only failure signal and no spec watches console output, so
// console.error alone would hide a broken handler from the whole suite. That
// deliberate re-throw is what these tests have to work around: in node it lands
// as an uncaughtException, so each test that provokes one owns it for the
// duration and hands the listeners back afterwards.
function captureAsyncRethrow() {
  const previous = process.listeners("uncaughtException");
  previous.forEach((l) => process.removeListener("uncaughtException", l));
  return new Promise((resolve) => {
    process.once("uncaughtException", (error) => {
      previous.forEach((l) => process.on("uncaughtException", l));
      resolve(error);
    });
  });
}

test("a throwing handler does not starve the handlers after it", async () => {
  const ran = [];
  on("test:isolation", () => ran.push("A"));
  on("test:isolation", () => {
    throw new Error("boom");
  });
  on("test:isolation", () => ran.push("C"));

  const rethrown = captureAsyncRethrow();
  emit("test:isolation");

  // Pre-fix this was ["A"] — C was skipped on this and every later emit.
  expect(ran).toEqual(["A", "C"]);
  expect((await rethrown).message).toBe("boom");
});

test("a throwing handler does not abort the emitter", async () => {
  // Most emits sit inside an EventSource onmessage (homeAssistant/client.js),
  // where an escaping throw took out the rest of that message handler too.
  on("test:emitter", () => {
    throw new Error("boom");
  });

  const rethrown = captureAsyncRethrow();
  let reachedNextStatement = false;
  emit("test:emitter");
  reachedNextStatement = true;

  expect(reachedNextStatement).toBe(true);
  await rethrown;
});

test("the failure still surfaces uncaught rather than being swallowed", async () => {
  on("test:loud", () => {
    throw new Error("must not be silent");
  });

  const rethrown = captureAsyncRethrow();
  emit("test:loud");
  expect((await rethrown).message).toBe("must not be silent");
});

test("recovery is per-emit, not one-shot: a later emit still reaches every handler", async () => {
  const ran = [];
  on("test:repeat", () => {
    throw new Error("boom");
  });
  on("test:repeat", () => ran.push("after"));

  const first = captureAsyncRethrow();
  emit("test:repeat");
  await first;

  const second = captureAsyncRethrow();
  emit("test:repeat");
  await second;

  expect(ran).toEqual(["after", "after"]);
});

test("a healthy event is untouched — handlers run in registration order", () => {
  const ran = [];
  on("test:healthy", () => ran.push(1));
  on("test:healthy", () => ran.push(2));
  on("test:healthy", () => ran.push(3));

  emit("test:healthy", { any: "payload" });
  expect(ran).toEqual([1, 2, 3]);
});

test("emitting an event with no listeners is a no-op", () => {
  expect(() => emit("test:nobody-listening")).not.toThrow();
});

test("the payload reaches every handler, and defaults to an object", () => {
  const seen = [];
  on("test:payload", (p) => seen.push(p));
  on("test:payload", (p) => seen.push(p));

  emit("test:payload", { v: 7 });
  expect(seen).toEqual([{ v: 7 }, { v: 7 }]);

  seen.length = 0;
  emit("test:payload");
  expect(seen).toEqual([{}, {}]);
});

// ── off() / unsubscribe (audit P3, H8) ────────────────────────────────
// The point of these is teardown symmetry: a per-event path that subscribes on
// every occurrence must be able to unsubscribe, or handlers accumulate for the
// life of a page that runs for weeks.

test("the function on() returns unsubscribes", () => {
  const ran = [];
  const unsubscribe = on("test:unsub", () => ran.push("x"));

  emit("test:unsub");
  expect(ran).toEqual(["x"]);

  unsubscribe();
  emit("test:unsub");
  expect(ran).toEqual(["x"]);
});

test("off() removes only the handler passed, leaving its siblings subscribed", () => {
  const ran = [];
  const a = () => ran.push("a");
  const b = () => ran.push("b");
  const c = () => ran.push("c");
  on("test:off", a);
  on("test:off", b);
  on("test:off", c);

  off("test:off", b);
  emit("test:off");
  expect(ran).toEqual(["a", "c"]);
});

test("re-subscribing after off() restores delivery — the accumulate/teardown cycle", () => {
  const ran = [];
  const handler = () => ran.push("tick");

  // Stands in for a per-event path that inits, tears down and inits again. The
  // failure this guards against is the handler running twice on the second pass.
  for (let i = 0; i < 3; i++) {
    const unsubscribe = on("test:cycle", handler);
    emit("test:cycle");
    unsubscribe();
    emit("test:cycle");
  }
  expect(ran).toEqual(["tick", "tick", "tick"]);
});

test("off() is a no-op for an unknown event or an unregistered handler", () => {
  const ran = [];
  const registered = () => ran.push("r");
  on("test:noop", registered);

  expect(() => off("test:never-registered", registered)).not.toThrow();
  expect(() => off("test:noop", () => {})).not.toThrow();

  emit("test:noop");
  expect(ran).toEqual(["r"]);
});

test("unsubscribing twice removes one subscription, not a later duplicate", () => {
  const ran = [];
  const handler = () => ran.push("h");
  const unsubscribe = on("test:double", handler);
  unsubscribe();
  unsubscribe(); // must not remove the fresh subscription registered below

  on("test:double", handler);
  emit("test:double");
  expect(ran).toEqual(["h"]);
});

test("off() removes ONE registration, so a double-init needs a double teardown", () => {
  // This is H8's own scenario: an init called twice registers the same function
  // twice. Matching Node's removeListener, off() drops one instance — a filter-
  // based rewrite would drop both and silently unsubscribe the live one too.
  const ran = [];
  const handler = () => ran.push("h");
  on("test:dupe", handler);
  on("test:dupe", handler);

  off("test:dupe", handler);
  emit("test:dupe");
  expect(ran).toEqual(["h"]);

  off("test:dupe", handler);
  emit("test:dupe");
  expect(ran).toEqual(["h"]);
});

test("a handler that unsubscribes mid-dispatch still gets the emit it is part of, then stops", () => {
  // Documents the snapshot trade deliberately: emit() iterates a copy, so
  // removal lands from the next emit. Pinned so the semantic is a decision, not
  // an accident someone later "fixes" into an O(n^2) membership check.
  const ran = [];
  let unsubscribeB;
  on("test:mid", () => {
    ran.push("a");
    unsubscribeB();
  });
  unsubscribeB = on("test:mid", () => ran.push("b"));

  emit("test:mid");
  expect(ran).toEqual(["a", "b"]);

  emit("test:mid");
  expect(ran).toEqual(["a", "b", "a"]);
});
