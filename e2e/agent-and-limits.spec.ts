import { expect, test, type Page } from "@playwright/test";
import { restoreSeed } from "./restore-seed";
import { expectNoHorizontalScroll } from "./page-checks";
import { openFromMoreMenu } from "./nav";

test.use({ viewport: { width: 390, height: 844 } });

/** Fills in one Agent & limits amount form and presses Save. */
async function saveAmount(page: Page, form: string, amount: string): Promise<void> {
  const section = page.getByRole("region", { name: form });
  await section.getByRole("textbox").fill(amount);
  await section.getByRole("button", { name: "Save" }).click();
}

test("Priya edits her Rules on Agent & limits at phone width, and each change is in the Decision log", async ({ page }) => {
  await restoreSeed(page);
  await page.goto("/sign-in");
  await page.getByRole("button", { name: "Priya Natarajan" }).click();
  await openFromMoreMenu(page, "Agent & limits");

  await expect(page.getByRole("heading", { name: "Agent & limits" })).toBeVisible();
  const rules = page.getByRole("region", { name: "Your rules" });
  await expect(rules).toContainText("Keep a $500 buffer in Checking");
  await expect(rules).toContainText("Move up to $500 without asking");
  const limitSwitch = rules.getByRole("switch", { name: "Payment limit Rule" });
  await expect(limitSwitch).toHaveAttribute("aria-checked", "true");

  await expectNoHorizontalScroll(page);

  // An out-of-range value is refused with a message and saves nothing.
  await saveAmount(page, "Payment limit", "10001");
  await expect(page.getByRole("region", { name: "Payment limit" }).getByRole("status")).toHaveText(
    "The Payment limit must be a whole-dollar amount from $0 to $10,000. Nothing was saved.",
  );
  await saveAmount(page, "Buffer for Checking", "100000.50");
  await expect(page.getByRole("region", { name: "Buffer for Checking" }).getByRole("status")).toHaveText(
    "The Buffer must be a whole-dollar amount from $0 to $100,000. Nothing was saved.",
  );
  await page.reload();
  await expect(rules).toContainText("Keep a $500 buffer in Checking");
  await expect(rules).toContainText("Move up to $500 without asking");

  await saveAmount(page, "Payment limit", "750");
  await expect(page.getByRole("region", { name: "Payment limit" }).getByRole("status")).toHaveText(
    "Payment limit set to $750.",
  );
  await expect(rules).toContainText("Move up to $750 without asking");

  await saveAmount(page, "Buffer for Checking", "800");
  await expect(rules).toContainText("Keep a $800 buffer in Checking");

  await limitSwitch.click();
  await expect(limitSwitch).toHaveAttribute("aria-checked", "false");

  await page.getByRole("link", { name: "Open the Decision log" }).click();
  await expect(page.getByRole("heading", { name: "Decision log", level: 1 })).toBeVisible();
  const entries = page.getByRole("article");
  await expect(entries.nth(0)).toContainText("Switched off the payment limit Rule");
  await expect(entries.nth(1)).toContainText("Changed the Buffer to $800");
  await expect(entries.nth(2)).toContainText("Changed the Payment limit to $750");
  await expect(entries.nth(0)).toContainText("You");
});
