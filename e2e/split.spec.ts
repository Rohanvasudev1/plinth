import { expect, test, type Page } from "@playwright/test";
import { openFromMoreMenu } from "./nav";
import { expectNoHorizontalScroll } from "./page-checks";
import { restoreSeed } from "./restore-seed";

test.use({ viewport: { width: 390, height: 844 } });

async function signInAs(page: Page, name: string): Promise<void> {
  await page.goto("/sign-in");
  await page.getByRole("button", { name }).click();
  await expect(page.getByRole("navigation", { name: "Main" })).toBeVisible();
}

function balances(page: Page, group: string) {
  return page.getByRole("list", { name: `Who owes whom in ${group}` });
}

test("Sam's Split page shows who owes whom on 19 Nov, then adds a Shared cost that moves no money", async ({ page }) => {
  await restoreSeed(page);
  await signInAs(page, "Sam Calloway");
  await openFromMoreMenu(page, "Split");
  await expect(page.getByRole("heading", { name: "Split", level: 1 })).toBeVisible();

  const summary = page.getByRole("region", { name: "Where you stand" });
  await expect(summary).toContainText("Owed to you$262.08");
  await expect(summary).toContainText("You owe$320.00");
  await expect(summary).toContainText("Net-$57.92");

  await expect(balances(page, "Flatmates").getByRole("listitem")).toHaveText([
    "Alex Okafor owes you $133.04",
    "Jordan Reyes owes you $129.04",
  ]);
  await expect(balances(page, "Lisbon trip").getByRole("listitem")).toHaveText(["You owe Priya Natarajan $320.00"]);

  const flatmatesCosts = page.getByRole("table", { name: "Shared costs in Flatmates" }).getByRole("row");
  await expect(flatmatesCosts.nth(1)).toContainText("Green Basket Market");
  await expect(flatmatesCosts.nth(1)).toContainText("You paid $291.15");
  await expect(flatmatesCosts.nth(2)).toContainText("Alex Okafor paid $24.00");
  await expect(flatmatesCosts.nth(5)).toContainText("Internet");
  await expect(flatmatesCosts.nth(5)).toContainText("$20.68");
  await expect(page.getByText("Alex Okafor owes Jordan")).toHaveCount(0);
  await expectNoHorizontalScroll(page);

  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Activity" }).click();
  const activityRows = await page.getByRole("table", { name: "Activity" }).getByRole("row").count();

  await openFromMoreMenu(page, "Split");
  const form = page.getByRole("region", { name: "Add a shared cost" });
  await form.getByLabel("What for").fill("Green Basket Market");
  await form.getByLabel("Amount in dollars").fill("274.60");
  await form.getByLabel("Group").selectOption({ label: "Flatmates" });
  await form.getByRole("button", { name: "Add" }).click();
  await expect(form.getByRole("status")).toHaveText("Added Green Basket Market to Flatmates. Each other Share is $91.53.");
  await expect(balances(page, "Flatmates").getByRole("listitem")).toHaveText([
    "Alex Okafor owes you $224.57",
    "Jordan Reyes owes you $220.57",
  ]);
  await expect(summary).toContainText("Owed to you$445.14");

  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Activity" }).click();
  await expect(page.getByRole("table", { name: "Activity" }).getByRole("row")).toHaveCount(activityRows);
});

test("Jordan adds a Shared cost from the Simulator, and Alex, before finishing setup, sees it on Split", async ({ page }) => {
  await restoreSeed(page);
  await signInAs(page, "Alex Okafor");
  await openFromMoreMenu(page, "Split");
  await expect(balances(page, "Flatmates").getByRole("listitem")).toHaveText([
    "You owe Sam Calloway $133.04",
    "You owe Jordan Reyes $4.00",
  ]);
  await expect(page.getByRole("heading", { name: "Lisbon trip" })).toHaveCount(0);
  await expectNoHorizontalScroll(page);

  await openFromMoreMenu(page, "Simulator");
  const simulator = page.getByRole("region", { name: "Shared cost from an Outside contact" });
  await simulator.getByLabel("Who, in which Group").selectOption({ label: "Jordan Reyes in Flatmates" });
  await simulator.getByLabel("What for").fill("Toilet paper");
  await simulator.getByLabel("Amount in dollars").fill("15");
  await simulator.getByRole("button", { name: "Add shared cost" }).click();
  await expect(simulator.getByRole("status")).toHaveText("Jordan Reyes added Toilet paper, $15.00, to Flatmates.");

  await openFromMoreMenu(page, "Split");
  await expect(balances(page, "Flatmates").getByRole("listitem")).toHaveText([
    "You owe Sam Calloway $133.04",
    "You owe Jordan Reyes $9.00",
  ]);
});

test("Sam and Priya each see only their own Groups and figures after both add a Shared cost", async ({ page }) => {
  await restoreSeed(page);
  for (const [name, group, description] of [
    ["Sam Calloway", "Flatmates", "Light bulbs"],
    ["Priya Natarajan", "Lisbon trip", "Museum tickets"],
  ] as const) {
    await signInAs(page, name);
    await openFromMoreMenu(page, "Split");
    const form = page.getByRole("region", { name: "Add a shared cost" });
    await form.getByLabel("What for").fill(description);
    await form.getByLabel("Amount in dollars").fill(name === "Sam Calloway" ? "30" : "50");
    await form.getByLabel("Group").selectOption({ label: group });
    await form.getByRole("button", { name: "Add" }).click();
    await expect(form.getByRole("status")).toContainText(`Added ${description} to ${group}.`);
  }

  // Priya, still signed in.
  await expect(page.getByRole("heading", { level: 2, name: "Lisbon trip" })).toBeVisible();
  await expect(page.getByRole("heading", { level: 2, name: "Flatmates" })).toHaveCount(0);
  await expect(balances(page, "Lisbon trip").getByRole("listitem")).toHaveText(["Sam Calloway owes you $345.00"]);
  await expect(page.getByRole("main")).not.toContainText("Light bulbs");
  await expect(page.getByRole("main")).not.toContainText("Alex Okafor");

  await signInAs(page, "Sam Calloway");
  await openFromMoreMenu(page, "Split");
  await expect(balances(page, "Flatmates").getByRole("listitem")).toHaveText([
    "Alex Okafor owes you $143.04",
    "Jordan Reyes owes you $139.04",
  ]);
  await expect(balances(page, "Lisbon trip").getByRole("listitem")).toHaveText(["You owe Priya Natarajan $345.00"]);
  await expect(page.getByRole("region", { name: "Where you stand" })).toContainText("Net-$62.92");
});

test("A Shared cost sent for a Group the customer isn't in answers 404 and adds nothing", async ({ page }) => {
  await restoreSeed(page);
  await signInAs(page, "Sam Calloway");
  await openFromMoreMenu(page, "Split");
  const flatmatesId = await page
    .getByRole("region", { name: "Add a shared cost" })
    .getByLabel("Group")
    .locator("option", { hasText: "Flatmates" })
    .getAttribute("value");

  await signInAs(page, "Priya Natarajan");
  await openFromMoreMenu(page, "Split");
  const form = page.getByRole("region", { name: "Add a shared cost" });
  // Priya's Group list holds only Lisbon trip, so point its one option at Flatmates, as a tampered form would.
  await form.getByLabel("Group").locator("option").evaluate((option, id) => option.setAttribute("value", id ?? ""), flatmatesId);
  await form.getByLabel("What for").fill("Snacks");
  await form.getByLabel("Amount in dollars").fill("9");
  await form.getByRole("button", { name: "Add" }).click();
  await expect(page.getByRole("heading", { name: "This page could not be found." })).toBeVisible();

  await signInAs(page, "Sam Calloway");
  await openFromMoreMenu(page, "Split");
  await expect(page.getByRole("main")).not.toContainText("Snacks");
  await expect(balances(page, "Flatmates").getByRole("listitem")).toHaveText([
    "Alex Okafor owes you $133.04",
    "Jordan Reyes owes you $129.04",
  ]);
});
