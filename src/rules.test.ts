import { describe, expect, it } from "vitest";
import { cents } from "./money";
import { RuleParametersError } from "./rules";
import { openTestBank, signInByName } from "./test-bank";

describe("buffer Rule", () => {
  it("is seeded for Sam, switched on: keep $1,500 in Checking and sweep the rest to the House fund", () => {
    const bank = openTestBank();
    const sam = signInByName(bank, "Sam Calloway");
    const [checking, houseFund] = bank.customerData.listAccounts(sam);

    expect(bank.customerData.listRules(sam)).toEqual([
      expect.objectContaining({
        kind: "buffer",
        version: 1,
        on: true,
        parameters: { checkingAccountId: checking?.id, savingsAccountId: houseFund?.id, buffer: 1_500_00 },
      }),
    ]);
  });

  it("refuses parameters that don't match the buffer schema", () => {
    const bank = openTestBank();
    const sam = signInByName(bank, "Sam Calloway");
    const [checking, houseFund] = bank.customerData.listAccounts(sam);
    const valid = { checkingAccountId: checking?.id, savingsAccountId: houseFund?.id, buffer: 1_500_00 };

    for (const parameters of [
      { ...valid, buffer: 12.5 },
      { ...valid, buffer: -1 },
      { ...valid, savingsAccountId: "House fund" },
      { checkingAccountId: checking?.id, buffer: 1_500_00 },
      { ...valid, extra: true },
      null,
    ]) {
      expect(() => bank.customerData.createRule(sam, { kind: "buffer", parameters, on: true })).toThrow(
        RuleParametersError,
      );
    }
    expect(bank.customerData.listRules(sam)).toHaveLength(1);
  });

  it("switching a Rule off writes a new version and keeps the old one", () => {
    const bank = openTestBank();
    const sam = signInByName(bank, "Sam Calloway");
    const [rule] = bank.customerData.listRules(sam);
    if (!rule) throw new Error("Sam's buffer Rule is missing");

    const switched = bank.customerData.switchRule(sam, rule.id, false);

    expect(switched).toMatchObject({ id: rule.id, version: 2, on: false, parameters: rule.parameters });
    expect(bank.customerData.listRules(sam)).toEqual([switched]);
    expect(bank.customerData.getRule(sam, rule.id, 1)).toEqual(rule);
  });

  it("gives Safe to spend its Buffer", () => {
    const bank = openTestBank();
    const sam = signInByName(bank, "Sam Calloway");
    const [checking, houseFund] = bank.customerData.listAccounts(sam);
    const [seeded] = bank.customerData.listRules(sam);
    if (!checking || !houseFund || !seeded) throw new Error("Sam's seed data is missing");
    bank.customerData.switchRule(sam, seeded.id, false);
    bank.customerData.createRule(sam, {
      kind: "buffer",
      parameters: { checkingAccountId: checking.id, savingsAccountId: houseFund.id, buffer: cents(200_00) },
      on: true,
    });

    expect(bank.readHome(sam).safeToSpend).toMatchObject({ buffer: 200_00, amount: 27_00 });
  });

  it("Priya can't read Sam's Rules", () => {
    const bank = openTestBank();
    const sam = signInByName(bank, "Sam Calloway");
    const priya = signInByName(bank, "Priya Natarajan");
    const [samsRule] = bank.customerData.listRules(sam);
    if (!samsRule) throw new Error("Sam's buffer Rule is missing");

    expect(bank.customerData.listRules(priya).map((rule) => rule.id)).not.toContain(samsRule.id);
    expect(bank.customerData.getRule(priya, samsRule.id)).toBeUndefined();
    expect(() => bank.customerData.switchRule(priya, samsRule.id, false)).toThrow();
    expect(bank.customerData.getRule(sam, samsRule.id)?.on).toBe(true);
  });
});
