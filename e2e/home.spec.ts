import { expect, test } from "@playwright/test";

test("Home shows the simulated date", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "Home" })).toBeVisible();
  await expect(page.getByText("Monday 23 November")).toBeVisible();
});
