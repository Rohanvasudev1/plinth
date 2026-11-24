import { expect, type Page } from "@playwright/test";

/** Fails if the page scrolls sideways, which at 390px wide means something doesn't fit a phone screen. */
export async function expectNoHorizontalScroll(page: Page): Promise<void> {
  const overflows = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  expect(overflows).toBe(false);
}
