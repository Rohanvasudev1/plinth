import { expect, test } from "@playwright/test";
import { restoreSeed } from "./restore-seed";
import { expectNoHorizontalScroll } from "./page-checks";

test.use({ viewport: { width: 390, height: 844 } });

test("Journey 1: Sam's paycheck lands, the agent sweeps $340, Sam checks Why and undoes it", async ({ page }) => {
  await restoreSeed(page);
  await page.goto("/sign-in");
  await page.getByRole("button", { name: "Sam Calloway" }).click();
  await expect(page.getByRole("heading", { name: "Home" })).toBeVisible();

  // The clock starts on Thursday 19 November. Moving it to Friday 20 November posts Sam's paycheck.
  await page.getByRole("link", { name: "Simulator" }).click();
  await page.getByRole("button", { name: "Advance clock one day" }).click();
  await expect(page.getByRole("status")).toContainText("Posted your Acme Corp paycheck of $3,240.00 for 2026-11-20.");

  await page.getByRole("link", { name: "Home" }).click();
  const toast = page.getByRole("status", { name: "New from your agent" });
  await expect(toast).toContainText("Your agent: Moved $340 to House fund");
  const agentDid = page.getByRole("region", { name: "What your agent did" });
  const sweep = agentDid.getByRole("article", { name: "Moved $340 to House fund" });
  await expect(sweep).toContainText("Done");
  await expect(page.getByRole("region", { name: "House fund" })).toContainText("$12,740.00");

  await sweep.getByText("Why?").click();
  for (const label of ["Trigger", "Bills before payday", "Rule", "Checked by"]) {
    await expect(sweep.getByRole("term").filter({ hasText: label })).toBeVisible();
  }
  await expect(sweep).toContainText("Paycheck of $3,240.00 from Acme Corp posted");
  await expect(sweep).toContainText("Guardrails passed");

  await sweep.getByRole("button", { name: "Undo: Moved $340 to House fund" }).click();
  await expect(sweep).toContainText("Reversed");
  await expect(sweep.getByRole("button", { name: /Undo/ })).toHaveCount(0);
  await expect(page.getByRole("region", { name: "House fund" })).toContainText("$12,400.00");

  await expectNoHorizontalScroll(page);

  // The toast showed once: Home doesn't show it again.
  await page.reload();
  await expect(page.getByRole("status", { name: "New from your agent" })).toHaveCount(0);

  await page.getByRole("link", { name: "Decision log" }).click();
  const reversal = page.getByRole("article", { name: "Moved $340 back to Checking" });
  await expect(reversal).toContainText("Reversed");
  await expect(reversal).toContainText(" · You · Rule #");
  await expect(page.getByRole("article", { name: "Moved $340 to House fund" })).toContainText("Reversed by you");
});
