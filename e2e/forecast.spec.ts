import { expect, type Page, test } from "@playwright/test";
import { restoreSeed } from "./restore-seed";
import { expectNoHorizontalScroll } from "./page-checks";
import { openFromMoreMenu } from "./nav";

test.use({ viewport: { width: 390, height: 844 } });

async function signInAs(page: Page, name: string) {
  await page.goto("/sign-in");
  await page.getByRole("button", { name }).click();
}

test("Forecast shows Sam's Usual month, November On pace, left to save and each Category", async ({ page }) => {
  await restoreSeed(page);
  await signInAs(page, "Sam Calloway");
  await expect(page.getByRole("heading", { name: "Home" })).toBeVisible();

  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Forecast" }).click();
  await expect(page.getByRole("heading", { name: "Forecast", level: 1 })).toBeVisible();

  await expect(page.getByRole("region", { name: "Comes in each month" })).toContainText("$7,020.00");
  await expect(page.getByRole("region", { name: "Usual spending" })).toContainText("$5,108.00");
  await expect(page.getByRole("region", { name: "Usual spending" })).toContainText("Average of the last 6 full months");
  const onPace = page.getByRole("region", { name: "November, on pace for" });
  await expect(onPace).toContainText("$6,628.47");
  await expect(onPace).toContainText("$1,520.47 more than usual");
  await expect(page.getByRole("region", { name: "Left to save" })).toContainText("$1,912.00 → $391.53");

  const shopping = page.getByRole("table", { name: "November compared with your Usual month" }).getByRole("row", { name: /Shopping/ });
  await expect(shopping).toContainText("$1,320.00");
  await expect(shopping).toContainText("$2,701.82");
  await expect(shopping).toContainText("+$1,381.82");
  const table = page.getByRole("table", { name: "November compared with your Usual month" });
  await expect(table.getByRole("row", { name: /Groceries/ })).toContainText("-$253.02");
  // Rent counts once for the month, not scaled up to the pace of the month so far.
  await expect(table.getByRole("row", { name: /Housing/ })).toContainText("same");
  await expect(page.getByRole("link", { name: "Forecast", exact: true })).toHaveAttribute("aria-current", "page");
  await expectNoHorizontalScroll(page);
});

test("Forecast tells Alex there isn't enough history yet, and shows no numbers", async ({ page }) => {
  await restoreSeed(page);
  await signInAs(page, "Alex Okafor");
  await expect(page.getByRole("navigation", { name: "Main" })).toBeVisible();
  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Forecast" }).click();

  await expect(page.getByRole("heading", { name: "Not enough history yet" })).toBeVisible();
  await expect(page.getByRole("main")).not.toContainText("$");
  await expectNoHorizontalScroll(page);
});

test("Forecast projects Sam's House fund at three paces, and the slider changes only the 'with your changes' line", async ({ page }) => {
  await restoreSeed(page);
  await signInAs(page, "Sam Calloway");
  await expect(page.getByRole("heading", { name: "Home" })).toBeVisible();
  await page.goto("/decision-log");
  await expect(page.getByRole("heading", { name: "Decision log", level: 1 })).toBeVisible();
  const decisionsBefore = await page.getByRole("article").count();
  await page.goto("/forecast");

  const projection = page.getByRole("region", { name: "3-year Projection of your House fund" });
  await expect(projection.getByRole("img")).toBeVisible();
  await expect(projection).toContainText("Assumes everything you save goes to your House fund, with no interest.");
  const summary = projection.getByRole("list");
  // $12,400.00 + 36 × $1,912.00, and + 36 × $391.53
  await expect(summary.getByRole("listitem").nth(0)).toContainText("Your usual month, saving $1,912.00 a month: $81,232.00");
  await expect(summary.getByRole("listitem").nth(1)).toContainText("Every month like November, saving $391.53 a month: $26,495.08");
  // A 20% cut of On pace Eating out and Shopping, $3,631.03, is $726.21 a month more.
  const withChanges = projection.getByTestId("with-changes");
  await expect(withChanges).toContainText("November with your changes, saving $1,117.74 a month: $52,638.64");

  await projection.getByLabel(/Try it: cut Eating out and Shopping by/).fill("50");
  await expect(withChanges).toContainText("saving $2,207.05 a month: $91,853.80");
  await expect(projection).toContainText("That cuts $1,815.52 a month");
  await expect(summary.getByRole("listitem").nth(0)).toContainText("$81,232.00");
  await expect(summary.getByRole("listitem").nth(1)).toContainText("$26,495.08");
  await expectNoHorizontalScroll(page);

  // The slider saved nothing: a fresh page starts at 20% again, and the Decision log hasn't changed.
  await page.reload();
  await expect(withChanges).toContainText("$52,638.64");
  await page.goto("/decision-log");
  await expect(page.getByRole("heading", { name: "Decision log", level: 1 })).toBeVisible();
  await expect(page.getByRole("article")).toHaveCount(decisionsBefore);
});

test("Forecast shows no Projection, and says why, when Sam's buffer Rule has no sweep target", async ({ page }) => {
  await restoreSeed(page);
  await signInAs(page, "Sam Calloway");
  await expect(page.getByRole("heading", { name: "Home" })).toBeVisible();
  // Run setup again and unpick Buy a home, Sam's only goal, keeping every other answer.
  await openFromMoreMenu(page, "Agent & limits");
  await page.getByRole("link", { name: "Run setup again" }).click();
  await page.getByRole("checkbox", { name: /Buy a home/ }).uncheck();
  for (let step = 0; step < 6; step++) await page.getByRole("button", { name: "Next", exact: true }).click();
  await page.getByRole("button", { name: "Turn on my agent" }).click();
  await expect(page.getByRole("heading", { name: "Home" })).toBeVisible();

  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Forecast" }).click();
  await expect(page.getByRole("region", { name: "Left to save" })).toContainText("$1,912.00 → $391.53");
  const noProjection = page.getByRole("region", { name: "No Projection yet" });
  await expect(noProjection).toContainText("Your buffer Rule doesn’t sweep to a Goal");
  await expect(page.getByRole("slider")).toHaveCount(0);
  await expectNoHorizontalScroll(page);
});
