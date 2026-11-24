import { expect, test } from "@playwright/test";
import { openFromMoreMenu } from "./nav";
import { expectNoHorizontalScroll } from "./page-checks";
import { restoreSeed } from "./restore-seed";

test.use({ viewport: { width: 390, height: 844 } });

test("Alex closes and deletes after seeing the $400.00 payout, then can't sign in: This account is closed", async ({ page, context }) => {
  await restoreSeed(page);
  await page.goto("/sign-in");
  await page.getByRole("button", { name: "Alex Okafor" }).click();
  await openFromMoreMenu(page, "Privacy");
  const session = await context.cookies();

  await page.getByRole("region", { name: "Close and delete" }).getByRole("link", { name: "Close and delete" }).click();
  await expect(page.getByRole("heading", { name: "Close and delete", level: 1 })).toBeVisible();
  await expect(page.getByRole("region", { name: "Payout" })).toContainText("$400.00 paid out to you");
  const keeps = page.getByRole("region", { name: "What Plinth keeps" });
  for (const kept of ["The Ledger", "The Decision log", "The access log"]) await expect(keeps).toContainText(kept);
  const deletes = page.getByRole("region", { name: "What Plinth deletes" });
  for (const deleted of ["Missions", "Findings", "Settings", "Goal targets", "Linked accounts"]) {
    await expect(deletes).toContainText(deleted);
  }
  await expectNoHorizontalScroll(page);

  await page.getByRole("button", { name: "Close and delete my account" }).click();
  await expect(page).toHaveURL(/\/sign-in/);
  await expect(page.getByRole("main").getByRole("alert")).toHaveText("This account is closed");

  // Alex is still on Sign in as, but picking Alex starts no session.
  await page.goto("/sign-in");
  await page.getByRole("button", { name: "Alex Okafor" }).click();
  await expect(page.getByRole("main").getByRole("alert")).toHaveText("This account is closed");
  await page.goto("/");
  await expect(page).toHaveURL(/\/sign-in/);

  // A session left open for Alex, such as in another tab, sends every page to Sign in as.
  await context.addCookies(session);
  for (const path of ["/", "/privacy", "/accounts", "/discoveries"]) {
    await page.goto(path);
    await expect(page).toHaveURL(/\/sign-in/);
  }
});
