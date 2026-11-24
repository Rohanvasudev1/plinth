import { expect, test } from "@playwright/test";
import { restoreSeed } from "./restore-seed";
import { expectNoHorizontalScroll } from "./page-checks";
import { advanceClock } from "./simulator";
import { openFromMoreMenu } from "./nav";

test.use({ viewport: { width: 390, height: 844 } });

const QUESTION = "Could I take 3 months off work next summer?";
const MISSION_FINDING = "3 months without pay would take about $15,324.00 of spending";
// The seed starts the clock on Thursday 19 November 2026. The scripted fake's Remind me is the first of the month
// about three months out: Monday 1 February 2027.
const SEED_DATE = "2026-11-19";
const REMINDER_DATE = "2027-02-01";

test("Journey 4: Sam sends a Mission, asks for the Agent's view, is reminded, keeps paying Tunewell and switches Subscription price rises off", async ({ page }) => {
  // Advancing the clock to the reminder date presses the Simulator's button once for each of 74 days.
  test.setTimeout(120_000);
  await restoreSeed(page);

  await page.goto("/sign-in");
  await page.getByRole("button", { name: "Sam Calloway" }).click();
  await expect(page.getByRole("heading", { name: "Home" })).toBeVisible();
  const nav = page.getByRole("navigation", { name: "Main" });
  await nav.getByRole("link", { name: /Discoveries/ }).click();
  await expect(page.getByRole("heading", { name: "Discoveries", level: 1 })).toBeVisible();

  // 1. Sam asks the question. The Mission runs with its progress label, then reports one Finding.
  const askBox = page.getByRole("region", { name: "Ask your agent" });
  await askBox.getByLabel("Your question").fill(QUESTION);
  await askBox.getByRole("button", { name: "Look into it" }).click();
  const inProgress = page.getByRole("region", { name: "In progress" });
  await expect(inProgress).toContainText(QUESTION);
  await expect(inProgress.getByRole("status")).toHaveText(/Reading your transactions|Checking your|Writing up/);
  await expectNoHorizontalScroll(page);

  const finding = page.getByRole("region", { name: MISSION_FINDING });
  await expect(finding).toBeVisible({ timeout: 15_000 });
  await expect(inProgress).toHaveCount(0);
  await expect(finding).toContainText("From a Mission you sent");
  await expect(finding.getByText("Open", { exact: true })).toBeVisible();

  // 2. Every fact names its Source: each fact's value ends with "Source: …".
  const factNames = finding.getByRole("term");
  const factValues = finding.getByRole("definition");
  const factCount = await factNames.count();
  expect(factCount).toBeGreaterThan(0);
  await expect(factValues).toHaveCount(factCount);
  for (let index = 0; index < factCount; index += 1) {
    await expect(factValues.nth(index)).toContainText(/Source: \S/);
  }
  await expectNoHorizontalScroll(page);

  // 3. The default Advice setting is "on request": the Agent's view stays hidden until Sam asks for it.
  await expect(page.getByRole("region", { name: "Advice setting" })).toContainText("the agent's view only if I ask");
  const agentsView = finding.getByText(/^I would pick Remind me on Mon 1 Feb/);
  await expect(agentsView).toBeHidden();
  await finding.getByText("What would the agent pick?").click();
  await expect(agentsView).toBeVisible();

  // 4. Sam picks Remind me. The Finding is snoozed until its date, then opens again when the clock gets there.
  await finding.getByRole("button", { name: /Remind me on Mon 1 Feb/ }).click();
  await expect(finding).toContainText("Snoozed until Mon 1 Feb");
  await expectNoHorizontalScroll(page);

  await advanceClock(page, SEED_DATE, REMINDER_DATE);
  await expectNoHorizontalScroll(page);

  await nav.getByRole("link", { name: /Discoveries/ }).click();
  await expect(finding.getByText("Open", { exact: true })).toBeVisible();
  await expect(finding).not.toContainText("Snoozed until");
  await expect(finding.getByRole("button", { name: /Not now/ })).toBeVisible();

  await openFromMoreMenu(page, "Decision log");
  const reopened = page.getByRole("article", { name: `Showed you “${MISSION_FINDING}” again` });
  await expect(reopened).toBeVisible();
  await reopened.getByText("Why?").click();
  await expect(reopened).toContainText("You asked to be reminded on Mon 1 Feb");
  await expectNoHorizontalScroll(page);

  // 5. Sam keeps paying for Tunewell.
  await nav.getByRole("link", { name: /Discoveries/ }).click();
  const tunewell = page.getByRole("region", { name: "Tunewell Streaming went up from $15.00 to $18.00" });
  await tunewell.getByRole("button", { name: /Keep paying/ }).click();
  await expect(tunewell).toContainText("You chose: Keep paying");

  // 6. Sam switches Subscription price rises off. The Clipreel Finding expires. The Tunewell pick and the
  // Mission Finding stay as they were.
  const clipreel = page.getByRole("region", { name: "Your Clipreel free trial turned paid at $12.99" });
  await expect(clipreel.getByText("Open", { exact: true })).toBeVisible();
  const subscriptionPriceRises = page
    .getByRole("region", { name: "Standing searches" })
    .getByRole("switch", { name: "Subscription price rises" });
  await subscriptionPriceRises.click();
  await expect(subscriptionPriceRises).toHaveAttribute("aria-checked", "false");
  await expect(clipreel.getByText("Expired", { exact: true })).toBeVisible();
  await expect(tunewell).toContainText("You chose: Keep paying");
  await expect(finding.getByText("Open", { exact: true })).toBeVisible();

  await expectNoHorizontalScroll(page);
});
