import { expect, test, type Page } from "@playwright/test";
import { restoreSeed } from "./restore-seed";
import { turnOnAgentAskingFirst } from "./setup-survey";
import { expectNoHorizontalScroll } from "./page-checks";

test.use({ viewport: { width: 390, height: 844 } });

/** Signs in as Sam, chooses Ask me before everything, and moves the clock to payday, so the paycheck makes a sweep Finding. */
async function samWithSweepFinding(page: Page): Promise<void> {
  await page.goto("/sign-in");
  await page.getByRole("button", { name: "Sam Calloway" }).click();
  await page.getByRole("link", { name: "Agent & limits" }).click();
  await page.getByRole("link", { name: "Run setup again" }).click();
  await turnOnAgentAskingFirst(page);
  await page.getByRole("link", { name: "Simulator" }).click();
  await page.getByRole("button", { name: "Advance clock one day" }).click();
  await expect(page.getByRole("status")).toContainText("Posted your Acme Corp paycheck");
}

test("Sam's sweep Finding shows on Discoveries with its Sources, and the nav badge and Home card count it", async ({ page }) => {
  await restoreSeed(page);
  await samWithSweepFinding(page);

  await page.goto("/");
  const discoveriesLink = page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: /Discoveries/ });
  // The sweep Finding, and Sam's two seeded Subscription price rise Findings.
  await expect(discoveriesLink).toContainText("3");
  const card = page.getByRole("link", { name: /Your agent found 3 things/ });
  await expect(card).toContainText("Nothing changes unless you choose.");
  await expectNoHorizontalScroll(page);

  await card.click();
  await expect(page.getByRole("heading", { name: "Discoveries", level: 1 })).toBeVisible();
  const finding = page.getByRole("region", { name: "$340.00 above your Buffer in Checking" });
  await expect(finding).toContainText("$3,240.00 from Acme Corp");
  await expect(finding).toContainText("Source: From your paycheck deposit");
  await expect(finding).toContainText("Source: From your Rules");
  await expect(finding.getByRole("button", { name: /Move \$340 to House fund.*Moves \$340 from Checking now/ })).toBeVisible();
  await expect(finding.getByRole("button", { name: /Leave it in Checking.*Nothing moves/ })).toBeVisible();
  // A sweep Finding has no Agent's view, so there is nothing to reveal.
  await expect(finding.getByText("What would the agent pick?")).toHaveCount(0);
  await expectNoHorizontalScroll(page);

  await finding.getByRole("button", { name: /Leave it in Checking/ }).click();
  await expect(finding).toContainText("You chose: Leave it in Checking");
  await expect(discoveriesLink).toContainText("2");
  await page.goto("/");
  await expect(page.getByRole("link", { name: /Your agent found 2 things/ })).toBeVisible();
});

test("with no open Findings, Discoveries says so and shows the Advice setting", async ({ page }) => {
  await restoreSeed(page);
  await page.goto("/sign-in");
  await page.getByRole("button", { name: "Priya Natarajan" }).click();
  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Discoveries" }).click();

  await expect(page.getByText("Your agent hasn’t found anything yet.")).toBeVisible();
  await expect(page.getByRole("region", { name: "Advice setting" })).toContainText("the agent's view only if I ask");
  await expectNoHorizontalScroll(page);
});
