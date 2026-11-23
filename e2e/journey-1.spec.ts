import { expect, test } from "@playwright/test";

test.use({ viewport: { width: 390, height: 844 } });

test("Journey 1: Sam's paycheck posts, the agent sweeps $340, and Sam reads Why and undoes it", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Sam Calloway" }).click();
  await expect(page.getByRole("heading", { name: "Home" })).toBeVisible();
  await expect(page.getByRole("region", { name: "What your agent did" })).toContainText(
    "Your agent hasn’t done anything yet.",
  );

  // Sam is paid on Friday 20 November, the day after the simulation starts.
  await page.getByRole("link", { name: "Simulator" }).click();
  await page.getByRole("button", { name: "Advance clock one day" }).click();
  await expect(page.getByRole("status")).toContainText("Posted your Acme Corp paycheck of $3,240.00 for 2026-11-20.");
  await page.getByRole("button", { name: "Post paycheck" }).click();
  await expect(page.getByRole("status")).toContainText("already posted. Nothing changed.");

  await page.getByRole("link", { name: "Home" }).click();

  // The sweep Sam hasn't seen yet is toasted once.
  const toast = page.getByRole("status").filter({ hasText: "Your agent: Moved $340 to House fund" });
  await expect(toast).toBeVisible();
  await toast.getByRole("button", { name: "Dismiss" }).click();

  const activity = page.getByRole("region", { name: "What your agent did" });
  await expect(activity.getByRole("heading", { name: "Moved $340 to House fund" })).toBeVisible();
  await expect(activity).toContainText("Done");

  // Why explains the sweep: what triggered it, the bills it counted, the Rule and the guardrails.
  const guardrails = activity.getByText("Guardrails passed:");
  await expect(guardrails).toBeHidden();
  await activity.getByText("Why?", { exact: true }).click();
  await expect(guardrails).toBeVisible();
  await expect(activity.getByText("Paycheck of $3,240.00 from Acme Corp posted")).toBeVisible();
  await expect(activity.getByText("$1,627.00 before payday on Fri 4 Dec:")).toBeVisible();
  await expect(activity.getByText("Buffer Rule v1: keep $1,500 in Checking")).toBeVisible();

  const overflows = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  expect(overflows).toBe(false);

  // Undo puts the $340 back and leaves the action showing as Reversed.
  await expect(page.getByRole("region", { name: "House fund" })).toContainText("$12,740.00");
  await activity.getByRole("button", { name: "Undo" }).click();
  await expect(activity).toContainText("Moved $340 back to Checking.");
  await expect(activity).toContainText("Reversed");
  await expect(activity.getByRole("button", { name: "Undo" })).toHaveCount(0);
  await expect(page.getByRole("region", { name: "House fund" })).toContainText("$12,400.00");
  await expect(page.getByRole("region", { name: "Checking" })).toContainText("$3,467.00");

  // The Decision log keeps both entries: the sweep and the Undo that reversed it.
  await page.getByRole("link", { name: "Decision log" }).click();
  const entries = page.getByRole("article");
  await expect(entries).toHaveCount(2);
  await expect(entries.first()).toContainText("Moved $340 back to Checking");
  await expect(entries.first()).toContainText("Reversed");
  await expect(entries.last()).toContainText("Moved $340 to House fund");
  await expect(entries.last()).toContainText("Done");
});

test("The toast shows once: it has gone by the next visit to Home", async ({ page }) => {
  await page.goto("/sign-in");
  await page.getByRole("button", { name: "Priya Natarajan" }).click();
  await page.getByRole("link", { name: "Simulator" }).click();
  await page.getByRole("button", { name: "Advance clock one day" }).click();
  await page.getByRole("link", { name: "Home" }).click();

  const toast = page.getByRole("status").filter({ hasText: "Your agent:" });
  await expect(toast).toBeVisible();

  await page.reload();

  await expect(toast).toHaveCount(0);
  await expect(page.getByRole("region", { name: "What your agent did" })).toContainText("Reversed");
});
