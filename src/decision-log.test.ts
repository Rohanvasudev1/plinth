import { describe, expect, it } from "vitest";
import { createBank, type Bank } from "./bank";
import { fixedClock } from "./clock";
import { openTestDatabase } from "./db/database";
import { cents } from "./money";
import { agentEntriesIn, entriesMoving, openTestBank, signInByName } from "./test-bank";

function bankAt(at: string): Bank {
  return createBank({ db: openTestDatabase(), clock: fixedClock(new Date(at)) });
}

describe("Decision log", () => {
  it("records Sam's $340 sweep with its time, trigger, Rule version, action, amount, result and Why", () => {
    const bank = bankAt("2026-11-20T14:00:00Z");
    const sam = signInByName(bank, "Sam Calloway");
    const [checking, houseFund] = bank.customerData.listAccounts(sam);
    const [rule] = bank.customerData.listRules(sam);
    const events: number[] = [];
    bank.ledgerEvents.subscribe((event) => events.push(event.id));

    bank.postPaycheck();

    const [paycheckEvent] = events;
    const sweep = bank.customerData.findLedgerTransaction(sam, `sweep:${paycheckEvent}`);
    expect(bank.readDecisionLog(sam)).toEqual([
      {
        id: expect.any(Number),
        at: new Date("2026-11-20T14:00:00Z"),
        actor: "agent",
        trigger: { ledgerEventId: paycheckEvent, description: "Paycheck from Acme Corp" },
        rule: { id: rule?.id, version: 1 },
        action: "Moved $340 to House fund",
        fromAccountId: checking?.id,
        toAccountId: houseFund?.id,
        amount: 340_00,
        result: "Done",
        refusedBy: null,
        why: [
          { label: "Trigger", value: "Paycheck of $3,240.00 from Acme Corp posted" },
          {
            label: "Bills before payday",
            value: "$1,627.00 before payday on Fri 4 Dec: Rent $1,450, Internet $62, Phone $45, Power $70",
          },
          { label: "Rule", value: "Buffer Rule v1: keep $1,500 in Checking, move the rest to House fund" },
          {
            label: "Amount",
            value: "$3,467.00 in Checking, less $1,500.00 Buffer and $1,627.00 of bills, rounded down to $340.00",
          },
          { label: "Checked by", value: "Guardrails passed: Pause, ownership, positive amount, Rule on, Buffer kept" },
        ],
        ledgerTransactionId: sweep?.id,
        reversesDecisionId: null,
        reversedByDecisionId: null,
      },
    ]);
  });

  it("records the Rule version in force, so an entry still explains itself after the Rule changes", () => {
    const bank = bankAt("2026-11-20T14:00:00Z");
    const sam = signInByName(bank, "Sam Calloway");
    const [rule] = bank.customerData.listRules(sam);
    if (!rule) throw new Error("Sam's buffer Rule is missing");
    bank.switchRule(sam, rule.id, false);
    bank.switchRule(sam, rule.id, true);

    bank.postPaycheck();
    bank.switchRule(sam, rule.id, false);

    expect(agentEntriesIn(bank, sam).map((entry) => entry.rule)).toEqual([{ id: rule.id, version: 3 }]);
  });

  it("lists entries newest first", () => {
    const bank = openTestBank();
    const sam = signInByName(bank, "Sam Calloway");

    for (let day = 0; day < 30; day++) bank.advanceClock();

    const times = bank.readDecisionLog(sam).map((entry) => entry.at.toISOString());
    expect(times).toEqual(["2026-12-18T14:00:00.000Z", "2026-12-04T14:00:00.000Z", "2026-11-20T14:00:00.000Z"]);
  });

  it("writes a Refused entry naming the guardrail, and moves nothing, when the Rule names an account that isn't the customer's", () => {
    // Priya's 25 Nov paycheck would sweep $2,569, but her Rule points at Sam's House fund.
    const bank = bankAt("2026-11-25T14:00:00Z");
    const sam = signInByName(bank, "Sam Calloway");
    const priya = signInByName(bank, "Priya Natarajan");
    const [, samsHouseFund] = bank.customerData.listAccounts(sam);
    const [priyasChecking] = bank.customerData.listAccounts(priya);
    const [seeded] = bank.customerData.listRules(priya);
    if (!samsHouseFund || !priyasChecking || !seeded) throw new Error("Seed data is missing");
    bank.switchRule(priya, seeded.id, false);
    const misdirected = bank.customerData.createRule(priya, {
      kind: "buffer",
      parameters: { ...seeded.parameters, savingsAccountId: samsHouseFund.id },
      on: true,
    });

    bank.postPaycheck();

    expect(agentEntriesIn(bank, priya)).toEqual([
      expect.objectContaining({
        rule: { id: misdirected.id, version: 1 },
        action: "Move $2,569 to savings",
        fromAccountId: priyasChecking.id,
        toAccountId: null,
        amount: 2_569_00,
        result: "Refused",
        refusedBy: "ownership",
        ledgerTransactionId: null,
        why: expect.arrayContaining([
          { label: "Checked by", value: "Refused by the ownership guardrail: the Rule must name your own checking and savings accounts" },
        ]),
      }),
    ]);
    expect(bank.customerData.getAccount(priya, priyasChecking.id)?.balance).toBe(1_836_42 + 2_480_00);
    expect(bank.customerData.getAccount(sam, samsHouseFund.id)?.balance).toBe(12_400_00);
    expect(bank.readDecisionLog(sam)).toEqual([]);
  });

  it("writes a Refused ownership entry when the Rule's checking account isn't a checking account", () => {
    // Priya's Rule has her accounts the wrong way round, and a paycheck lands in her Travel fund.
    const bank = bankAt("2026-11-25T14:00:00Z");
    const priya = signInByName(bank, "Priya Natarajan");
    const [checking, travelFund] = bank.customerData.listAccounts(priya);
    const [seeded] = bank.customerData.listRules(priya);
    if (!checking || !travelFund || seeded?.kind !== "buffer") throw new Error("Seed data is missing");
    bank.switchRule(priya, seeded.id, false);
    const swapped = bank.customerData.createRule(priya, {
      kind: "buffer",
      parameters: { checkingAccountId: travelFund.id, savingsAccountId: checking.id, buffer: seeded.parameters.buffer },
      on: true,
    });

    bank.customerData.postLedgerTransaction(priya, {
      idempotencyKey: "payroll:acme-corp:bonus",
      description: "Bonus from Acme Corp",
      entries: entriesMoving(1_000_00, bank.systemData.ensureSystemAccount("acmePayroll"), travelFund.id),
    });

    expect(agentEntriesIn(bank, priya)).toEqual([
      expect.objectContaining({
        rule: { id: swapped.id, version: 1 },
        result: "Refused",
        refusedBy: "ownership",
        fromAccountId: travelFund.id,
        toAccountId: checking.id,
        ledgerTransactionId: null,
      }),
    ]);
    expect(bank.customerData.listAccounts(priya).map((account) => account.balance)).toEqual([1_836_42, 3_150_00]);
  });

  it("can't name another customer's account on an entry", () => {
    const bank = openTestBank();
    const sam = signInByName(bank, "Sam Calloway");
    const priya = signInByName(bank, "Priya Natarajan");
    const [, samsHouseFund] = bank.customerData.listAccounts(sam);
    const [priyasChecking] = bank.customerData.listAccounts(priya);
    const [priyasRule] = bank.customerData.listRules(priya);
    if (!samsHouseFund || !priyasChecking || !priyasRule) throw new Error("Seed data is missing");

    expect(() =>
      bank.customerData.recordDecision(priya, {
        actor: "agent",
        trigger: { ledgerEventId: null, description: "Test" },
        rule: { id: priyasRule.id, version: priyasRule.version },
        action: "Move $1 to House fund",
        fromAccountId: priyasChecking.id,
        toAccountId: samsHouseFund.id,
        amount: cents(1_00),
        result: "Refused",
        refusedBy: "ownership",
        why: [],
        ledgerTransactionId: null,
        reversesDecisionId: null,
      }),
    ).toThrow(/own accounts/);
    expect(bank.readDecisionLog(priya)).toEqual([]);
  });

  it("Priya can't read Sam's Decision log", () => {
    const bank = bankAt("2026-11-20T14:00:00Z");
    const sam = signInByName(bank, "Sam Calloway");
    const priya = signInByName(bank, "Priya Natarajan");

    bank.postPaycheck();

    expect(bank.readDecisionLog(sam)).toHaveLength(1);
    expect(bank.readDecisionLog(priya)).toEqual([]);
  });
});
