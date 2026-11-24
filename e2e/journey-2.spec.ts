import { expect, test } from "@playwright/test";
import { restoreSeed } from "./restore-seed";
import { turnOnAgentAskingFirst } from "./setup-survey";
import { expectNoHorizontalScroll } from "./page-checks";
import { advanceClock } from "./simulator";

test.use({ viewport: { width: 390, height: 844 } });

test("Journey 2: Alex sets up the agent to ask first, picks Move on the sweep Finding, pauses, and the next sweep is refused", async ({ page }) => {
  await restoreSeed(page);

  // 1. Alex signs in and completes the survey with Ask me before everything and Buy a home as the only goal.
  await page.goto("/sign-in");
  await page.getByRole("button", { name: "Alex Okafor" }).click();
  await expect(page.getByText("Step 1 of 6")).toBeVisible();
  await page.getByRole("checkbox", { name: /Buy a home/ }).check();
  await turnOnAgentAskingFirst(page);
  await expect(page.getByRole("region", { name: "House fund", exact: true })).toContainText("$0.00");

  // 2. Advance the clock from Thursday 19 Nov to Friday 27 Nov, Alex's first payday.
  const payday = await advanceClock(page, "2026-11-19", "2026-11-27");
  expect(payday).toContain("Posted your Acme Corp paycheck of $2,100.00 for 2026-11-27.");

  // 3. Checking holds $400 + $2,100, so the Finding offers the $1,000 above the $1,500 Buffer. Alex picks Move.
  await page.getByRole("link", { name: "Home" }).click();
  const finding = page.getByRole("region", { name: "$1,000.00 above your Buffer in Checking" });
  await expect(finding).toBeVisible();
  const headings = await page.getByRole("heading", { level: 2 }).allTextContents();
  expect(headings[0]).toBe("$1,000.00 above your Buffer in Checking");
  await expect(page.getByRole("region", { name: "House fund", exact: true })).toContainText("$0.00");
  await expectNoHorizontalScroll(page);
  await finding.getByRole("button", { name: /Move \$1,000 to House fund/ }).click();
  await expect(finding).toContainText("You chose: Move $1,000 to House fund");
  await expect(page.getByRole("region", { name: "House fund", exact: true })).toContainText("$1,000.00");

  // 4. The move is Done in the Decision log.
  await page.getByRole("link", { name: "Decision log" }).click();
  const moved = page.getByRole("article", { name: "Moved $1,000 to House fund" });
  await expect(moved).toContainText("Done");
  await moved.getByText("Why?").click();
  await expect(moved).toContainText("You picked “Move $1,000 to House fund”");

  // 5. Pause on Agent & limits.
  await page.goto("/agent");
  await page.getByRole("button", { name: "Pause agent" }).click();
  await expect(page.getByRole("region", { name: "Your agent is paused" }).getByRole("status")).toHaveText(
    "Agent paused. Nothing will happen automatically.",
  );

  // 6. Advance to the next payday, 14 days later.
  const nextPayday = await advanceClock(page, "2026-11-27", "2026-12-11");
  expect(nextPayday).toContain("Posted your Acme Corp paycheck of $2,100.00 for 2026-12-11.");

  // 7. The Decision log shows the sweep Refused with Agent paused, and nothing moved.
  await page.goto("/decision-log");
  const refused = page.getByRole("article", { name: "Move $2,100 to House fund" });
  await expect(refused).toContainText("Refused");
  await refused.getByText("Why?").click();
  await expect(refused).toContainText("Agent paused");
  await page.goto("/");
  await expect(page.getByRole("region", { name: "Your agent is paused" })).toBeVisible();
  await expect(page.getByRole("region", { name: "House fund", exact: true })).toContainText("$1,000.00");
});
