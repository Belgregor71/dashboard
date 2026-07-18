import base from "./playwright.config.js";

/**
 * Pre-push verification gates (tests/verify/) — the slow, thorough checks that
 * would make `npm test` too heavy to run casually. Same server + stubbed
 * upstreams as the main suite; longer timeout because the contrast sweep takes
 * a screenshot and samples pixels per atmosphere token.
 */
export default {
  ...base,
  testDir: "tests/verify",
  // The base config ignores verify/** so `npm test` stays fast; clear that
  // here or this config would ignore its own suite.
  testIgnore: undefined,
  timeout: 90_000
};
