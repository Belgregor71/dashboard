import { test, expect } from "@playwright/test";
import { on, emit } from "../src/js/core/eventBus.js";

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
