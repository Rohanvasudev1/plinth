import { expect, test, type Page } from "@playwright/test";
import { restoreSeed } from "./restore-seed";
import { expectNoHorizontalScroll } from "./page-checks";

test.use({ viewport: { width: 390, height: 844 } });

const QUESTION = "Could I take 3 months off work next summer?";
const MISSION_FINDING = "3 months without pay would take about $15,324.00 of spending";
// The scripted fake reminds on the first of the month about three months out: from Thursday 19 November 2026,
// that is Monday 1 February 2027.
const REMINDER_DATE = "2027-02-01";

/**
 * Presses "Advance clock one day" on the Simulator until the simulated clock reaches `date`, checking that each
 * press moves it exactly one day from Thursday 19 November 2026, where the seed starts it.
 */
async function advanceClockTo(page: Page, date: string): Promise<void> {
  const status = page.getByRole("status");
  const day = new Date("2026-11-19T12:00:00Z");
  while (day.toISOString().slice(0, 10) < date) {
    day.setUTCDate(day.getUTCDate() + 1);
    await page.getByRole("button", { name: "Advance clock one day" }).click();
    await expect(status).toContainText(`Moved the clock to ${day.toISOString().slice(0, 10)}.`);
  }
}

test("Journey 4: Sam sends a Mission, asks for the Agent's view, is reminded, keeps Tunewell and stops looking at price rises", async ({ page }) => {
  test.setTimeout(240_000);
  await restoreSeed(page);

  await page.goto("/sign-in");
  await page.getByRole("button", { name: "Sam Calloway" }).click();
  await expect(page.getByRole("heading", { name: "Home" })).toBeVisible();
  const nav = page.getByRole("navigation", { name: "Main" });
  await nav.getByRole("link", { name: /Discoveries/ }).click();
  await expect(page.getByRole("heading", { name: "Discoveries", level: 1 })).toBeVisible();

  // 1. Sam asks the question. The Mission runs with its progress label, then reports one Finding.
  const box = page.getByRole("region", { name: "Ask your agent" });
  await box.getByLabel("Your question").fill(QUESTION);
  await box.getByRole("button", { name: "Look into it" }).click();
  const inProgress = page.getByRole("region", { name: "In progress" });
  await expect(inProgress).toContainText(QUESTION);
  await expect(inProgress.getByRole("status")).toHaveText(/Reading your transactions|Checking your|Writing up/);
  await expectNoHorizontalScroll(page);

  const finding = page.getByRole("region", { name: MISSION_FINDING });
  await expect(finding).toBeVisible({ timeout: 15_000 });
  await expect(inProgress).toHaveCount(0);
  await expect(finding).toContainText("From a Mission you sent");
  await expect(finding).toContainText("Open");

  // 2. Every fact names its Source.
  const facts = finding.locator("dl.facts > div");
  const factCount = await facts.count();
  expect(factCount).toBeGreaterThan(0);
  for (let index = 0; index < factCount; index += 1) {
    await expect(facts.nth(index).locator(".source")).toHaveText(/^Source: \S/);
  }
  await expectNoHorizontalScroll(page);

  // 3. The default Advice setting is "on request": the Agent's view is hidden until Sam asks for it.
  await expect(page.getByRole("region", { name: "Advice setting" })).toContainText("the agent's view only if I ask");
  const agentsView = finding.getByText(/^I would pick Remind me on Mon 1 Feb/);
  await expect(agentsView).toBeHidden();
  await finding.getByText("What would the agent pick?").click();
  await expect(agentsView).toBeVisible();

  // 4. Sam picks Remind me. The Finding is snoozed until its date, then opens again when the clock gets there.
  await finding.getByRole("button", { name: /Remind me on Mon 1 Feb/ }).click();
  await expect(finding).toContainText("Snoozed until Mon 1 Feb");
  await expectNoHorizontalScroll(page);

  await nav.getByRole("link", { name: "Simulator (testing tool)" }).click();
  await advanceClockTo(page, REMINDER_DATE);

  await nav.getByRole("link", { name: /Discoveries/ }).click();
  await expect(finding).toBeVisible();
  await expect(finding.locator(".pill")).toHaveText("Open");
  await expect(finding).not.toContainText("Snoozed until");
  await expect(finding.getByRole("button", { name: /Not now/ })).toBeVisible();

  await page.getByRole("link", { name: "Decision log" }).click();
  const reopened = page.getByRole("article", { name: new RegExp(`Showed you “${MISSION_FINDING.replace(/[$.,]/g, "\\$&")}” again`) });
  await expect(reopened).toBeVisible();
  await reopened.getByText("Why?").click();
  await expect(reopened).toContainText("You asked to be reminded on Mon 1 Feb");

  // 5. Sam keeps paying for Tunewell.
  await nav.getByRole("link", { name: /Discoveries/ }).click();
  const tunewell = page.getByRole("region", { name: "Tunewell Streaming went up from $15.00 to $18.00" });
  await tunewell.getByRole("button", { name: /Keep paying/ }).click();
  await expect(tunewell).toContainText("You chose: Keep paying");

  // 6. Sam switches Subscription price rises off. The Clipreel Finding expires; the Tunewell pick stands.
  const clipreel = page.getByRole("region", { name: "Your Clipreel free trial turned paid at $12.99" });
  await expect(clipreel.locator(".pill")).toHaveText("Open");
  const toggle = page
    .getByRole("region", { name: "Standing searches" })
    .getByRole("switch", { name: "Subscription price rises" });
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-checked", "false");
  await expect(clipreel).toContainText("Expired");
  await expect(tunewell).toContainText("You chose: Keep paying");
  await expect(finding.locator(".pill")).toHaveText("Open");

  await expectNoHorizontalScroll(page);
});
