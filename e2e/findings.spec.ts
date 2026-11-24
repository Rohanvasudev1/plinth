import { expect, test, type Page } from "@playwright/test";
import { restoreSeed } from "./restore-seed";
import { turnOnAgentAskingFirst } from "./setup-survey";
import { expectNoHorizontalScroll } from "./page-checks";
import { openFromMoreMenu } from "./nav";

test.use({ viewport: { width: 390, height: 844 } });

/** Signs in as Sam and runs setup again from Agent & limits, keeping every answer but choosing Ask me before everything. */
async function signInAsSamAskingFirst(page: Page): Promise<void> {
  await page.goto("/sign-in");
  await page.getByRole("button", { name: "Sam Calloway" }).click();
  await openFromMoreMenu(page, "Agent & limits");
  await page.getByRole("link", { name: "Run setup again" }).click();
  await turnOnAgentAskingFirst(page);
}

test("with Ask me before everything, Sam's sweep becomes a Finding on Home, and picking Move sweeps", async ({ page }) => {
  await restoreSeed(page);
  await signInAsSamAskingFirst(page);

  // The clock starts on Thursday 19 November. Moving it to Friday 20 November posts Sam's paycheck.
  await openFromMoreMenu(page, "Simulator");
  await page.getByRole("button", { name: "Advance clock one day" }).click();
  await expect(page.getByRole("status")).toContainText("Posted your Acme Corp paycheck");

  await page.goto("/");
  const finding = page.getByRole("region", { name: "$340.00 above your Buffer in Checking" });
  await expect(finding).toBeVisible();
  // Open Findings come first on Home, above the accounts.
  const headings = await page.getByRole("heading", { level: 2 }).allTextContents();
  expect(headings[0]).toBe("$340.00 above your Buffer in Checking");
  await expect(finding.getByRole("button", { name: /Leave it in Checking/ })).toBeVisible();
  await expect(page.getByRole("region", { name: "House fund", exact: true })).toContainText("$12,400.00");
  await expectNoHorizontalScroll(page);

  await finding.getByRole("button", { name: /Move \$340 to House fund/ }).click();
  await expect(finding).toContainText("You chose: Move $340 to House fund");
  await expect(finding.getByRole("button")).toHaveCount(0);
  await expect(page.getByRole("region", { name: "House fund", exact: true })).toContainText("$12,740.00");

  await page.goto("/decision-log");
  const done = page.getByRole("article", { name: "Moved $340 to House fund" });
  await expect(done).toContainText("Done");
  await done.getByText("Why?").click();
  await expect(done).toContainText("You picked “Move $340 to House fund”");
});

test("picking Leave it moves nothing and is in the Decision log", async ({ page }) => {
  await restoreSeed(page);
  await signInAsSamAskingFirst(page);
  await openFromMoreMenu(page, "Simulator");
  await page.getByRole("button", { name: "Advance clock one day" }).click();
  await expect(page.getByRole("status")).toContainText("Posted your Acme Corp paycheck");

  await page.goto("/");
  const finding = page.getByRole("region", { name: /above your Buffer/ });
  await finding.getByRole("button", { name: /Leave it in Checking/ }).click();
  await expect(finding).toContainText("You chose: Leave it in Checking");
  await expect(page.getByRole("region", { name: "House fund", exact: true })).toContainText("$12,400.00");

  await page.goto("/decision-log");
  await expect(page.getByRole("article", { name: "Left the money in Checking" })).toContainText("You");
});
