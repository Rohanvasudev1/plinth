import { expect, test } from "@playwright/test";
import { openFromMoreMenu } from "./nav";
import { expectNoHorizontalScroll } from "./page-checks";
import { restoreSeed } from "./restore-seed";

test.use({ viewport: { width: 390, height: 844 } });

test("Sam finds the paycheck check in the access log, and turning on Keep chat history is in the Decision log", async ({ page }) => {
  await restoreSeed(page);
  await page.goto("/sign-in");
  await page.getByRole("button", { name: "Sam Calloway" }).click();

  // The clock starts on Thursday 19 November. Moving it to Friday 20 November posts Sam's paycheck, which the agent checks.
  await openFromMoreMenu(page, "Simulator");
  await page.getByRole("button", { name: "Advance clock one day" }).click();
  await expect(page.getByRole("status")).toContainText("Posted your Acme Corp paycheck of $3,240.00 for 2026-11-20.");

  await openFromMoreMenu(page, "Privacy");
  await expect(page.getByRole("heading", { name: "Privacy", level: 1 })).toBeVisible();
  const log = page.getByRole("region", { name: "Access log" });
  const newest = log.getByRole("listitem").first();
  await expect(newest).toContainText("Your agent");
  await expect(newest).toContainText("Fri 20 Nov");
  await expect(newest).toContainText("$3,240.00 from Acme Corp");
  await expectNoHorizontalScroll(page);

  const choices = page.getByRole("region", { name: "Data choices" });
  await expect(choices).toContainText("Plinth doesn’t train models on your data or share it with partners today");
  await expect(choices).toContainText("Applies once Ask Plinth exists");
  await expect(choices).not.toContainText("Advice");
  const keepChats = choices.getByRole("switch", { name: "Keep chat history" });
  await expect(keepChats).toHaveAttribute("aria-checked", "false");
  await keepChats.click();
  await expect(keepChats).toHaveAttribute("aria-checked", "true");
  await expect(choices.getByRole("switch", { name: "Train models on my data" })).toHaveAttribute("aria-checked", "false");

  await openFromMoreMenu(page, "Decision log");
  await expect(page.getByRole("article", { name: "Changed your settings: Keep chat history" })).toBeVisible();
});

test("Alex, who hasn't finished setup, sees each Data choice as off with a link to the Setup survey", async ({ page }) => {
  await restoreSeed(page);
  await page.goto("/sign-in");
  await page.getByRole("button", { name: "Alex Okafor" }).click();
  await openFromMoreMenu(page, "Privacy");

  const choices = page.getByRole("region", { name: "Data choices" });
  await expect(choices.getByRole("switch")).toHaveCount(0);
  await expect(choices).toContainText("Keep chat history");
  await expect(choices.getByRole("link", { name: "Set them in the Setup survey" })).toHaveAttribute("href", "/setup");
  await expect(page.getByRole("region", { name: "Access log" })).toContainText("Nothing has read your data yet.");
  await expectNoHorizontalScroll(page);
});

test.describe("without JavaScript", () => {
  test.use({ javaScriptEnabled: false });

  test("the More menu opens and its links work", async ({ page }) => {
    await restoreSeed(page);
    await page.goto("/sign-in");
    await page.getByRole("button", { name: "Sam Calloway" }).click();
    await expect(page.getByRole("heading", { name: "Home" })).toBeVisible();

    await openFromMoreMenu(page, "Privacy");
    await expect(page.getByRole("heading", { name: "Privacy", level: 1 })).toBeVisible();
    await expectNoHorizontalScroll(page);
  });
});
