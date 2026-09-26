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
  // The base's projects carry their own testIgnore (verify/**): inherited, they
  // would empty this suite — the contrast gate passing on zero tests.
  projects: undefined,
  timeout: 90_000
};
