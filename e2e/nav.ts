import { expect, type Page } from "@playwright/test";

/**
 * Opens the nav bar's More menu and follows one of its links: Agent & limits, Privacy, Decision log or Simulator.
 * The menu is a details element, so a page load or a re-render can close it again under the click. Each try opens
 * it only if the link is hidden, then clicks, and a try that loses the menu runs again.
 */
export async function openFromMoreMenu(page: Page, name: "Agent & limits" | "Privacy" | "Decision log" | "Simulator"): Promise<void> {
  await page.waitForLoadState();
  const nav = page.getByRole("navigation", { name: "Main" });
  const summary = nav.locator("summary", { hasText: "More" });
  const link = nav.getByRole("link", { name: name === "Simulator" ? "Simulator (testing tool)" : name, exact: true });
  await expect(async () => {
    if (!(await link.isVisible())) await summary.click({ timeout: 2_000 });
    await link.click({ timeout: 2_000 });
  }).toPass({ timeout: 15_000 });
}
