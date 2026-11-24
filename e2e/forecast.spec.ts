import { expect, type Page, test } from "@playwright/test";
import { restoreSeed } from "./restore-seed";

test.use({ viewport: { width: 390, height: 844 } });

async function expectNoHorizontalScroll(page: Page) {
  const overflows = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  expect(overflows).toBe(false);
}

async function signInAs(page: Page, name: string) {
  await page.goto("/sign-in");
  await page.getByRole("button", { name }).click();
}

test("Forecast shows Sam's Usual month, November On pace, left to save and each Category", async ({ page }) => {
  await restoreSeed(page);
  await signInAs(page, "Sam Calloway");
  await expect(page.getByRole("heading", { name: "Home" })).toBeVisible();

  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Forecast" }).click();
  await expect(page.getByRole("heading", { name: "Forecast", level: 1 })).toBeVisible();

  await expect(page.getByRole("region", { name: "Comes in each month" })).toContainText("$7,020.00");
  await expect(page.getByRole("region", { name: "Usual spending" })).toContainText("$5,108.00");
  await expect(page.getByRole("region", { name: "Usual spending" })).toContainText("Average of the last 6 full months");
  const onPace = page.getByRole("region", { name: "November, on pace for" });
  await expect(onPace).toContainText("$7,570.42");
  await expect(onPace).toContainText("$2,462.42 more than usual");
  await expect(page.getByRole("region", { name: "Left to save" })).toContainText("$1,912.00 → -$550.42");

  const shopping = page.getByRole("table", { name: "November compared with your Usual month" }).getByRole("row", { name: /Shopping/ });
  await expect(shopping).toContainText("$1,320.00");
  await expect(shopping).toContainText("$2,701.82");
  await expect(shopping).toContainText("+$1,381.82");
  await expect(page.getByRole("link", { name: "Forecast", exact: true })).toHaveAttribute("aria-current", "page");
  await expectNoHorizontalScroll(page);
});

test("Forecast tells Alex there isn't enough history yet, and shows no numbers", async ({ page }) => {
  await restoreSeed(page);
  await signInAs(page, "Alex Okafor");
  await expect(page.getByRole("navigation", { name: "Main" })).toBeVisible();
  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Forecast" }).click();

  await expect(page.getByRole("heading", { name: "Not enough history yet" })).toBeVisible();
  await expect(page.getByRole("main")).not.toContainText("$");
  await expectNoHorizontalScroll(page);
});
