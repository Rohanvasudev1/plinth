import { describe, expect, it } from "vitest";
import { createBank, type Bank } from "./bank";
import { fixedClock } from "./clock";
import type { Customer } from "./customer-data";
import { openTestDatabase } from "./db/database";
import { cents } from "./money";
import { agentEntriesIn, entriesMoving, openTestBank, signInByName } from "./test-bank";

/** Friday 20 November 2026, 9am in New York: Acme Corp's first payday. */
const FIRST_PAYDAY_9AM = new Date("2026-11-20T14:00:00Z");

function bankAt(at: Date): Bank {
  return createBank({ db: openTestDatabase(), clock: fixedClock(at) });
}

function balancesOf(bank: Bank, customer: Customer) {
  const [checking, savings] = bank.customerData.listAccounts(customer);
  return { checking: checking?.balance, savings: savings?.balance };
}

describe("Sweep", () => {
  it("moves exactly $340 from Checking to the House fund when Sam's 20 Nov paycheck posts", () => {
    const bank = bankAt(FIRST_PAYDAY_9AM);
    const sam = signInByName(bank, "Sam Calloway");

    bank.postPaycheck();

    expect(balancesOf(bank, sam)).toEqual({ checking: 3_127_00, savings: 12_740_00 });
  });

  it("posts the sweep under the key sweep:<ledger event id> of the paycheck", () => {
    const bank = bankAt(FIRST_PAYDAY_9AM);
    const sam = signInByName(bank, "Sam Calloway");
    const [checking, houseFund] = bank.customerData.listAccounts(sam);
    const paycheckEvents: number[] = [];
    bank.ledgerEvents.subscribe((event) => paycheckEvents.push(event.id));

    bank.postPaycheck();

    const sweep = bank.customerData.findLedgerTransaction(sam, `sweep:${paycheckEvents[0]}`);
    expect(sweep?.entries).toEqual([
      { accountId: checking?.id, amount: -340_00 },
      { accountId: houseFund?.id, amount: 340_00 },
    ]);
  });

  it("sweeps when advancing the clock posts the paycheck", () => {
    const bank = openTestBank();
    const sam = signInByName(bank, "Sam Calloway");

    bank.advanceClock();

    expect(balancesOf(bank, sam)).toEqual({ checking: 3_127_00, savings: 12_740_00 });
    expect(bank.readHome(sam).safeToSpend?.amount).toBe(0);
  });

  it("rounds the sweep down to whole dollars", () => {
    const bank = bankAt(FIRST_PAYDAY_9AM);
    const sam = signInByName(bank, "Sam Calloway");
    const [checking] = bank.customerData.listAccounts(sam);
    if (!checking) throw new Error("Sam's Checking is missing");
    bank.cardPurchase(sam, { accountId: checking.id, amount: cents(1_01), idempotencyKey: "card:coffee" });

    bank.postPaycheck();

    // $3,465.99 in checking less $1,500 and $1,627 leaves $338.99, swept as $338.
    expect(balancesOf(bank, sam)).toEqual({ checking: 3_127_99, savings: 12_738_00 });
  });

  it("doesn't sweep twice when the same paycheck is posted again", () => {
    const bank = bankAt(FIRST_PAYDAY_9AM);
    const sam = signInByName(bank, "Sam Calloway");

    bank.postPaycheck();
    bank.postPaycheck();

    expect(balancesOf(bank, sam)).toEqual({ checking: 3_127_00, savings: 12_740_00 });
    expect(bank.readDecisionLog(sam)).toHaveLength(1);
  });

  it("moves nothing and logs nothing when nothing is above the Buffer", () => {
    // After the paycheck, $3,467 less a $1,840 Buffer less $1,627 of bills leaves exactly $0, and with a $1,839
    // Buffer after a 50-cent card purchase it leaves 50 cents, which rounds down to $0.
    for (const { buffer, spent } of [
      { buffer: 1_840_00, spent: 0 },
      { buffer: 1_839_00, spent: 50 },
      { buffer: 2_500_00, spent: 0 },
    ]) {
      const bank = bankAt(FIRST_PAYDAY_9AM);
      const sam = signInByName(bank, "Sam Calloway");
      replaceBufferRule(bank, sam, buffer);
      const [checking] = bank.customerData.listAccounts(sam);
      if (spent > 0 && checking) {
        bank.cardPurchase(sam, { accountId: checking.id, amount: cents(spent), idempotencyKey: "card:coffee" });
      }

      bank.postPaycheck();

      expect(balancesOf(bank, sam)).toEqual({ checking: 3_467_00 - spent, savings: 12_400_00 });
      expect(agentEntriesIn(bank, sam)).toEqual([]);
    }
  });

  it("moves nothing and logs nothing when the buffer Rule is switched off", () => {
    const bank = bankAt(FIRST_PAYDAY_9AM);
    const sam = signInByName(bank, "Sam Calloway");
    const [rule] = bank.customerData.listRules(sam);
    if (!rule) throw new Error("Sam's buffer Rule is missing");
    bank.switchRule(sam, rule.id, false);

    bank.postPaycheck();

    expect(balancesOf(bank, sam)).toEqual({ checking: 3_467_00, savings: 12_400_00 });
    expect(agentEntriesIn(bank, sam)).toEqual([]);
  });

  it("doesn't sweep after money comes into checking from anywhere but an employer", () => {
    const bank = openTestBank();
    const sam = signInByName(bank, "Sam Calloway");
    const [checking, houseFund] = bank.customerData.listAccounts(sam);
    if (!checking || !houseFund) throw new Error("Sam's accounts are missing");

    bank.customerData.postLedgerTransaction(sam, {
      idempotencyKey: "test:top-up",
      description: "Move from the House fund",
      entries: entriesMoving(5_000_00, houseFund.id, checking.id),
    });

    expect(agentEntriesIn(bank, sam)).toEqual([]);
    expect(balancesOf(bank, sam)).toEqual({ checking: 5_227_00, savings: 7_400_00 });
  });
});

/** Switches off the customer's seeded buffer Rule and creates one with the same accounts and a new Buffer. */
function replaceBufferRule(bank: Bank, customer: Customer, buffer: number) {
  const [seeded] = bank.customerData.listRules(customer);
  if (!seeded) throw new Error("The seeded buffer Rule is missing");
  bank.switchRule(customer, seeded.id, false);
  return bank.customerData.createRule(customer, {
    kind: "buffer",
    parameters: { ...seeded.parameters, buffer: cents(buffer) },
    on: true,
  });
}
