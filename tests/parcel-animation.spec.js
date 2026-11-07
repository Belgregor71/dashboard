import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";

const source = readFileSync("src/v3/core/parcel-animation.js", "utf8").replace("../../js/core/eventBus.js", "/parcel-bus.js");
const css = readFileSync("src/v3/css/tokens.css", "utf8") + readFileSync("src/v3/css/parcels.css", "utf8");

async function preview(page, enabled = true) {
  await page.route("**/parcel-animation.js", route => route.fulfill({ contentType: "text/javascript", body: source }));
  await page.route("**/parcel-bus.js", route => route.fulfill({ contentType: "text/javascript", body: readFileSync("src/js/core/eventBus.js", "utf8") }));
  await page.route("**/parcel-preview", route => route.fulfill({ contentType: "text/html", body: `<style>${css}body{background:#242d29}</style><script>window.CONFIG={features:{v3Parcels:${enabled}}}</script><script type="module">import {initParcelAnimation} from '/parcel-animation.js';import {emit} from '/parcel-bus.js';initParcelAnimation();window.parcel=(kind='delivering',count=1)=>emit('parcel:moment',{kind,count});</script>` }));
  await page.goto("/parcel-preview");
  await page.waitForFunction(() => typeof window.parcel === "function");
}

test("parcel events show the right copy, replace rather than stack, and clean up while hidden", async ({ page }) => {
  await preview(page);
  await page.evaluate(() => window.parcel());
  const moment = page.locator(".parcel-moment");
  await expect(moment).toBeVisible();
  await expect(moment.locator("strong")).toHaveText("Parcel on its way");
  await expect(moment.locator("span")).toHaveText("1 parcel out for delivery");
  await page.waitForTimeout(1900);
  await page.screenshot({ path: "test-results/parcel-delivering.png" });
  await page.evaluate(() => window.parcel("delivered", 2));
  await expect(moment).toHaveCount(1);
  await expect(moment.locator("strong")).toHaveText("Parcel delivered");
  await expect(moment.locator("span")).toHaveText("2 parcels delivered today");
  await page.waitForTimeout(1900);
  await page.screenshot({ path: "test-results/parcel-delivered.png" });
  await page.evaluate(() => { document.body.style.display = "none"; });
  await expect(moment).toHaveCount(0, { timeout: 9000 });
});

test("flag off keeps parcel events silent", async ({ page }) => {
  await preview(page, false);
  await page.evaluate(() => window.parcel());
  await expect(page.locator(".parcel-moment")).toHaveCount(0);
});

test("reduced motion preserves the message without spatial animation", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await preview(page);
  await page.evaluate(() => window.parcel("delivered"));
  await expect(page.locator(".parcel-moment strong")).toHaveText("Parcel delivered");
  expect(await page.locator(".parcel-van").evaluate(el => getComputedStyle(el).animationName)).toBe("none");
  expect(await page.locator(".parcel-confirm").evaluate(el => getComputedStyle(el).opacity)).toBe("1");
});
