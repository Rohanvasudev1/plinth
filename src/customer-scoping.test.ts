import { describe, expect, it } from "vitest";
import { localDate } from "./calendar";
import { cents } from "./money";
import { entriesMoving, openTestBank, signInByName } from "./test-bank";

describe("customer scoping", () => {
  it("Priya can't read Sam's accounts", () => {
    const bank = openTestBank();
    const sam = signInByName(bank, "Sam Calloway");
    const priya = signInByName(bank, "Priya Natarajan");
    const samsAccountIds = bank.customerData.listAccounts(sam).map((account) => account.id);

    const priyasAccounts = bank.customerData.listAccounts(priya);

    expect(samsAccountIds).toHaveLength(2);
    expect(priyasAccounts.map((account) => account.name)).toEqual(["Checking", "Travel fund"]);
    for (const accountId of samsAccountIds) {
      expect(priyasAccounts.map((account) => account.id)).not.toContain(accountId);
      expect(bank.customerData.getAccount(priya, accountId)).toBeUndefined();
    }
  });

  it("Priya's Home shows her own balances, not Sam's", () => {
    const bank = openTestBank();
    const priya = signInByName(bank, "Priya Natarajan");

    const home = bank.readHome(priya);

    expect(home.customerName).toBe("Priya Natarajan");
    expect(home.checking).toMatchObject({ name: "Checking", balance: 1_836_42 });
    expect(home.savings).toEqual([
      expect.objectContaining({ name: "Travel fund", balance: 2_150_00, goal: { target: 6_000_00, percentReached: 35 } }),
    ]);
  });

  it("Priya can't read Sam's ledger transactions", () => {
    const bank = openTestBank();
    const sam = signInByName(bank, "Sam Calloway");
    const priya = signInByName(bank, "Priya Natarajan");
    const samsAccountIds = new Set(bank.customerData.listAccounts(sam).map((account) => account.id));

    const priyasEntries = bank.customerData.listLedgerTransactions(priya).flatMap((transaction) => transaction.entries);

    expect(priyasEntries.length).toBeGreaterThan(0);
    expect(priyasEntries.filter((entry) => samsAccountIds.has(entry.accountId))).toEqual([]);
  });

  it("Priya can't move money out of Sam's account", () => {
    const bank = openTestBank();
    const sam = signInByName(bank, "Sam Calloway");
    const priya = signInByName(bank, "Priya Natarajan");
    const [samsChecking] = bank.customerData.listAccounts(sam);
    const [priyasChecking] = bank.customerData.listAccounts(priya);
    if (!samsChecking || !priyasChecking) throw new Error("Seeded accounts are missing");

    expect(() =>
      bank.customerData.postLedgerTransaction(priya, {
        idempotencyKey: "test:steal",
        description: "Take Sam's money",
        entries: entriesMoving(100_00, samsChecking.id, priyasChecking.id),
      }),
    ).toThrow(/own account/);
    expect(bank.customerData.getAccount(sam, samsChecking.id)?.balance).toBe(227_00);
  });

  it("lets one employer pay Sam and Priya under the same idempotency key on the same date", () => {
    const bank = openTestBank();
    const acmePayroll = bank.systemData.ensureSystemAccount("acmePayroll");
    const pay = (name: string, amount: number) => {
      const customer = signInByName(bank, name);
      const [checking] = bank.customerData.listAccounts(customer);
      if (!checking) throw new Error(`${name}'s checking account is missing`);
      const posted = bank.customerData.postLedgerTransaction(customer, {
        idempotencyKey: "payroll:acme:2026-11-20",
        description: "Acme Corp payroll",
        entries: entriesMoving(amount, acmePayroll, checking.id),
      });
      const entries = bank.customerData.getLedgerTransaction(customer, posted.ledgerTransactionId)?.entries;
      return { posted, paid: entries?.find((entry) => entry.accountId === checking.id)?.amount };
    };

    const sam = pay("Sam Calloway", 3_240_00);
    const priya = pay("Priya Natarajan", 2_500_00);

    expect(sam.posted.created).toBe(true);
    expect(priya.posted.created).toBe(true);
    expect(priya.posted.ledgerTransactionId).not.toBe(sam.posted.ledgerTransactionId);
    expect(sam.paid).toBe(3_240_00);
    expect(priya.paid).toBe(2_500_00);
  });

  it("Priya can't read Sam's payroll or set up a payroll into Sam's account", () => {
    const bank = openTestBank();
    const sam = signInByName(bank, "Sam Calloway");
    const priya = signInByName(bank, "Priya Natarajan");
    const [samsChecking] = bank.customerData.listAccounts(sam);
    if (!samsChecking) throw new Error("Sam's checking is missing");

    expect(bank.customerData.listPayrolls(sam)).toHaveLength(1);
    expect(bank.customerData.listPayrolls(priya).map((payroll) => payroll.accountId)).not.toContain(samsChecking.id);
    expect(() =>
      bank.customerData.addPayroll(priya, {
        accountId: samsChecking.id,
        employer: "acme-corp",
        amount: cents(1_00),
        firstPayDate: localDate("2026-11-20"),
        intervalDays: 14,
      }),
    ).toThrow();
    expect(bank.customerData.listPayrolls(sam)).toHaveLength(1);
  });

  it("Priya can't read Sam's Scheduled bills or pay a bill from Sam's account", () => {
    const bank = openTestBank();
    const sam = signInByName(bank, "Sam Calloway");
    const priya = signInByName(bank, "Priya Natarajan");
    const [samsChecking] = bank.customerData.listAccounts(sam);
    if (!samsChecking) throw new Error("Sam's checking is missing");

    expect(bank.customerData.listScheduledBills(priya).map((bill) => bill.accountId)).not.toContain(samsChecking.id);
    expect(bank.billsBeforePayday(priya).bills.map((bill) => bill.payee)).not.toContain("Internet");
    expect(() =>
      bank.customerData.addScheduledBill(priya, {
        accountId: samsChecking.id,
        payee: "Rent",
        category: "Housing",
        amount: cents(1_00),
        dayOfMonth: 1,
      }),
    ).toThrow();
    expect(bank.customerData.listScheduledBills(sam)).toHaveLength(4);
  });
});
