import { expect, test } from "@playwright/test";
import { expectNoHorizontalScroll } from "./page-checks";
import { restoreSeed } from "./restore-seed";
import { openFromMoreMenu } from "./nav";

test.use({ viewport: { width: 390, height: 844 } });

test("Sam asks a suggested question, sees the Mission run, then reads its Finding and full report", async ({ page }) => {
  await restoreSeed(page);
  await page.goto("/sign-in");
  await page.getByRole("button", { name: "Sam Calloway" }).click();
  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Discoveries" }).click();

  const box = page.getByRole("region", { name: "Ask your agent" });
  await expect(box).toContainText(
    "Your question and the data it reads are sent to our language model provider. Your name and account numbers are not.",
  );
  await expect(box.getByRole("button", { name: "What would a $500 a month raise change?" })).toBeVisible();
  await expect(box.getByRole("button", { name: "Am I on track for my House fund?" })).toBeVisible();
  await expectNoHorizontalScroll(page);

  await box.getByRole("button", { name: "Could I take 3 months off work next summer?" }).click();
  const inProgress = page.getByRole("region", { name: "In progress" });
  await expect(inProgress).toContainText("Could I take 3 months off work next summer?");
  await expect(inProgress.getByRole("status")).toHaveText(/Reading your transactions|Checking your|Writing up/);
  await expectNoHorizontalScroll(page);

  const finding = page.getByRole("region", { name: "3 months without pay would take about $15,324.00 of spending" });
  await expect(finding).toBeVisible({ timeout: 15_000 });
  await expect(inProgress).toHaveCount(0);
  await expect(finding).toContainText("From a Mission you sent");
  await expect(finding).toContainText("Source: From your Goals");
  await expect(finding).toContainText("Source: From your Usual month and On pace");
  await expect(finding).toContainText("What Plinth can't know");
  await expect(finding).toContainText("Source: Not in your Plinth data");
  await expectNoHorizontalScroll(page);

  await finding.getByText("What would the agent pick?").click();
  await expect(finding).toContainText("I would pick Remind me");

  await finding.getByRole("button", { name: /Read the full report/ }).click();
  const report = finding.getByRole("region", { name: "Full report" });
  await expect(report).toContainText("Without pay, 3 months of Usual spending is $15,324.00.");
  await expectNoHorizontalScroll(page);

  await openFromMoreMenu(page, "Decision log");
  const entry = page.getByRole("article", { name: /Reported back: “3 months without pay/ });
  await expect(entry).toContainText("Reported");
  await entry.getByText("Why?").click();
  await expect(entry).toContainText("You asked: Could I take 3 months off work next summer?");
  await entry.getByRole("link", { name: "See the Finding" }).click();
  await expect(page.getByRole("heading", { name: "Discoveries", level: 1 })).toBeVisible();
});
