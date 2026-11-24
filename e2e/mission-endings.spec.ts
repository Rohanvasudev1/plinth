import { expect, test, type Page } from "@playwright/test";
import { expectNoHorizontalScroll } from "./page-checks";
import { restoreSeed } from "./restore-seed";
import { turnOnAgentAskingFirst } from "./setup-survey";

test.use({ viewport: { width: 390, height: 844 } });

// The fake model, which the end-to-end suite always runs on, has test scripts for these questions
// (FAKE_TEST_QUESTIONS in src/fake-mission-model.ts).
const RUN_LONG = "Test: run long";
const MODEL_ERROR = "Test: fail with a model error";

async function signInAsSamOnDiscoveries(page: Page): Promise<void> {
  await page.goto("/sign-in");
  await page.getByRole("button", { name: "Sam Calloway" }).click();
  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Discoveries" }).click();
}

async function ask(page: Page, question: string): Promise<void> {
  const box = page.getByRole("region", { name: "Ask your agent" });
  await box.getByLabel("Your question").fill(question);
  await box.getByRole("button", { name: "Look into it" }).click();
}

test("Sam stops a running Mission, which keeps nothing, and a second Mission is refused while one runs", async ({ page }) => {
  await restoreSeed(page);
  await signInAsSamOnDiscoveries(page);

  await ask(page, RUN_LONG);
  const inProgress = page.getByRole("region", { name: "In progress" });
  await expect(inProgress).toContainText(RUN_LONG);
  await expectNoHorizontalScroll(page);

  await ask(page, "Where does my money go?");
  await expect(page.getByRole("region", { name: "Ask your agent" }).getByRole("alert")).toHaveText(
    "Your agent looks into one question at a time. Wait for this one to finish, or stop it, then ask again",
  );

  await inProgress.getByRole("button", { name: "Stop" }).click();
  await expect(inProgress).toHaveCount(0);
  const ended = page.getByRole("region", { name: "Ended without a Finding" });
  await expect(ended.getByRole("listitem", { name: RUN_LONG })).toContainText("Stopped. Nothing was kept.");
  await expect(ended.getByRole("button", { name: "Try again" })).toHaveCount(0);
  await expectNoHorizontalScroll(page);

  await page.getByRole("link", { name: "Decision log" }).click();
  const entry = page.getByRole("article", { name: `Stopped looking into “${RUN_LONG}”` });
  await expect(entry).toContainText("Stopped");
  await entry.getByText("Why?").click();
  await expect(entry).toContainText("Nothing. Nothing was kept");
});

test("a Mission that fails says Couldn't finish this, and Try again asks the same question again", async ({ page }) => {
  await restoreSeed(page);
  await signInAsSamOnDiscoveries(page);

  await ask(page, MODEL_ERROR);
  const failed = page.getByRole("region", { name: "Ended without a Finding" }).getByRole("listitem", { name: MODEL_ERROR });
  await expect(failed).toContainText("Couldn't finish this", { timeout: 15_000 });
  await expectNoHorizontalScroll(page);

  // Try again starts a new Mission, which fails the same way, so the Decision log gets a second Failed entry.
  const askedAgain = page.waitForResponse((response) => response.request().method() === "POST");
  await failed.getByRole("button", { name: "Try again" }).click();
  await askedAgain;
  await expect(async () => {
    await page.goto("/decision-log");
    await expect(page.getByRole("article", { name: `Couldn't finish looking into “${MODEL_ERROR}”` })).toHaveCount(2, {
      timeout: 500,
    });
  }).toPass({ timeout: 15_000 });
});

test("Sam picks the Move a Mission Finding offers, and it moves the money", async ({ page }) => {
  await restoreSeed(page);
  // With Ask me before everything, Sam's paycheck stays in Checking, so the House fund Mission has money to offer.
  await page.goto("/sign-in");
  await page.getByRole("button", { name: "Sam Calloway" }).click();
  await page.getByRole("link", { name: "Agent & limits" }).click();
  await page.getByRole("link", { name: "Run setup again" }).click();
  await turnOnAgentAskingFirst(page);
  await page.getByRole("link", { name: "Simulator" }).click();
  await page.getByRole("button", { name: "Advance clock one day" }).click();
  await expect(page.getByRole("status")).toContainText("Posted your Acme Corp paycheck");

  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Discoveries" }).click();
  await page.getByRole("region", { name: "Ask your agent" }).getByRole("button", { name: "Am I on track for my House fund?" }).click();
  const finding = page.getByRole("region", { name: /^House fund is at 31%/ });
  await expect(finding).toBeVisible({ timeout: 15_000 });
  await expect(finding).toContainText("Source: From your 30-day Forecast");
  await expectNoHorizontalScroll(page);

  await finding.getByRole("button", { name: /Move \$340 to House fund/ }).click();
  await expect(finding).toContainText("You chose: Move $340 to House fund");

  await page.goto("/");
  await expect(page.getByRole("region", { name: "House fund", exact: true })).toContainText("$12,740.00");
  await page.goto("/decision-log");
  const done = page.getByRole("article", { name: "Moved $340 to House fund" });
  await expect(done).toContainText("Done");
  await done.getByText("Why?").click();
  await expect(done).toContainText("You picked “Move $340 to House fund”");
});
