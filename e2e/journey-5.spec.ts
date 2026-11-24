import { readFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";
import { openFromMoreMenu } from "./nav";
import { expectNoHorizontalScroll } from "./page-checks";
import { restoreSeed } from "./restore-seed";

test.use({ viewport: { width: 390, height: 844 } });

async function signInAs(page: Page, name: "Sam Calloway" | "Alex Okafor"): Promise<void> {
  await page.goto("/sign-in");
  await page.getByRole("button", { name }).click();
  await expect(page).not.toHaveURL(/\/sign-in/);
}

/** The value of one of the four figures at the top of All accounts, such as Net worth. */
function figure(page: Page, label: "Cash" | "Investments" | "Debt" | "Net worth") {
  return page
    .getByRole("region", { name: "Where you stand" })
    .locator(".stat")
    .filter({ has: page.getByText(label, { exact: true }) })
    .getByRole("definition");
}

test("Journey 5: Sam sees where they stand, links Harbor, finds its Sync, keeps chat history, exports and unlinks Harbor", async ({ page }) => {
  await restoreSeed(page);
  await signInAs(page, "Sam Calloway");
  await expectNoHorizontalScroll(page);
  const nav = page.getByRole("navigation", { name: "Main" });

  // 1. All accounts shows Sam's four figures on the seed, 19 Nov 2026.
  await nav.getByRole("link", { name: "Accounts" }).click();
  await expect(page.getByRole("heading", { name: "All accounts", level: 1 })).toBeVisible();
  await expect(figure(page, "Cash")).toHaveText("$12,627.00");
  await expect(figure(page, "Investments")).toHaveText("$41,200.00");
  await expect(figure(page, "Debt")).toHaveText("-$17,110.55");
  await expect(figure(page, "Net worth")).toHaveText("$36,716.45");
  await expectNoHorizontalScroll(page);

  // 2. Sam links Harbor Credit Union. Cash and Net worth go up by its balance.
  await page.getByRole("link", { name: "Link another bank" }).click();
  await expect(page.getByRole("heading", { name: "Link another bank", level: 1 })).toBeVisible();
  await expectNoHorizontalScroll(page);
  await page.getByRole("button", { name: "Link Harbor Credit Union" }).click();
  await expect(page.getByRole("heading", { name: "All accounts", level: 1 })).toBeVisible();
  await expect(figure(page, "Cash")).toHaveText("$14,767.00");
  await expect(figure(page, "Net worth")).toHaveText("$38,856.45");
  await expect(page.getByRole("table", { name: "Accounts" })).toContainText("Harbor Credit Union");
  await expectNoHorizontalScroll(page);

  // 3. On Privacy, the newest access log entry is Plinth's Sync of the Harbor balance.
  await openFromMoreMenu(page, "Privacy");
  await expect(page.getByRole("heading", { name: "Privacy", level: 1 })).toBeVisible();
  const newest = page.getByRole("region", { name: "Access log" }).getByRole("listitem").first();
  await expect(newest).toContainText("Plinth");
  await expect(newest).toContainText("Your Harbor Credit Union checking balance");
  await expectNoHorizontalScroll(page);

  // 4. Sam turns on Keep my chat history, and the Decision log records the change.
  const keepChats = page.getByRole("region", { name: "Data choices" }).getByRole("switch", { name: "Keep chat history" });
  await expect(keepChats).toHaveAttribute("aria-checked", "false");
  await keepChats.click();
  await expect(keepChats).toHaveAttribute("aria-checked", "true");

  await openFromMoreMenu(page, "Decision log");
  await expect(page.getByRole("article", { name: "Changed your settings: Keep chat history" })).toBeVisible();
  await expectNoHorizontalScroll(page);

  // 5. Sam exports, and the download is JSON.
  await openFromMoreMenu(page, "Privacy");
  const downloading = page.waitForEvent("download");
  await page.getByRole("region", { name: "Export" }).getByRole("button", { name: "Export my data" }).click();
  const download = await downloading;
  expect(download.suggestedFilename()).toMatch(/\.json$/);
  const file = JSON.parse(await readFile(await download.path(), "utf8"));
  expect(file.customer.name).toBe("Sam Calloway");

  // 6. Sam unlinks Harbor and is told Plinth deleted its copy.
  await nav.getByRole("link", { name: "Accounts" }).click();
  await expect(page.getByRole("heading", { name: "All accounts", level: 1 })).toBeVisible();
  await page.getByRole("button", { name: "Unlink Harbor Credit Union" }).click();
  await expect(page.getByRole("status")).toContainText("Plinth deleted its copy of that data");
  await expect(page.getByRole("table", { name: "Accounts" })).not.toContainText("Harbor Credit Union");
  await expect(figure(page, "Net worth")).toHaveText("$36,716.45");
  await expectNoHorizontalScroll(page);
});

test("Journey 5: Alex closes and deletes after seeing the $400.00 payout, and Sign in as says This account is closed", async ({ page }) => {
  await restoreSeed(page);
  await signInAs(page, "Alex Okafor");
  await expectNoHorizontalScroll(page);

  await openFromMoreMenu(page, "Privacy");
  await expect(page.getByRole("heading", { name: "Privacy", level: 1 })).toBeVisible();
  await expectNoHorizontalScroll(page);
  await page.getByRole("region", { name: "Close and delete" }).getByRole("link", { name: "Close and delete" }).click();

  await expect(page.getByRole("heading", { name: "Close and delete", level: 1 })).toBeVisible();
  await expect(page.getByRole("region", { name: "Payout" })).toContainText("$400.00 paid out to you");
  await expectNoHorizontalScroll(page);
  await page.getByRole("button", { name: "Close and delete my account" }).click();

  await expect(page).toHaveURL(/\/sign-in/);
  await expect(page.getByRole("main").getByRole("alert")).toHaveText("This account is closed");
  await expectNoHorizontalScroll(page);

  await page.getByRole("button", { name: "Alex Okafor" }).click();
  await expect(page.getByRole("main").getByRole("alert")).toHaveText("This account is closed");
  await expect(page).toHaveURL(/\/sign-in/);
});
