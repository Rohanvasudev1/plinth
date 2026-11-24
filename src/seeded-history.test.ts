import { describe, expect, it } from "vitest";
import { createBank, type Bank } from "./bank";
import { localDateOf, type LocalDate } from "./calendar";
import type { Category } from "./categories";
import { fixedClock } from "./clock";
import type { Customer, LedgerTransaction } from "./customer-data";
import { openTestDatabase } from "./db/database";
import { openTestBank, signInByName } from "./test-bank";

/** Friday 20 November 2026, 9am in New York: the first payday after the simulation starts. */
const FIRST_PAYDAY_9AM = new Date("2026-11-20T14:00:00Z");

/** The customer's ledger transactions that carry a Category, which leaves out opening balances. */
function history(bank: Bank, customer: Customer): LedgerTransaction[] {
  return bank.customerData.listLedgerTransactions(customer).filter((transaction) => transaction.category !== null);
}

function dateOf(transaction: LedgerTransaction): LocalDate {
  return localDateOf(transaction.postedAt);
}

/** The amount that left or reached the customer's own accounts, from the side that isn't a system account. */
function amountFor(bank: Bank, customer: Customer, transaction: LedgerTransaction): number {
  const own = new Set(bank.customerData.listAccounts(customer).map((account) => account.id));
  const entry = transaction.entries.find((candidate) => own.has(candidate.accountId) && candidate.amount < 0)
    ?? transaction.entries.find((candidate) => own.has(candidate.accountId));
  return Math.abs(entry?.amount ?? 0);
}

function totalIn(bank: Bank, customer: Customer, month: string, categories: readonly Category[], throughDay = 31): number {
  return history(bank, customer)
    .filter((transaction) => {
      const date = dateOf(transaction);
      return date.startsWith(month) && Number(date.slice(8)) <= throughDay;
    })
    .filter((transaction) => transaction.category !== null && categories.includes(transaction.category))
    .reduce((sum, transaction) => sum + amountFor(bank, customer, transaction), 0);
}

const SPENDING: Category[] = [
  "Housing",
  "Utilities",
  "Groceries",
  "Eating out",
  "Shopping",
  "Transport",
  "Subscriptions",
  "Entertainment",
  "Health",
];

const FULL_MONTHS = ["2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10"];

describe("Sam's seeded history", () => {
  it("leaves Sam with $227.00 in Checking and $12,400.00 in the House fund on 19 Nov", () => {
    const bank = openTestBank();
    const sam = signInByName(bank, "Sam Calloway");

    expect(bank.customerData.listAccounts(sam).map((account) => [account.name, account.balance])).toEqual([
      ["Checking", 227_00],
      ["House fund", 12_400_00],
    ]);
  });

  it("still sweeps exactly $340 when the 20 Nov paycheck posts", () => {
    const bank = createBank({ db: openTestDatabase(), clock: fixedClock(FIRST_PAYDAY_9AM) });
    const sam = signInByName(bank, "Sam Calloway");

    bank.postPaycheck();

    expect(bank.customerData.listAccounts(sam).map((account) => account.balance)).toEqual([3_127_00, 12_740_00]);
    expect(bank.readDecisionLog(sam).map((decision) => decision.action)).toEqual(["Moved $340 to House fund"]);
  });

  it("runs from 1 May to 18 Nov 2026", () => {
    const bank = openTestBank();
    const dates = history(bank, signInByName(bank, "Sam Calloway")).map(dateOf);

    expect(dates[0]).toBe("2026-05-01");
    expect(dates.at(-1)).toBe("2026-11-18");
    expect([...dates].sort()).toEqual(dates);
  });

  it("pays Acme Corp paychecks of $3,240.00 every 14 days, counted back from 20 Nov", () => {
    const bank = openTestBank();
    const sam = signInByName(bank, "Sam Calloway");

    const paychecks = history(bank, sam).filter((transaction) => transaction.category === "Income");

    expect(paychecks.map(dateOf)).toEqual([
      "2026-05-08",
      "2026-05-22",
      "2026-06-05",
      "2026-06-19",
      "2026-07-03",
      "2026-07-17",
      "2026-07-31",
      "2026-08-14",
      "2026-08-28",
      "2026-09-11",
      "2026-09-25",
      "2026-10-09",
      "2026-10-23",
      "2026-11-06",
    ]);
    for (const paycheck of paychecks) {
      expect(paycheck).toMatchObject({ counterparty: "Acme Corp", idempotencyKey: `payroll:acme-corp:${dateOf(paycheck)}` });
      expect(amountFor(bank, sam, paycheck)).toBe(3_240_00);
    }
  });

  it("brings in $6,480.00 in a full month with two paychecks", () => {
    const bank = openTestBank();
    const sam = signInByName(bank, "Sam Calloway");

    expect(totalIn(bank, sam, "2026-10", ["Income"])).toBe(6_480_00);
  });

  it("pays the four Scheduled bills every month, under the bill's own key", () => {
    const bank = openTestBank();
    const sam = signInByName(bank, "Sam Calloway");
    const bills = bank.customerData.listScheduledBills(sam);

    const posted = history(bank, sam).filter((transaction) => transaction.category === "Housing" || transaction.category === "Utilities");

    expect(posted).toHaveLength(4 * 7);
    for (const month of [...FULL_MONTHS, "2026-11"]) {
      const inMonth = posted.filter((transaction) => dateOf(transaction).startsWith(month));
      expect(inMonth.map((transaction) => transaction.counterparty)).toEqual(["Rent", "Internet", "Phone", "Power"]);
      expect(inMonth.map((transaction) => transaction.idempotencyKey)).toEqual(
        bills.map((bill) => `bill:${bill.id}:${month}-0${bill.dayOfMonth}`),
      );
    }
  });

  it("spends $5,108.00 on Card purchases and Scheduled bills in every full month", () => {
    const bank = openTestBank();
    const sam = signInByName(bank, "Sam Calloway");

    for (const month of FULL_MONTHS) expect(totalIn(bank, sam, month, SPENDING)).toBe(5_108_00);
    expect(totalIn(bank, sam, "2026-10", ["Housing", "Utilities"])).toBe(1_627_00);
  });

  it("makes the same Card purchases at the Merchants every full month", () => {
    const bank = openTestBank();
    const sam = signInByName(bank, "Sam Calloway");
    const purchasesIn = (month: string) =>
      history(bank, sam)
        .filter((transaction) => dateOf(transaction).startsWith(month) && transaction.idempotencyKey.startsWith("card:"))
        .map((transaction) => [dateOf(transaction).slice(8), transaction.counterparty, amountFor(bank, sam, transaction)]);

    const may = purchasesIn("2026-05");

    expect(new Set(may.map(([, merchant]) => merchant)).size).toBe(8);
    for (const month of FULL_MONTHS) expect(purchasesIn(month)).toEqual(may);
  });

  it("moves money from Checking to the House fund once a month, as Savings and not as spending", () => {
    const bank = openTestBank();
    const sam = signInByName(bank, "Sam Calloway");
    const [checking, houseFund] = bank.customerData.listAccounts(sam);

    const transfers = history(bank, sam).filter((transaction) => transaction.category === "Savings");

    expect(transfers.map((transaction) => dateOf(transaction).slice(0, 7))).toEqual([...FULL_MONTHS, "2026-11"]);
    for (const transfer of transfers) {
      expect(transfer.counterparty).toBe("House fund");
      expect(transfer.entries.map((entry) => entry.accountId)).toEqual([checking?.id, houseFund?.id]);
    }
  });

  it("spends more on Eating out and Shopping in November so far than in the same days of October, and the same on the rest", () => {
    const bank = openTestBank();
    const sam = signInByName(bank, "Sam Calloway");
    const firstDays = (month: string, categories: Category[]) => totalIn(bank, sam, month, categories, 18);
    const others = SPENDING.filter((category) => category !== "Eating out" && category !== "Shopping");

    expect(firstDays("2026-11", ["Eating out"])).toBeGreaterThan(firstDays("2026-10", ["Eating out"]));
    expect(firstDays("2026-11", ["Shopping"])).toBeGreaterThan(firstDays("2026-10", ["Shopping"]));
    expect(firstDays("2026-11", others)).toBe(firstDays("2026-10", others));
  });

  it("never takes Checking below zero", () => {
    const bank = openTestBank();
    const sam = signInByName(bank, "Sam Calloway");
    const [checking] = bank.customerData.listAccounts(sam);

    let balance = 0;
    for (const transaction of bank.customerData.listLedgerTransactions(sam)) {
      balance += transaction.entries.find((entry) => entry.accountId === checking?.id)?.amount ?? 0;
      expect(balance).toBeGreaterThanOrEqual(0);
    }
  });
});

describe("the seeded history of every customer", () => {
  it("gives Priya a smaller history of her own, ending with her seeded balances", () => {
    const bank = openTestBank();
    const sam = signInByName(bank, "Sam Calloway");
    const priya = signInByName(bank, "Priya Natarajan");

    const priyas = history(bank, priya);

    expect(priyas.length).toBeGreaterThan(0);
    expect(priyas.length).toBeLessThan(history(bank, sam).length);
    expect(priyas.filter((transaction) => transaction.category === "Income").length).toBeGreaterThan(0);
    expect(totalIn(bank, priya, "2026-10", SPENDING)).toBeLessThan(totalIn(bank, sam, "2026-10", SPENDING));
    expect(bank.customerData.listAccounts(priya).map((account) => account.balance)).toEqual([1_836_42, 2_150_00]);
  });

  it("shows Priya none of Sam's history", () => {
    const bank = openTestBank();
    const sam = signInByName(bank, "Sam Calloway");
    const priya = signInByName(bank, "Priya Natarajan");
    const samsIds = new Set(bank.customerData.listLedgerTransactions(sam).map((transaction) => transaction.id));
    const samsAccounts = new Set(bank.customerData.listAccounts(sam).map((account) => account.id));

    const priyas = bank.customerData.listLedgerTransactions(priya);

    expect(priyas.filter((transaction) => samsIds.has(transaction.id))).toEqual([]);
    expect(priyas.flatMap((transaction) => transaction.entries).filter((entry) => samsAccounts.has(entry.accountId))).toEqual([]);
    for (const transaction of history(bank, sam)) {
      expect(bank.customerData.getLedgerTransaction(priya, transaction.id)).toBeUndefined();
    }
  });

  it("gives Alex no history, only an opening balance", () => {
    const bank = openTestBank();
    const alex = signInByName(bank, "Alex Okafor");

    expect(bank.customerData.listLedgerTransactions(alex).map((transaction) => transaction.category)).toEqual([null]);
  });

  it("writes no Decision log entries", () => {
    const bank = openTestBank();

    for (const customer of bank.listCustomers()) expect(bank.readDecisionLog(customer)).toEqual([]);
  });

  it("is the same on every seed, whatever the time the bank starts at", () => {
    const snapshot = (bank: Bank) =>
      bank.listCustomers().flatMap((customer) =>
        bank.customerData.listLedgerTransactions(customer).map(({ id, ...transaction }) => transaction),
      );

    const first = snapshot(openTestBank());
    const second = snapshot(createBank({ db: openTestDatabase(), clock: fixedClock(new Date("2031-03-09T08:15:00Z")) }));

    expect(second).toEqual(first);
  });
});
