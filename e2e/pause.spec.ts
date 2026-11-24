import { expect, test } from "@playwright/test";
import { restoreSeed } from "./restore-seed";
import { expectNoHorizontalScroll } from "./page-checks";
import { openFromMoreMenu } from "./nav";

test.use({ viewport: { width: 390, height: 844 } });

test("Sam pauses the agent, a paycheck is refused with Agent paused, and unpausing moves nothing", async ({ page }) => {
  await restoreSeed(page);
  await page.goto("/sign-in");
  await page.getByRole("button", { name: "Sam Calloway" }).click();
  await expect(page.getByRole("region", { name: "Your agent is paused" })).toHaveCount(0);

  await openFromMoreMenu(page, "Agent & limits");
  await page.getByRole("button", { name: "Pause agent" }).click();
  await expect(page.getByRole("region", { name: "Your agent is paused" }).getByRole("status")).toHaveText(
    "Agent paused. Nothing will happen automatically.",
  );

  await page.getByRole("link", { name: "Home" }).click();
  const banner = page.getByRole("region", { name: "Your agent is paused" });
  await expect(banner).toBeVisible();
  await expectNoHorizontalScroll(page);

  // The clock starts on Thursday 19 November. Moving it to Friday 20 November posts Sam's paycheck.
  await openFromMoreMenu(page, "Simulator");
  await page.getByRole("button", { name: "Advance clock one day" }).click();
  await expect(page.getByRole("status")).toContainText("Posted your Acme Corp paycheck");

  await page.goto("/decision-log");
  const refused = page.getByRole("article", { name: "Move $340 to House fund" });
  await expect(refused).toContainText("Refused");
  await refused.getByText("Why?").click();
  await expect(refused).toContainText("Refused by the Pause guardrail: Agent paused until you unpause it");
  await expect(page.getByRole("article", { name: "Paused your agent" })).toContainText("You");

  await page.goto("/agent");
  await page.getByRole("button", { name: "Unpause agent" }).click();
  await expect(page.getByRole("button", { name: "Pause agent" })).toBeVisible();

  await page.goto("/");
  await expect(page.getByRole("region", { name: "Your agent is paused" })).toHaveCount(0);
  // Unpausing doesn't rerun the missed sweep: the House fund is unchanged.
  await expect(page.getByRole("region", { name: "House fund" })).toContainText("$12,400.00");

  await page.goto("/decision-log");
  await expect(page.getByRole("article", { name: "Unpaused your agent" })).toBeVisible();
  await expect(page.getByRole("article", { name: "Moved $340 to House fund" })).toHaveCount(0);
});
