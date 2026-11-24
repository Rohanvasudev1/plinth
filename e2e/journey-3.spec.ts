import { expect, test } from "@playwright/test";
import { restoreSeed } from "./restore-seed";

test.use({ viewport: { width: 390, height: 844 } });

test("Journey 3: Sam checks the Forecast, tries the slider, and after payday finds the paycheck and the agent's sweep in Activity", async ({ page }) => {
  await restoreSeed(page);

  // 1. Sam signs in. The clock starts on Thursday 19 November.
  await page.goto("/sign-in");
  await page.getByRole("button", { name: "Sam Calloway" }).click();
  await expect(page.getByRole("heading", { name: "Home" })).toBeVisible();
  const nav = page.getByRole("navigation", { name: "Main" });

  // 2. On Forecast, the Usual month is May to October, and November is on pace to spend more.
  await nav.getByRole("link", { name: "Forecast", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Forecast", level: 1 })).toBeVisible();
  await expect(page.getByRole("region", { name: "Comes in each month" })).toContainText("$7,020.00");
  await expect(page.getByRole("region", { name: "Usual spending" })).toContainText("$5,108.00");
  await expect(page.getByRole("region", { name: "November, on pace for" })).toContainText("$6,628.47");
  await expect(page.getByRole("region", { name: "Left to save" })).toContainText("$1,912.00 → $391.53");

  // 3. The slider starts at a 20% cut. Moving it to 50% changes the "with your changes" line of the Projection summary.
  const projection = page.getByRole("region", { name: "3-year Projection of your House fund" });
  const withChanges = projection.getByTestId("with-changes");
  await expect(withChanges).toContainText("saving $1,117.74 a month: $52,638.64");
  await projection.getByLabel(/Try it: cut Eating out and Shopping by/).fill("50");
  await expect(withChanges).toContainText("saving $2,207.05 a month: $91,853.80");

  // 4. Advancing the clock to Friday 20 November posts Sam's paycheck, and the agent sweeps $340.
  await nav.getByRole("link", { name: "Simulator (testing tool)" }).click();
  await page.getByRole("button", { name: "Advance clock one day" }).click();
  await expect(page.getByRole("status")).toContainText("Posted your Acme Corp paycheck of $3,240.00 for 2026-11-20.");

  // 5. Activity lists the sweep with the Agent tag, then the paycheck as Income: newest first.
  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Activity", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Activity" })).toBeVisible();
  const rows = page.getByRole("table", { name: "Activity" }).getByRole("row");
  const sweep = rows.nth(1);
  const paycheck = rows.nth(2);
  await expect(sweep).toContainText("House fund");
  await expect(sweep).toContainText("-$340.00");
  await expect(sweep.getByText("Agent", { exact: true })).toBeVisible();
  await expect(paycheck).toContainText("Acme Corp");
  await expect(paycheck).toContainText("Income");
  await expect(paycheck).toContainText("+$3,240.00");
  await expect(paycheck.getByText("Agent", { exact: true })).toHaveCount(0);

  const overflows = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  expect(overflows).toBe(false);
});
