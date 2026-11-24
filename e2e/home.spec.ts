import { expect, test } from "@playwright/test";
import { restoreSeed } from "./restore-seed";
import { expectNoHorizontalScroll } from "./page-checks";

test.use({ viewport: { width: 390, height: 844 } });

test("Sam signs in and sees Checking, the House fund and its Goal on Home at phone width", async ({ page }) => {
  await restoreSeed(page);
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "Sign in as" })).toBeVisible();
  await page.getByRole("button", { name: "Sam Calloway" }).click();

  await expect(page.getByRole("heading", { name: "Home" })).toBeVisible();
  await expect(page.getByText("Thursday 19 November")).toBeVisible();
  const checking = page.getByRole("region", { name: "Checking" });
  await expect(checking).toContainText("$227.00");
  // On the seed day, payday is tomorrow, so no bills fall before it.
  await expect(checking).toContainText("Heads up: you’ll dip $1,273.00 below your buffer before payday");
  await expect(page.getByRole("region", { name: "Bills before payday" })).toContainText(
    "No bills due before payday on Fri 20 Nov.",
  );
  const houseFund = page.getByRole("region", { name: "House fund" });
  await expect(houseFund).toContainText("$12,400.00");
  await expect(houseFund).toContainText("31% of $40,000.00");
  await expect(houseFund.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "31");

  await expectNoHorizontalScroll(page);
});

test("Signing in as Priya shows her balances, not Sam's", async ({ page }) => {
  await restoreSeed(page);
  await page.goto("/sign-in");
  await page.getByRole("button", { name: "Priya Natarajan" }).click();

  await expect(page.getByRole("region", { name: "Checking" })).toContainText("$1,836.42");
  await expect(page.getByRole("region", { name: "Travel fund" })).toContainText("$2,150.00");
  await expect(page.getByText("House fund")).toHaveCount(0);
});

test("Home shows the 30-day Forecast with the Buffer and its lowest point, above what the agent did", async ({ page }) => {
  await restoreSeed(page);
  await page.goto("/sign-in");
  await page.getByRole("button", { name: "Sam Calloway" }).click();

  const forecast = page.getByRole("region", { name: "30-day Forecast" });
  await expect(forecast.getByRole("img")).toBeVisible();
  await expect(forecast).toContainText("Buffer $1,500");
  await expect(forecast).toContainText(
    "Lowest balance in the next 30 days: -$321.82 on Thu 3 Dec. That is $1,821.82 below your $1,500.00 Buffer.",
  );
  await expect(forecast).toContainText("a Daily allowance of $130.13 for usual spending");

  const headings = await page.getByRole("heading", { level: 2 }).allTextContents();
  expect(headings.indexOf("30-day Forecast")).toBe(headings.indexOf("What your agent did") - 1);

  const chartWidth = await forecast.getByRole("img").evaluate((svg) => svg.getBoundingClientRect().width);
  expect(chartWidth).toBeLessThanOrEqual(390);
  await expectNoHorizontalScroll(page);
});
