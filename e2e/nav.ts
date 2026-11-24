import type { Page } from "@playwright/test";

/**
 * Opens the nav bar's More menu and follows one of its links: Agent & limits, Privacy, Decision log or Simulator.
 * The menu is a details element, so a page load closes it again.
 */
export async function openFromMoreMenu(page: Page, name: "Agent & limits" | "Privacy" | "Decision log" | "Simulator"): Promise<void> {
  const nav = page.getByRole("navigation", { name: "Main" });
  await nav.locator("summary", { hasText: "More" }).click();
  await nav.getByRole("link", { name: name === "Simulator" ? "Simulator (testing tool)" : name, exact: true }).click();
}
