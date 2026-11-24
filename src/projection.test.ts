import { describe, expect, it } from "vitest";
import type { Bank } from "./bank";
import { cents } from "./money";
import { projectionLines, type Projection } from "./projection";
import { openTestBank, signInByName } from "./test-bank";

describe("the Projection", () => {
  it("projects Sam's House fund from $12,400.00 for 36 months at each pace", () => {
    const bank = openTestBank();
    const projection = projectionFor(bank, "Sam Calloway");

    expect(projection.goalName).toBe("House fund");
    expect(projection.balance).toBe(12_400_00);

    const lines = projectionLines(projection, 0);
    // usual: $7,020.00 − $5,108.00 = $1,912.00 a month. $12,400.00 + 36 × $1,912.00 = $81,232.00
    expect(lines.usualMonth.monthlySaving).toBe(1_912_00);
    expect(lines.usualMonth.balances).toHaveLength(36);
    expect(lines.usualMonth.balances[0]).toBe(14_312_00);
    expect(lines.usualMonth.balances[35]).toBe(81_232_00);
    // this month: $7,020.00 − $6,628.47 = $391.53 a month. $12,400.00 + 36 × $391.53 = $26,495.08
    expect(lines.onPace.monthlySaving).toBe(391_53);
    expect(lines.onPace.balances[35]).toBe(26_495_08);
    // with no cut, the changes line is this month's pace
    expect(lines.withChanges.monthlySaving).toBe(391_53);
    expect(lines.withChanges.balances[35]).toBe(26_495_08);
  });

  it("adds the cut to On pace Eating out and Shopping to the changes line only", () => {
    const bank = openTestBank();
    const projection = projectionFor(bank, "Sam Calloway");

    const lines = projectionLines(projection, 50);

    // On pace Eating out $929.21 + Shopping $2,701.82 = $3,631.03. Half is $1,815.515, rounded to $1,815.52.
    // $391.53 + $1,815.52 = $2,207.05 a month. $12,400.00 + 36 × $2,207.05 = $91,853.80
    expect(lines.withChanges.monthlySaving).toBe(2_207_05);
    expect(lines.withChanges.balances[35]).toBe(91_853_80);
    expect(lines.usualMonth.balances[35]).toBe(81_232_00);
    expect(lines.onPace.balances[35]).toBe(26_495_08);

    // 20%: $3,631.03 × 0.2 = $726.206, rounded to $726.21. $391.53 + $726.21 = $1,117.74 a month.
    // $12,400.00 + 36 × $1,117.74 = $52,638.64
    expect(projectionLines(projection, 20).withChanges.balances[35]).toBe(52_638_64);
  });

  it("lowers the balance by a negative saving amount, but never below zero", () => {
    const bank = openTestBank();
    const sam = signInByName(bank, "Sam Calloway");
    const [, houseFund] = bank.customerData.listAccounts(sam);
    if (!houseFund) throw new Error("Sam's House fund is missing");
    // Paid from the House fund, which leaves it $10,500.00. $1,900.00 more Shopping by 19 Nov: ($3,167.60 + $1,900.00) × 30 ÷ 19 = $8,001.473…, plus $1,627.00 of bills,
    // is $9,628.47 On pace. $7,020.00 − $9,628.47 = −$2,608.47 a month.
    bank.cardPurchase(sam, { accountId: houseFund.id, merchant: "harbor-and-pine-goods", amount: cents(1_900_00), idempotencyKey: "card:big" });
    const projection = projectionFor(bank, "Sam Calloway");

    const { onPace } = projectionLines(projection, 0);

    expect(onPace.monthlySaving).toBe(-2_608_47);
    // $10,500.00 − 4 × $2,608.47 = $66.12, then −$2,542.35 floors at zero and stays there.
    expect(projection.balance).toBe(10_500_00);
    expect(onPace.balances.slice(0, 6)).toEqual([7_891_53, 5_283_06, 2_674_59, 66_12, 0, 0]);
    expect(onPace.balances[35]).toBe(0);
  });

  it("refuses a cut outside 0% to 50%", () => {
    const projection = projectionFor(openTestBank(), "Sam Calloway");

    expect(() => projectionLines(projection, -5)).toThrow(RangeError);
    expect(() => projectionLines(projection, 55)).toThrow(RangeError);
    expect(() => projectionLines(projection, 12.5)).toThrow(RangeError);
  });

  it("has no Projection for a customer with no sweep target, though the rest of the Forecast page shows", () => {
    const bank = openTestBank();
    const sam = signInByName(bank, "Sam Calloway");
    const answers = bank.readSetupAnswers(sam);
    if (!answers) throw new Error("Sam hasn't finished setup");
    bank.finishSetup(sam, { ...answers, goalPreferences: [] });

    const page = bank.readForecastPage(sam);

    if (page.kind !== "figures") throw new Error("Sam has no Forecast figures");
    expect(page.projection).toEqual({ kind: "no_sweep_target" });
  });

  it("projects Priya's Travel fund, not Sam's House fund", () => {
    const projection = projectionFor(openTestBank(), "Priya Natarajan");

    expect(projection.goalName).toBe("Travel fund");
    expect(projection.balance).toBe(2_150_00);
  });
});

function projectionFor(bank: Bank, name: string): Projection {
  const page = bank.readForecastPage(signInByName(bank, name));
  if (page.kind !== "figures") throw new Error(`${name} has no Forecast figures`);
  if (page.projection.kind !== "projection") throw new Error(`${name} has no Projection`);
  return page.projection;
}
