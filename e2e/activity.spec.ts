import { expect, type Page, test } from "@playwright/test";
import { restoreSeed } from "./restore-seed";

test.use({ viewport: { width: 390, height: 844 } });

async function expectNoHorizontalScroll(page: Page) {
  const overflows = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  expect(overflows).toBe(false);
}

test("Activity shows Sam's paycheck as Income and the agent's $340 sweep with the Agent tag, newest first", async ({ page }) => {
  await restoreSeed(page);
  await page.goto("/sign-in");
  await page.getByRole("button", { name: "Sam Calloway" }).click();

  // The clock starts on Thursday 19 November. Moving it to Friday 20 November posts Sam's paycheck, and the agent sweeps.
  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Simulator" }).click();
  await page.getByRole("button", { name: "Advance clock one day" }).click();
  await expect(page.getByRole("status")).toContainText("Posted your Acme Corp paycheck of $3,240.00 for 2026-11-20.");

  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Activity" }).click();
  await expect(page.getByRole("heading", { name: "Activity" })).toBeVisible();

  const rows = page.getByRole("table", { name: "Activity" }).getByRole("row");
  // The header row, then the sweep, then the paycheck: newest first.
  const sweep = rows.nth(1);
  const paycheck = rows.nth(2);
  await expect(sweep).toContainText("House fund");
  await expect(sweep).toContainText("Savings");
  await expect(sweep).toContainText("-$340.00");
  await expect(sweep.getByText("Agent", { exact: true })).toBeVisible();
  await expect(paycheck).toContainText("Acme Corp");
  await expect(paycheck).toContainText("Income");
  await expect(paycheck).toContainText("+$3,240.00");
  await expect(paycheck.getByText("Agent", { exact: true })).toHaveCount(0);

  await expect(page.getByRole("button", { name: /Dispute|Split/ })).toHaveCount(0);
  await expect(page.getByRole("link", { name: /Dispute|Split/ })).toHaveCount(0);
  await expectNoHorizontalScroll(page);
});

test("every signed-in page has the nav bar, and it fits at 390px", async ({ page }) => {
  await restoreSeed(page);
  await page.goto("/sign-in");
  await page.getByRole("button", { name: "Sam Calloway" }).click();
  await expect(page.getByRole("heading", { name: "Home" })).toBeVisible();

  for (const path of ["/", "/activity", "/forecast", "/agent", "/decision-log", "/simulator", "/setup"]) {
    await page.goto(path);
    const nav = page.getByRole("navigation", { name: "Main" });
    for (const name of ["Home", "Activity", "Forecast", "Agent & limits"]) {
      await expect(nav.getByRole("link", { name, exact: true })).toBeVisible();
    }
    await expect(nav.getByRole("link", { name: "Simulator (testing tool)" })).toBeVisible();
    await expectNoHorizontalScroll(page);
  }

  await page.goto("/activity");
  const nav = page.getByRole("navigation", { name: "Main" });
  await expect(nav.getByRole("link", { name: "Activity", exact: true })).toHaveAttribute("aria-current", "page");
  await nav.getByRole("link", { name: "Agent & limits", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Agent & limits" })).toBeVisible();
  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Home", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Home" })).toBeVisible();
});
