import { expect, test } from "@playwright/test";
import { openFromMoreMenu } from "./nav";
import { expectNoHorizontalScroll } from "./page-checks";
import { restoreSeed } from "./restore-seed";

test.use({ viewport: { width: 390, height: 844 } });

test("Sam asks what he owes, and the Mission reads his Linked accounts, cites them and logs the read", async ({ page }) => {
  await restoreSeed(page);
  await page.goto("/sign-in");
  await page.getByRole("button", { name: "Sam Calloway" }).click();
  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Discoveries" }).click();

  const box = page.getByRole("region", { name: "Ask your agent" });
  await box.getByLabel("Your question").fill("What do I owe?");
  await box.getByRole("button", { name: "Look into it" }).click();

  const finding = page.getByRole("region", { name: "You owe $17,110.55 across 2 Linked accounts" });
  await expect(finding).toBeVisible({ timeout: 15_000 });
  await expect(finding).toContainText("Summit Card credit card");
  await expect(finding).toContainText("$2,310.55 owed");
  await expect(finding).toContainText(
    "Source: From your Linked accounts at Summit Card, Northwind and Keystone Student Lending, last synced Thu 19 Nov",
  );
  await expectNoHorizontalScroll(page);

  await openFromMoreMenu(page, "Decision log");
  const entry = page.getByRole("article", { name: /Reported back: “You owe \$17,110.55/ });
  await entry.getByText("Why?").click();
  await expect(entry).toContainText("Linked accounts");

  await openFromMoreMenu(page, "Privacy");
  const newest = page.getByRole("region", { name: "Access log" }).getByRole("listitem").first();
  await expect(newest).toContainText("Your agent");
  await expect(newest).toContainText("Linked accounts");
  await expect(newest).toContainText("To answer your Mission: “What do I owe?”");
});
