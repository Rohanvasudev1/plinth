import { expect, test } from "@playwright/test";
import { restoreSeed } from "./restore-seed";
import { openFromMoreMenu } from "./nav";

test.use({ viewport: { width: 390, height: 844 } });

test("a Card purchase in the Simulator picks a Merchant and spends from the chosen account", async ({ page }) => {
  await restoreSeed(page);
  await page.goto("/sign-in");
  await page.getByRole("button", { name: "Sam Calloway" }).click();
  await openFromMoreMenu(page, "Simulator");

  const purchase = page.getByRole("region", { name: "Card purchase" });
  await purchase.getByLabel("Merchant").selectOption({ label: "Lantern Noodle Bar (Eating out)" });
  await purchase.getByLabel("Account").selectOption({ label: "Checking ($227.00)" });
  await purchase.getByLabel("Amount in dollars").fill("18.40");
  await purchase.getByRole("button", { name: "Spend" }).click();
  await expect(purchase.getByRole("status")).toHaveText("Spent $18.40 from Checking at Lantern Noodle Bar.");

  await page.goto("/");
  await expect(page.getByRole("region", { name: "Checking", exact: true })).toContainText("$208.60");
});
