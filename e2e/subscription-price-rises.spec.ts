import { expect, test, type Page } from "@playwright/test";
import { restoreSeed } from "./restore-seed";
import { expectNoHorizontalScroll } from "./page-checks";
import { openFromMoreMenu } from "./nav";

test.use({ viewport: { width: 390, height: 844 } });

async function samOnDiscoveries(page: Page): Promise<void> {
  await page.goto("/sign-in");
  await page.getByRole("button", { name: "Sam Calloway" }).click();
  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: /Discoveries/ }).click();
  await expect(page.getByRole("heading", { name: "Discoveries", level: 1 })).toBeVisible();
}

test("Sam picks Keep paying on the Tunewell Finding, then switches Subscription price rises off", async ({ page }) => {
  await restoreSeed(page);
  await samOnDiscoveries(page);

  const tunewell = page.getByRole("region", { name: "Tunewell Streaming went up from $15.00 to $18.00" });
  await expect(tunewell).toContainText("From a Standing search");
  await expect(tunewell).toContainText("$15.00 on Tue 15 Sept");
  await expect(tunewell).toContainText("$18.00 on Thu 15 Oct");
  await expect(tunewell).toContainText("Plinth can see what you pay, not whether you use it");
  await expect(tunewell).toContainText("Source: From your card charges");
  await expect(tunewell.getByRole("button", { name: /Remind me on Sat 19 Dec/ })).toBeVisible();
  await expectNoHorizontalScroll(page);

  await tunewell.getByRole("button", { name: /Keep paying.*Closes this/ }).click();
  await expect(tunewell).toContainText("You chose: Keep paying");

  const searches = page.getByRole("region", { name: "Standing searches" });
  await expect(searches).toContainText("Checks your card charges as they post");
  const toggle = searches.getByRole("switch", { name: "Subscription price rises" });
  await expect(toggle).toHaveAttribute("aria-checked", "true");
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-checked", "false");

  const clipreel = page.getByRole("region", { name: "Your Clipreel free trial turned paid at $12.99" });
  await expect(clipreel).toContainText("Expired");
  await expect(tunewell).toContainText("You chose: Keep paying");
  await expectNoHorizontalScroll(page);

  await openFromMoreMenu(page, "Decision log");
  await expect(page.getByText("Changed your settings: Subscription price rises").first()).toBeVisible();
});

test("Stop looking on a subscription Finding switches the Standing search off", async ({ page }) => {
  await restoreSeed(page);
  await samOnDiscoveries(page);

  const clipreel = page.getByRole("region", { name: "Your Clipreel free trial turned paid at $12.99" });
  await clipreel.getByRole("button", { name: "Stop looking at subscription price rises" }).click();

  await expect(clipreel).toContainText("Expired");
  await expect(page.getByRole("region", { name: "Tunewell Streaming went up from $15.00 to $18.00" })).toContainText("Expired");
  await expect(
    page.getByRole("region", { name: "Standing searches" }).getByRole("switch", { name: "Subscription price rises" }),
  ).toHaveAttribute("aria-checked", "false");
});
