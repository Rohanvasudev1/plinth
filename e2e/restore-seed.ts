import { expect, type Page } from "@playwright/test";

/**
 * Puts the app back to the seed and the simulated clock's start, Thursday 19 November 2026.
 * Call it first in every test, so tests don't depend on each other or on the order they run in.
 */
export async function restoreSeed(page: Page): Promise<void> {
  const response = await page.request.post("/e2e/reset");
  expect(response.status(), "the end-to-end reset route should restore the seed").toBe(204);
}

/** Sets a seeded customer's Autonomy level through the test-only settings route. */
export async function setAutonomyLevel(
  page: Page,
  customer: string,
  autonomyLevel: "ask_first" | "small_things" | "within_rules",
): Promise<void> {
  const response = await page.request.post("/e2e/settings", { data: { customer, autonomyLevel } });
  expect(response.status(), "the end-to-end settings route should change the Autonomy level").toBe(204);
}
