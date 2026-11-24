import { expect, test, type Page } from "@playwright/test";
import { openFromMoreMenu } from "./nav";
import { expectNoHorizontalScroll } from "./page-checks";
import { restoreSeed } from "./restore-seed";
import { setClock } from "./set-clock";

test.use({ viewport: { width: 390, height: 844 } });

async function signInAs(page: Page, name: "Sam Calloway" | "Priya Natarajan"): Promise<void> {
  await restoreSeed(page);
  await page.goto("/sign-in");
  await page.getByRole("button", { name }).click();
  await expect(page.getByRole("heading", { name: "Home" })).toBeVisible();
}

/** The value of one of the four figures at the top of All accounts, such as Net worth. */
function figure(page: Page, label: "Cash" | "Investments" | "Debt" | "Net worth") {
  return page
    .getByRole("region", { name: "Where you stand" })
    .locator(".stat")
    .filter({ has: page.getByText(label, { exact: true }) })
    .getByRole("definition");
}

test("Sam sees his four figures and every account, Plinth's marked Everything and Linked ones See only", async ({ page }) => {
  await signInAs(page, "Sam Calloway");

  // Home stays Plinth-only and links to All accounts.
  await page.getByRole("link", { name: /All accounts/ }).click();
  await expect(page.getByRole("heading", { name: "All accounts", level: 1 })).toBeVisible();

  await expect(figure(page, "Cash")).toHaveText("$12,627.00");
  await expect(figure(page, "Investments")).toHaveText("$41,200.00");
  await expect(figure(page, "Debt")).toHaveText("-$17,110.55");
  await expect(figure(page, "Net worth")).toHaveText("$36,716.45");

  const table = page.getByRole("table", { name: "Accounts" });
  const rows = table.getByRole("row");
  await expect(rows.nth(1)).toContainText("Checking");
  await expect(rows.nth(1)).toContainText("Everything");
  const summit = rows.filter({ hasText: "Summit Card" });
  await expect(summit).toContainText("credit card · See only");
  await expect(summit).toContainText("-$2,310.55");
  await expect(summit).toContainText("synced Thu 19 Nov, 9:00 am");
  await expect(summit).toContainText("Consent until 23 May 2027");
  await expect(summit.getByRole("button", { name: "Unlink Summit Card" })).toBeVisible();
  await expectNoHorizontalScroll(page);
});

test("Sam links Harbor Credit Union, sees Cash and Net worth rise, and finds its Sync in the access log", async ({ page }) => {
  await signInAs(page, "Sam Calloway");
  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Accounts" }).click();
  await page.getByRole("link", { name: "Link another bank" }).click();

  await expect(page.getByRole("heading", { name: "Link another bank", level: 1 })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Summit Card" })).toHaveCount(0);
  const harbor = page.getByRole("listitem").filter({ hasText: "Harbor Credit Union" });
  await expect(harbor).toContainText("See only: Plinth will see this account's balance until 19 Nov 2027");
  await expectNoHorizontalScroll(page);
  await harbor.getByRole("button", { name: "Link Harbor Credit Union" }).click();

  await expect(page.getByRole("heading", { name: "All accounts", level: 1 })).toBeVisible();
  await expect(figure(page, "Cash")).toHaveText("$14,767.00");
  await expect(figure(page, "Net worth")).toHaveText("$38,856.45");

  await openFromMoreMenu(page, "Privacy");
  const newest = page.getByRole("region", { name: "Access log" }).getByRole("listitem").first();
  await expect(newest).toContainText("Plinth");
  await expect(newest).toContainText("Your Harbor Credit Union checking balance");

  await openFromMoreMenu(page, "Decision log");
  await expect(page.getByRole("article", { name: "Linked Harbor Credit Union checking" })).toBeVisible();
});

test("Sam unlinks Summit Card, is told Plinth deleted its copy, and can link it again", async ({ page }) => {
  await signInAs(page, "Sam Calloway");
  await page.goto("/accounts");

  await page.getByRole("button", { name: "Unlink Summit Card" }).click();

  await expect(page.getByRole("status")).toHaveText("Unlinked. Plinth deleted its copy of that data.");
  await expect(page.getByRole("table", { name: "Accounts" })).not.toContainText("Summit Card");
  await expect(figure(page, "Debt")).toHaveText("-$14,800.00");

  await page.getByRole("link", { name: "Link another bank" }).click();
  await expect(page.getByRole("heading", { name: "Summit Card" })).toBeVisible();
});

test("on 23 May 2027 Sam's Consents have ended: no balance, Renew and Unlink, and Renew syncs Summit Card again", async ({ page }) => {
  await signInAs(page, "Sam Calloway");
  // 9am in New York (EDT) on the day Sam's seeded Consents end.
  await setClock(page, "2027-05-23T13:00:00Z");
  await page.goto("/accounts");

  const summit = page.getByRole("table", { name: "Accounts" }).getByRole("row").filter({ hasText: "Summit Card" });
  await expect(summit).toContainText("Consent ended on 23 May 2027");
  await expect(summit).not.toContainText("$");
  await expect(summit).not.toContainText("synced");
  await expect(summit.getByRole("button", { name: "Unlink Summit Card" })).toBeVisible();
  await expect(figure(page, "Investments")).toHaveText("$0.00");
  await expect(figure(page, "Debt")).toHaveText("$0.00");
  await expectNoHorizontalScroll(page);

  await summit.getByRole("button", { name: "Renew Summit Card" }).click();

  await expect(page.getByRole("status")).toHaveText("Renewed for 12 months. Plinth read its balance just now.");
  await expect(summit).toContainText("synced Sun 23 May, 9:00 am");
  await expect(summit).toContainText("Consent until 23 May 2028");
  await expect(summit.getByRole("button", { name: "Renew Summit Card" })).toHaveCount(0);
  await expect(summit).toContainText("-$");
  await expect(figure(page, "Debt")).not.toHaveText("$0.00");
  await expect(page.getByRole("table", { name: "Accounts" }).getByRole("row").filter({ hasText: "Northwind" })).toContainText(
    "Consent ended on 23 May 2027",
  );
});

test("the nav shows Accounts between Activity and Forecast and doesn't scroll sideways, with More open or closed", async ({ page }) => {
  await signInAs(page, "Sam Calloway");
  const nav = page.getByRole("navigation", { name: "Main" });

  await expect(nav.getByRole("link")).toHaveText(["Home", "Activity", "Accounts", "Forecast", /^Discoveries/]);
  await expectNoHorizontalScroll(page);
  await nav.locator("summary", { hasText: "More" }).click();
  await expect(nav.getByRole("link", { name: "Privacy" })).toBeVisible();
  await expectNoHorizontalScroll(page);
});

test("Priya, with no Linked accounts, sees only her Plinth accounts and Link another bank", async ({ page }) => {
  await signInAs(page, "Priya Natarajan");
  await page.goto("/accounts");

  await expect(figure(page, "Net worth")).toHaveText("$3,986.42");
  await expect(page.getByRole("table", { name: "Accounts" })).not.toContainText("See only");
  await expect(page.getByRole("link", { name: "Link another bank" })).toBeVisible();
});

test.describe("without JavaScript", () => {
  test.use({ javaScriptEnabled: false });

  test("Sam links Lakeside Bank", async ({ page }) => {
    await signInAs(page, "Sam Calloway");
    await page.goto("/accounts/link");
    await page.getByRole("button", { name: "Link Lakeside Bank" }).click();

    await expect(page.getByRole("status")).toContainText("Linked.");
    await expect(page.getByRole("table", { name: "Accounts" })).toContainText("Lakeside Bank");
  });
});
