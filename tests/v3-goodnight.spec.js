import { test, expect } from "./fixtures/coverage.js";
import { bootV3 } from "./fixtures/v3boot.js";
import { goodnightMessage } from "../src/js/services/goodnight.js";

/* ═══════════════════════════════════════════════════════════════════════════
   GOODNIGHT ON V3 — the fourth thing the cutover disarmed.

   `action.goodnight` has matched in localIntents.js since long before V3, and
   services/vocabulary.js has it in ALWAYS_TRUE, so the wall's own "what can I
   say" card advertises it. On V3 it reached `answer()`, which has no `action.*`
   case by design, and fell through to Assist and then to the model — a pleasant
   chat about bedtime, no scene, no dimming.

   ⚠ WHAT MAKES THIS CLASS OF DEFECT SURVIVE TESTS: tests/local-voice.spec.js
   proves the MATCHER answers "goodnight" with `action.goodnight`, and it always
   did. The intent matched perfectly and then nothing was listening. So every
   assertion here is about what the turn DOES — a POST that leaves the page, a
   sentence that reaches the glass, a depth that changes — and none of them is
   about whether the words were recognised.

   ⚠ NEUTER-VERIFIED, and the result is worth recording exactly. With the
   `action.goodnight` branch removed from v3/core/voice.js, tests 1 and 3 go
   red — those are the two that assert the fix. Test 2 stays GREEN, because it
   asserts the flag-OFF state and that state is precisely what the wall has been
   doing since the cutover; a rollback assertion that failed against the unfixed
   source would be asserting the wrong thing. Test 4 is pure and never loads
   voice.js at all (it went red against the old buildMessage, which threw on
   null rather than handling it).
   ═══════════════════════════════════════════════════════════════════════════ */

const HA_SCRIPT = "/api/ha/services/script/turn_on";

/** Tomorrow at 09:30 local, as the calendar feed writes it. */
function tomorrowAt(hour, minute) {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(hour, minute, 0, 0);
  return d.toISOString();
}

const CALENDAR = { events: [{ title: "Dentist", start: tomorrowAt(9, 30) }] };

/** Every request the page makes, so the HA call can be asserted on by its
 *  absence as well as its presence. A route handler would work for the
 *  positive case and prove nothing about the negative one. */
function recordRequests(page) {
  const seen = [];
  page.on("request", (req) => seen.push(`${req.method()} ${new URL(req.url()).pathname}`));
  return seen;
}

/* ⚠ EVERY VALUE THE SAID LINE EVER HELD, not the one it holds at the end.
   Sampling `#glance-said` after the turn reads an EMPTY node and looks exactly
   like a line that was never written — attention.js clears the glance cell on
   arrival at depth 0 ("nothing is shown at the field, so nothing may be left
   there"), and settling to depth 0 is the last thing this turn does. Polling
   during the turn would work and would also be a race against however long the
   speech takes. A log cannot race. */
async function watchSaid(page) {
  await page.evaluate(() => {
    window.__saidLog = [];
    const node = document.getElementById("glance-said");
    new MutationObserver(() => window.__saidLog.push(node.textContent))
      .observe(node, { childList: true, characterData: true, subtree: true });
  });
  return () => page.evaluate(() => window.__saidLog);
}

async function bootWithGoodnight(page, { features, calendar = CALENDAR }) {
  const requests = recordRequests(page);
  const { pageErrors } = await bootV3(
    page,
    {
      "/api/calendar/all": calendar,
      "/api/ha/services/": {},
      "/api/voice/": null            // no Assist and no house voice in a spec
    },
    { features }
  );
  await page.waitForFunction(() => typeof window.__v3Transcript === "function");
  return { requests, pageErrors };
}

test("goodnight fires the scene, names tomorrow, and settles the wall", async ({ page }) => {
  const { requests, pageErrors } = await bootWithGoodnight(page, {
    features: { v3Goodnight: true }
  });

  // Start deep, so the settle at the end is a real change rather than a
  // no-op that would pass on a wall already at rest.
  await page.evaluate(() => window.__setDepth(3, "spec-precondition"));
  const said = await watchSaid(page);

  const result = await page.evaluate(() => window.__v3Transcript("goodnight"));

  // Answered here, not two lanes away. The 2-4 s round trip this replaces is
  // the whole reason the fast lane exists.
  expect(result.handled).toBe(true);
  expect(result.lane).toBe("local");

  // The house acted. This is the assertion the old code could never pass: the
  // words matched all along, and nothing left the page.
  expect(requests, "script.goodnight never fired").toContain(`POST ${HA_SCRIPT}`);

  // And it read tomorrow off the calendar rather than saying something generic.
  expect(await said()).toContainEqual(
    expect.stringMatching(/^Goodnight! Tomorrow you've got Dentist at 9:30 am/)
  );

  /* Settled. Depth 0 is V3's answer to engageScreensaver({startMode:"minimal"})
     — the hour and the photograph, which is where a room that has just been
     told everyone is going to bed should be. */
  expect(await page.evaluate(() => window.__depth().depth)).toBe(0);
  expect(await page.evaluate(() => window.__depth().reason)).toBe("voice-goodnight");

  expect(pageErrors).toEqual([]);
});

test("⚠ the rollback: flag off and the turn touches nothing", async ({ page }) => {
  const { requests, pageErrors } = await bootWithGoodnight(page, {
    features: { v3Goodnight: false }
  });
  await page.evaluate(() => window.__setDepth(3, "spec-precondition"));

  const result = await page.evaluate(() => window.__v3Transcript("night night"));

  /* The rollback is asserted on the SCENE NEVER FIRING, not on the words going
     unrecognised — the matcher is pure and shared with the incumbent, so
     "goodnight" still matches with the flag off exactly as it does today. What
     the flag governs is whether anything acts on it.

     ⚠ This is the assertion that would have caught the original defect if it
     had existed: it is the same state the wall has been in since the cutover. */
  expect(requests.some((r) => r.includes(HA_SCRIPT)), "the flag-off build fired the scene").toBe(false);
  expect(result.lane).not.toBe("local");
  // Untouched, not settled — with nothing handling the turn, the surface is
  // still wherever the room left it.
  expect(await page.evaluate(() => window.__depth().depth)).toBe(3);

  expect(pageErrors).toEqual([]);
});

test("⚠ a calendar it could not read is not an empty calendar", async ({ page }) => {
  const { pageErrors } = await bootWithGoodnight(page, {
    features: { v3Goodnight: true },
    calendar: null                      // 503 — the feed is down, not empty
  });

  const said = await watchSaid(page);
  await page.evaluate(() => window.__v3Transcript("i'm going to bed"));
  const lines = (await said()).filter((t) => t.trim());

  /* The house has shipped this exact conflation before. `catch { return [] }`
     turns "we could not look" into "there is nothing on", and the line that
     produces — "a whole day with nothing to do, isn't that just decadent" — is
     a confident claim about a day nobody checked. Said at 10pm the night before
     an early flight, it is the worst thing on this surface can say. */
  expect(lines, "the house said nothing at all").not.toEqual([]);
  for (const line of lines) {
    expect(line).toContain("Goodnight!");
    expect(line, "invented an empty day out of a failed fetch").not.toMatch(/calendar tomorrow|nothing to do/i);
  }

  expect(pageErrors).toEqual([]);
});

test("the line itself: known day, empty day, unknown day", () => {
  // Pure, so it is worth pinning here rather than only through a browser.
  expect(goodnightMessage(["Dentist at 9:30 am"])).toMatch(/Tomorrow you've got Dentist at 9:30 am/);
  expect(goodnightMessage(["A", "B", "C"])).toMatch(/Tomorrow you've got A, B, and C/);
  expect(goodnightMessage([])).toMatch(/Nothing on the calendar tomorrow/);

  // null is the one that matters — see the spec above.
  expect(goodnightMessage(null)).toBe("Goodnight! Sleep well, gorgeous.");

  // Every branch ends the same way. The sign-off is the register, not a suffix.
  for (const events of [null, [], ["A"], ["A", "B"]]) {
    expect(goodnightMessage(events)).toMatch(/Sleep well, gorgeous\.$/);
  }
});
