import { describe, expect, it } from "vitest";
import { createBank, type Bank } from "./bank";
import { fixedClock } from "./clock";
import { openTestDatabase } from "./db/database";
import { ledgerEntriesTable } from "./db/schema";
import type { Customer } from "./customer-data";
import type { LedgerEvent } from "./ledger-events";
import { cents } from "./money";
import { entriesMoving, openTestBank, signInByName } from "./test-bank";

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
      entries: entriesMoving(100_00, checking.id, houseFund.id),
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
      expect(transaction.entries).toHaveLength(2);
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

  it("refuses a ledger transaction that isn't made of pairs of entries", () => {
    const bank = openTestBank();
    const { sam, checking, houseFund } = samAndAccounts(bank);

    expect(() =>
      bank.customerData.postLedgerTransaction(sam, {
        idempotencyKey: "test:three-entries",
        description: "Three entries",
        entries: [
          { accountId: checking.id, amount: cents(-10_00) },
          { accountId: houseFund.id, amount: cents(5_00) },
          { accountId: houseFund.id, amount: cents(5_00) },
        ],
      }),
    ).toThrow(/pair/);
  });

  it("posts several pairs as one ledger transaction, but refuses pairs that only sum to zero together", () => {
    const bank = openTestBank();
    const { sam, checking, houseFund } = samAndAccounts(bank);

    expect(() =>
      bank.customerData.postLedgerTransaction(sam, {
        idempotencyKey: "test:unbalanced-pairs",
        description: "Pairs that sum to zero only together",
        entries: [
          { accountId: checking.id, amount: cents(-10_00) },
          { accountId: houseFund.id, amount: cents(4_00) },
          { accountId: houseFund.id, amount: cents(7_00) },
          { accountId: checking.id, amount: cents(-1_00) },
        ],
      }),
    ).toThrow(/sum to zero/);

    bank.customerData.postLedgerTransaction(sam, {
      idempotencyKey: "test:two-pairs",
      description: "Two pairs",
      entries: [...entriesMoving(10_00, checking.id, houseFund.id), ...entriesMoving(5_00, houseFund.id, checking.id)],
    });

    expect(balanceOf(bank, sam, checking.id)).toBe(222_00);
    expect(balanceOf(bank, sam, houseFund.id)).toBe(12_405_00);
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

  it("treats Sam posting the same idempotency key twice as a no-op that returns the first ledger transaction", () => {
    const bank = openTestBank();
    const { sam, checking } = samAndAccounts(bank);
    const acmePayroll = bank.systemData.ensureSystemAccount("acmePayroll");
    const pay = (amount: number) =>
      bank.customerData.postLedgerTransaction(sam, {
        idempotencyKey: "payroll:acme:2026-11-20",
        description: "Acme Corp payroll",
        entries: entriesMoving(amount, acmePayroll, checking.id),
      });

    const first = pay(3_240_00);
    const repeat = pay(1_00);

    expect(first.created).toBe(true);
    expect(repeat).toEqual({ ...first, created: false });
    const posted = bank.customerData.listLedgerTransactions(sam).filter((t) => t.idempotencyKey === "payroll:acme:2026-11-20");
    expect(posted).toEqual([expect.objectContaining({ id: first.ledgerTransactionId })]);
    expect(posted[0]?.entries).toContainEqual({ accountId: checking.id, amount: 3_240_00 });
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
        entries: entriesMoving(27_00, checking.id, houseFund.id),
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
        entries: entriesMoving(10_00, checking.id, houseFund.id),
      });
    });

    bank.customerData.postLedgerTransaction(sam, {
      idempotencyKey: "test:trigger",
      description: "Trigger",
      entries: entriesMoving(100_00, houseFund.id, checking.id),
    });

    expect(balanceOf(bank, sam, checking.id)).toBe(317_00);
  });

  it("refuses to update or delete a posted ledger entry", () => {
    const db = openTestDatabase();
    createBank({ db, clock: fixedClock(new Date("2026-11-19T14:00:00Z")) });

    expect(() => db.update(ledgerEntriesTable).set({ amountCents: 1_000_000_00 }).run()).toThrow(/append-only/);
    expect(() => db.delete(ledgerEntriesTable).run()).toThrow(/append-only/);
    expect(db.select().from(ledgerEntriesTable).all().length).toBeGreaterThan(0);
  });
});

describe("one transaction around several ledger transactions", () => {
  it("keeps nothing and tells no subscriber when the block throws", () => {
    const bank = openTestBank();
    const { sam, checking, houseFund } = samAndAccounts(bank);
    const heard: LedgerEvent[] = [];
    bank.ledgerEvents.subscribe((event) => heard.push(event));

    expect(() =>
      bank.customerData.inOneTransaction(() => {
        bank.customerData.postLedgerTransaction(sam, {
          idempotencyKey: "test:in-block",
          description: "Move $100",
          entries: entriesMoving(100_00, checking.id, houseFund.id),
        });
        throw new Error("Something later in the block failed");
      }),
    ).toThrow("Something later in the block failed");

    expect(balanceOf(bank, sam, checking.id)).toBe(227_00);
    expect(bank.customerData.findLedgerTransaction(sam, "test:in-block")).toBeUndefined();
    expect(heard).toEqual([]);
  });

  it("tells subscribers about every posting only once the whole block has committed", () => {
    const bank = openTestBank();
    const { sam, checking, houseFund } = samAndAccounts(bank);
    const heard: string[] = [];
    bank.ledgerEvents.subscribe(() => heard.push("event"));

    bank.customerData.inOneTransaction(() => {
      for (const key of ["test:first", "test:second"]) {
        bank.customerData.postLedgerTransaction(sam, {
          idempotencyKey: key,
          description: "Move $1",
          entries: entriesMoving(1_00, checking.id, houseFund.id),
        });
      }
      heard.push("block done");
    });

    expect(heard).toEqual(["block done", "event", "event"]);
    expect(balanceOf(bank, sam, checking.id)).toBe(225_00);
  });
});
