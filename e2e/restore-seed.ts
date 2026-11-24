import { expect, type Page } from "@playwright/test";

/**
 * Puts the app back to the seed and the simulated clock's start, Thursday 19 November 2026.
 * Call it first in every test, so tests don't depend on each other or on the order they run in.
 */
export async function restoreSeed(page: Page): Promise<void> {
  const response = await page.request.post("/e2e/reset");
  expect(response.status(), "the end-to-end reset route should restore the seed").toBe(204);
}
