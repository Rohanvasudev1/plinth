import { expect, test, type Page } from "@playwright/test";
import { restoreSeed } from "./restore-seed";

test.use({ viewport: { width: 390, height: 844 } });

async function signInAsAlex(page: Page): Promise<void> {
  await page.goto("/sign-in");
  await page.getByRole("button", { name: "Alex Okafor" }).click();
}

async function expectNoSideways(page: Page): Promise<void> {
  const overflows = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  expect(overflows).toBe(false);
}

test("Alex answers the Setup survey on Home at phone width, and gets a Goal account per savings goal", async ({ page }) => {
  await restoreSeed(page);
  await signInAsAlex(page);
  const next = page.getByRole("button", { name: "Next", exact: true });

  await expect(page.getByText("Step 1 of 6")).toBeVisible();
  await expectNoSideways(page);
  await page.getByRole("checkbox", { name: /Travel/ }).check();
  await page.getByRole("checkbox", { name: /Buy a home/ }).check();
  await next.click();

  await expect(page.getByRole("heading", { name: "How much should your agent do on its own?" })).toBeVisible();
  await page.getByRole("radio", { name: /Ask me before everything/ }).check();
  await next.click();

  await expect(page.getByRole("heading", { name: "When your agent finds something, it should:" })).toBeVisible();
  await next.click();

  await page.getByRole("textbox", { name: /Always keep this much/ }).fill("1000");
  await page.getByRole("textbox", { name: /Largest move/ }).fill("10001");
  await next.click();
  await expect(page.getByRole("alert").filter({ hasText: "Payment limit" })).toContainText("the Payment limit from $0 to $10,000");
  await page.getByRole("textbox", { name: /Largest move/ }).fill("250");
  await next.click();

  await expect(page.getByRole("heading", { name: "Investing: how do you feel about risk?" })).toBeVisible();
  await page.getByRole("button", { name: "Back" }).click();
  await expect(page.getByRole("textbox", { name: /Largest move/ })).toHaveValue("250");
  await next.click();
  await next.click();

  await expect(page.getByRole("heading", { name: "Your data" })).toBeVisible();
  for (const choice of await page.getByRole("checkbox").all()) await expect(choice).not.toBeChecked();
  await next.click();

  const summary = page.getByRole("list", { name: "Summary" });
  await expect(summary).toContainText("Put spare money toward: Travel, Buy a home.");
  await expect(summary).toContainText("Sweep spare money to Travel fund first.");
  await expect(summary).toContainText("Suggest everything and wait for my OK.");
  await expect(summary).toContainText("Never let checking fall below $1,000");
  await expect(summary).toContainText("My Payment limit is $250");
  await expectNoSideways(page);
  await page.getByRole("button", { name: "Turn on my agent" }).click();

  await expect(page.getByRole("heading", { name: "Home" })).toBeVisible();
  const travel = page.getByRole("region", { name: "Travel fund" });
  await expect(travel).toContainText("$0.00");
  await expect(travel.getByRole("progressbar")).toHaveCount(0);
  await expect(page.getByRole("region", { name: "House fund" })).toContainText("$0.00");

  await page.getByRole("link", { name: "Agent & limits" }).click();
  const rules = page.getByRole("region", { name: "Your rules" });
  await expect(rules).toContainText("Keep a $1,000 buffer in Checking");
  await expect(rules).toContainText("move anything above it to Travel fund");
  await expect(rules).toContainText("Move up to $250 without asking");

  // A target on a Goal account shows as progress on Home.
  const travelGoal = page.getByRole("region", { name: "Travel fund" });
  await travelGoal.getByRole("textbox").fill("3000");
  await travelGoal.getByRole("button", { name: "Save" }).click();
  await expect(travelGoal.getByRole("status")).toHaveText("Target set to $3,000.");
  await page.getByRole("link", { name: "Home" }).click();
  await expect(page.getByRole("region", { name: "Travel fund" }).getByRole("progressbar")).toBeVisible();

  await page.getByRole("link", { name: "Decision log" }).click();
  await expect(page.getByRole("article").filter({ hasText: "Saved your settings from the Setup survey" })).toBeVisible();
});

test("leaving the survey halfway saves nothing", async ({ page }) => {
  await restoreSeed(page);
  await signInAsAlex(page);
  await page.getByRole("checkbox", { name: /Emergency cushion/ }).check();
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await expect(page.getByText("Step 2 of 6")).toBeVisible();

  await page.goto("/decision-log");
  await expect(page.getByText("Your agent hasn’t done anything yet.")).toBeVisible();
  await page.goto("/");
  await expect(page.getByText("Step 1 of 6")).toBeVisible();
  await expect(page.getByRole("checkbox", { name: /Emergency cushion/ })).not.toBeChecked();
});

test("Skip applies standard rules with no sweep target, and Run setup again on Agent & limits adds one", async ({ page }) => {
  await restoreSeed(page);
  await signInAsAlex(page);
  await page.getByRole("button", { name: "Skip for now" }).click();

  await expect(page.getByRole("heading", { name: "Home" })).toBeVisible();
  await page.getByRole("link", { name: "Agent & limits" }).click();
  const rules = page.getByRole("region", { name: "Your rules" });
  await expect(rules).toContainText("Keep a $1,500 buffer in Checking");
  await expect(rules).toContainText("No savings goal to move anything above it to");
  await expect(rules).toContainText("Move up to $500 without asking");

  await page.getByRole("link", { name: "Run setup again" }).click();
  await expect(page.getByRole("button", { name: "Skip for now" })).toHaveCount(0);
  await page.getByRole("checkbox", { name: /Emergency cushion/ }).check();
  for (let step = 0; step < 6; step++) await page.getByRole("button", { name: "Next", exact: true }).click();
  await expect(page.getByRole("list", { name: "Summary" })).toContainText("Act on its own for anything up to $500");
  await page.getByRole("button", { name: "Turn on my agent" }).click();

  await expect(page.getByRole("region", { name: "Emergency cushion" })).toContainText("$0.00");
  await page.getByRole("link", { name: "Agent & limits" }).click();
  await expect(rules).toContainText("move anything above it to Emergency cushion");
});
