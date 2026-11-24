import { expect, type Page } from "@playwright/test";

/**
 * Goes to the Simulator and presses "Advance clock one day" until the simulated clock moves from the date `from` to
 * the date `to`, both written as 2026-11-19, checking each press moves it exactly one day. Returns the last result.
 */
export async function advanceClock(page: Page, from: string, to: string): Promise<string> {
  await page.goto("/simulator");
  const status = page.getByRole("status");
  const day = new Date(`${from}T00:00:00Z`);
  const last = new Date(`${to}T00:00:00Z`);
  while (day < last) {
    day.setUTCDate(day.getUTCDate() + 1);
    await page.getByRole("button", { name: "Advance clock one day" }).click();
    await expect(status).toContainText(`Moved the clock to ${day.toISOString().slice(0, 10)}.`);
  }
  return (await status.textContent()) ?? "";
}
