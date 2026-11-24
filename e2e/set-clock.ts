import { expect, type Page } from "@playwright/test";

/**
 * Moves the simulated clock straight to `at`, such as "2027-05-23T13:00:00Z", through the test-only `/e2e/clock` route.
 * Nothing posts on the dates it skips. Call `restoreSeed(page)` first, which puts the clock back.
 */
export async function setClock(page: Page, at: string): Promise<void> {
  const response = await page.request.post("/e2e/clock", { data: { at } });
  expect(response.status(), "the end-to-end clock route should move the simulated clock").toBe(204);
}
