import { describe, expect, it } from "vitest";
import { cents } from "./money";
import { createBank, type Bank } from "./bank";
import { fixedClock } from "./clock";
import { openTestDatabase } from "./db/database";
import { RuleNotFoundError, type Customer } from "./customer-data";
import { RuleParametersError, type PaymentLimitRule } from "./rules";
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
      expect.objectContaining({ kind: "payment_limit" }),
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
    expect(bank.customerData.listRules(sam)).toHaveLength(2);
  });

  it("switching a Rule off writes a new version and keeps the old one", () => {
    const bank = openTestBank();
    const sam = signInByName(bank, "Sam Calloway");
    const [rule] = bank.customerData.listRules(sam);
    if (!rule) throw new Error("Sam's buffer Rule is missing");

    const switched = bank.customerData.switchRule(sam, rule.id, false);

    expect(switched).toMatchObject({ id: rule.id, version: 2, on: false, parameters: rule.parameters });
    expect(bank.customerData.listRules(sam)[0]).toEqual(switched);
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

  it("Priya can't switch or change Sam's Rules through Agent & limits", () => {
    const bank = openTestBank();
    const sam = signInByName(bank, "Sam Calloway");
    const priya = signInByName(bank, "Priya Natarajan");
    const before = bank.customerData.listRules(sam);
    const [samsBuffer, samsLimit] = before;
    if (!samsBuffer || !samsLimit) throw new Error("Sam's Rules are missing");

    expect(() => bank.switchRule(priya, samsBuffer.id, false)).toThrow(RuleNotFoundError);
    expect(() => bank.setBuffer(priya, samsBuffer.id, cents(0))).toThrow(RuleNotFoundError);
    expect(() => bank.setPaymentLimit(priya, samsLimit.id, cents(10_000_00))).toThrow(RuleNotFoundError);

    expect(bank.customerData.listRules(sam)).toEqual(before);
    expect(bank.readDecisionLog(sam)).toEqual([]);
    expect(bank.readDecisionLog(priya)).toEqual([]);
  });
});

describe("customer changes to the buffer Rule", () => {
  it("changing the Buffer writes a new version and a Decision log entry with Sam as actor", () => {
    const bank = openTestBank();
    const sam = signInByName(bank, "Sam Calloway");
    const [buffer] = bank.customerData.listRules(sam);
    if (buffer?.kind !== "buffer") throw new Error("Sam's buffer Rule is missing");

    const changed = bank.setBuffer(sam, buffer.id, cents(2_000_00));

    expect(changed).toMatchObject({ id: buffer.id, version: 2, parameters: { ...buffer.parameters, buffer: 2_000_00 } });
    expect(bank.readDecisionLog(sam)).toEqual([
      expect.objectContaining({
        actor: "customer",
        rule: { id: buffer.id, version: 2 },
        action: "Changed the Buffer to $2,000",
        result: "Done",
        why: [
          { label: "Trigger", value: "You changed the Buffer on Agent & limits" },
          {
            label: "Before",
            value: "Buffer Rule v1: keep $1,500 in Checking, move the rest to House fund, switched on",
          },
          {
            label: "After",
            value: "Buffer Rule v2: keep $2,000 in Checking, move the rest to House fund, switched on",
          },
        ],
      }),
    ]);
    expect(bank.readHome(sam).safeToSpend?.buffer).toBe(2_000_00);
  });

  it("refuses a Buffer that isn't a whole-dollar amount from $0 to $100,000, and saves nothing", () => {
    const bank = openTestBank();
    const sam = signInByName(bank, "Sam Calloway");
    const [buffer] = bank.customerData.listRules(sam);
    if (!buffer) throw new Error("Sam's buffer Rule is missing");

    for (const amount of [cents(100_000_01), cents(100_001_00), cents(-1_00), cents(1_500_50)]) {
      expect(() => bank.setBuffer(sam, buffer.id, amount)).toThrow(RuleParametersError);
    }
    expect(bank.setBuffer(sam, buffer.id, cents(100_000_00)).version).toBe(2);
    expect(bank.setBuffer(sam, buffer.id, cents(0)).version).toBe(3);

    expect(bank.readDecisionLog(sam)).toHaveLength(2);
  });

  it("refuses to set a Buffer on the payment limit Rule", () => {
    const bank = openTestBank();
    const sam = signInByName(bank, "Sam Calloway");
    const limit = paymentLimitRuleOf(bank, sam);

    expect(() => bank.setBuffer(sam, limit.id, cents(1_000_00))).toThrow(RuleNotFoundError);
    expect(bank.customerData.getRule(sam, limit.id)).toEqual(limit);
    expect(bank.readDecisionLog(sam)).toEqual([]);
  });

  it("switching a Rule off and on writes a version and a Decision log entry each time", () => {
    const bank = openTestBank();
    const sam = signInByName(bank, "Sam Calloway");
    const limit = paymentLimitRuleOf(bank, sam);

    bank.switchRule(sam, limit.id, false);
    bank.switchRule(sam, limit.id, true);

    expect(bank.customerData.getRule(sam, limit.id)).toMatchObject({ version: 3, on: true });
    expect(bank.readDecisionLog(sam).map((entry) => [entry.action, entry.rule, entry.actor])).toEqual([
      ["Switched on the payment limit Rule", { id: limit.id, version: 3 }, "customer"],
      ["Switched off the payment limit Rule", { id: limit.id, version: 2 }, "customer"],
    ]);
    expect(bank.readDecisionLog(sam)[1]?.why).toContainEqual({
      label: "After",
      value: "Payment limit Rule v2: move up to $500 alone, switched off",
    });
  });

  it("an old sweep entry keeps the Rule version it used after Sam changes the Buffer", () => {
    const bank = createBank({ db: openTestDatabase(), clock: fixedClock(new Date("2026-11-20T14:00:00Z")) });
    const sam = signInByName(bank, "Sam Calloway");
    const [buffer] = bank.customerData.listRules(sam);
    if (!buffer) throw new Error("Sam's buffer Rule is missing");
    bank.postPaycheck();

    bank.setBuffer(sam, buffer.id, cents(1_000_00));

    const [change, sweep] = bank.readDecisionLog(sam);
    expect(change?.rule).toEqual({ id: buffer.id, version: 2 });
    expect(sweep?.rule).toEqual({ id: buffer.id, version: 1 });
    expect(sweep?.action).toBe("Moved $340 to House fund");
    expect(bank.customerData.getRule(sam, buffer.id, sweep?.rule?.version)?.parameters).toMatchObject({
      buffer: 1_500_00,
    });
  });
});

describe("payment limit Rule", () => {
  it("is seeded for Sam and Priya at $500, switched on", () => {
    const bank = openTestBank();
    for (const name of ["Sam Calloway", "Priya Natarajan"]) {
      const customer = signInByName(bank, name);
      expect(bank.customerData.listRules(customer)).toContainEqual(
        expect.objectContaining({ kind: "payment_limit", version: 1, on: true, parameters: { paymentLimit: 500_00 } }),
      );
    }
  });

  it("changing the Payment limit writes a new version and a Decision log entry with Sam as actor", () => {
    const bank = openTestBank();
    const sam = signInByName(bank, "Sam Calloway");
    const limit = paymentLimitRuleOf(bank, sam);

    const changed = bank.setPaymentLimit(sam, limit.id, cents(750_00));

    expect(changed).toMatchObject({ id: limit.id, version: 2, on: true, parameters: { paymentLimit: 750_00 } });
    expect(bank.customerData.getRule(sam, limit.id, 1)).toEqual(limit);
    expect(bank.readDecisionLog(sam)).toEqual([
      expect.objectContaining({
        actor: "customer",
        trigger: { ledgerEventId: null, description: "You changed a Rule" },
        rule: { id: limit.id, version: 2 },
        action: "Changed the Payment limit to $750",
        amount: 0,
        result: "Done",
        fromAccountId: null,
        toAccountId: null,
        why: [
          { label: "Trigger", value: "You changed the Payment limit on Agent & limits" },
          { label: "Before", value: "Payment limit Rule v1: move up to $500 alone, switched on" },
          { label: "After", value: "Payment limit Rule v2: move up to $750 alone, switched on" },
        ],
      }),
    ]);
  });

  it("refuses a Payment limit that isn't a whole-dollar amount from $0 to $10,000, and saves nothing", () => {
    const bank = openTestBank();
    const sam = signInByName(bank, "Sam Calloway");
    const limit = paymentLimitRuleOf(bank, sam);

    for (const amount of [cents(10_000_01), cents(10_001_00), cents(-1_00), cents(500_50)]) {
      expect(() => bank.setPaymentLimit(sam, limit.id, amount)).toThrow(RuleParametersError);
    }

    expect(bank.customerData.getRule(sam, limit.id)).toEqual(limit);
    expect(bank.readDecisionLog(sam)).toEqual([]);
  });

  it("takes the Payment limit at both ends of its range", () => {
    const bank = openTestBank();
    const sam = signInByName(bank, "Sam Calloway");
    const limit = paymentLimitRuleOf(bank, sam);

    expect(bank.setPaymentLimit(sam, limit.id, cents(0)).parameters).toEqual({ paymentLimit: 0 });
    expect(bank.setPaymentLimit(sam, limit.id, cents(10_000_00)).parameters).toEqual({ paymentLimit: 10_000_00 });
  });
});

function paymentLimitRuleOf(bank: Bank, customer: Customer): PaymentLimitRule {
  const rule = bank.customerData.listRules(customer).find((candidate) => candidate.kind === "payment_limit");
  if (rule?.kind !== "payment_limit") throw new Error(`${customer.name}'s payment limit Rule is missing`);
  return rule;
}
