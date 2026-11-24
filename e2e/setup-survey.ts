import { expect, type Page } from "@playwright/test";

/**
 * From the first step of the Setup survey, with the goals already picked, chooses "Ask me before everything",
 * keeps every other answer, and turns the agent on from the Summary. Lands on Home.
 */
export async function turnOnAgentAskingFirst(page: Page): Promise<void> {
  const next = page.getByRole("button", { name: "Next", exact: true });
  const turnOn = page.getByRole("button", { name: "Turn on my agent" });
  await next.click();
  await page.getByRole("radio", { name: /Ask me before everything/ }).check();
  // Press Next through the remaining steps, however many there are, until the Summary shows. Each press waits
  // for the step label to change, so the loop never reads a step that hasn't rendered yet.
  const stepLabel = page.getByText(/^Set up your agent · /);
  for (;;) {
    const label = await stepLabel.textContent();
    if (label?.endsWith("Summary")) break;
    await next.click();
    await expect(stepLabel).not.toHaveText(label ?? "");
  }
  await expect(page.getByRole("list", { name: "Summary" })).toContainText("Suggest everything and wait for my OK.");
  await turnOn.click();
  await expect(page.getByRole("heading", { name: "Home" })).toBeVisible();
}
