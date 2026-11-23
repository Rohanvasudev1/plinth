import { describe, expect, it } from "vitest";
import type { Bank } from "./bank";
import type { Customer } from "./customer-data";
import type { LedgerEvent } from "./ledger-events";
import { cents } from "./money";
import { openTestBank, signInByName } from "./test-bank";

function samAndAccounts(bank: Bank) {
  const sam = signInByName(bank, "Sam Calloway");
  const [checking, houseFund] = bank.customerData.listAccounts(sam);
  if (!checking || !houseFund) throw new Error("Sam's seeded accounts are missing");
  return { sam, checking, houseFund };
}

function balanceOf(bank: Bank, customer: Customer, accountId: number) {
  return bank.customerData.getAccount(customer, accountId)?.balance;
}

describe("ledger", () => {
  it("moves money between accounts with entries that sum to zero", () => {
    const bank = openTestBank();
    const { sam, checking, houseFund } = samAndAccounts(bank);

    bank.customerData.postLedgerTransaction(sam, {
      idempotencyKey: "test:move-100",
      description: "Move $100",
      entries: [
        { accountId: checking.id, amount: cents(-100_00) },
        { accountId: houseFund.id, amount: cents(100_00) },
      ],
    });

    expect(balanceOf(bank, sam, checking.id)).toBe(127_00);
    expect(balanceOf(bank, sam, houseFund.id)).toBe(12_500_00);
  });

  it("every posted ledger transaction sums to zero, including the seeded ones", () => {
    const bank = openTestBank();
    const { sam } = samAndAccounts(bank);

    const transactions = bank.customerData.listLedgerTransactions(sam);

    expect(transactions.length).toBeGreaterThan(0);
    for (const transaction of transactions) {
      expect(transaction.entries.length).toBeGreaterThanOrEqual(2);
      expect(transaction.entries.reduce((sum, entry) => sum + entry.amount, 0)).toBe(0);
    }
  });

  it("refuses entries that don't sum to zero and changes nothing", () => {
    const bank = openTestBank();
    const { sam, checking, houseFund } = samAndAccounts(bank);
    const before = bank.customerData.listLedgerTransactions(sam).length;

    expect(() =>
      bank.customerData.postLedgerTransaction(sam, {
        idempotencyKey: "test:unbalanced",
        description: "Unbalanced",
        entries: [
          { accountId: checking.id, amount: cents(-100_00) },
          { accountId: houseFund.id, amount: cents(99_99) },
        ],
      }),
    ).toThrow(/sum to zero/);

    expect(balanceOf(bank, sam, checking.id)).toBe(227_00);
    expect(balanceOf(bank, sam, houseFund.id)).toBe(12_400_00);
    expect(bank.customerData.listLedgerTransactions(sam)).toHaveLength(before);
  });

  it("refuses amounts that aren't whole cents", () => {
    const bank = openTestBank();
    const { sam, checking, houseFund } = samAndAccounts(bank);

    expect(() =>
      bank.customerData.postLedgerTransaction(sam, {
        idempotencyKey: "test:fractional",
        description: "Fractional",
        entries: [
          { accountId: checking.id, amount: -0.5 as never },
          { accountId: houseFund.id, amount: 0.5 as never },
        ],
      }),
    ).toThrow(RangeError);
  });

  it("treats a repeated idempotency key as a no-op that returns the first ledger transaction", () => {
    const bank = openTestBank();
    const { sam, checking, houseFund } = samAndAccounts(bank);
    const move = (amount: number) =>
      bank.customerData.postLedgerTransaction(sam, {
        idempotencyKey: "test:same-key",
        description: "Move",
        entries: [
          { accountId: checking.id, amount: cents(-amount) },
          { accountId: houseFund.id, amount: cents(amount) },
        ],
      });

    const first = move(100_00);
    const repeat = move(50_00);

    expect(first.created).toBe(true);
    expect(repeat).toEqual({ ...first, created: false });
    expect(balanceOf(bank, sam, checking.id)).toBe(127_00);
    expect(balanceOf(bank, sam, houseFund.id)).toBe(12_500_00);
  });

  it("hands each new ledger event to subscribers once, with its entries already posted, and never for a repeated key", () => {
    const bank = openTestBank();
    const { sam, checking, houseFund } = samAndAccounts(bank);
    const seen: { event: LedgerEvent; checkingBalance: number | undefined }[] = [];
    bank.ledgerEvents.subscribe((event) => {
      seen.push({ event, checkingBalance: balanceOf(bank, sam, checking.id) });
    });
    const move = () =>
      bank.customerData.postLedgerTransaction(sam, {
        idempotencyKey: "test:dispatch",
        description: "Move",
        entries: [
          { accountId: checking.id, amount: cents(-27_00) },
          { accountId: houseFund.id, amount: cents(27_00) },
        ],
      });

    const posted = move();
    move();

    expect(seen).toEqual([
      {
        event: expect.objectContaining({
          id: posted.ledgerEventId,
          customerId: sam.id,
          ledgerTransactionId: posted.ledgerTransactionId,
        }),
        checkingBalance: 200_00,
      },
    ]);
  });

  it("lets a subscriber post its own ledger transaction in response to an event", () => {
    const bank = openTestBank();
    const { sam, checking, houseFund } = samAndAccounts(bank);
    let followUps = 0;
    bank.ledgerEvents.subscribe((event) => {
      if (followUps++ > 0) return;
      bank.customerData.postLedgerTransaction(sam, {
        idempotencyKey: `test:follow-up:${event.id}`,
        description: "Follow-up move",
        entries: [
          { accountId: checking.id, amount: cents(-10_00) },
          { accountId: houseFund.id, amount: cents(10_00) },
        ],
      });
    });

    bank.customerData.postLedgerTransaction(sam, {
      idempotencyKey: "test:trigger",
      description: "Trigger",
      entries: [
        { accountId: houseFund.id, amount: cents(-100_00) },
        { accountId: checking.id, amount: cents(100_00) },
      ],
    });

    expect(balanceOf(bank, sam, checking.id)).toBe(317_00);
  });
});
