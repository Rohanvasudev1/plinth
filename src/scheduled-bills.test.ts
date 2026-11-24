import { describe, expect, it } from "vitest";
import { createBank, type Bank } from "./bank";
import { fixedClock } from "./clock";
import { openTestDatabase } from "./db/database";
import { cents } from "./money";
import { signInByName } from "./test-bank";

function bankAt(isoInstant: string): Bank {
  return createBank({ db: openTestDatabase(), clock: fixedClock(new Date(isoInstant)) });
}

function samsBillsBeforePayday(bank: Bank) {
  return bank.billsBeforePayday(signInByName(bank, "Sam Calloway"));
}

describe("Bills before payday", () => {
  it("on Sam's 20 Nov payday, are rent, internet, phone and power, totalling $1,627, before the 4 Dec payday", () => {
    const bank = bankAt("2026-11-20T14:00:00Z");

    const window = samsBillsBeforePayday(bank);

    expect(window.nextPayday).toBe("2026-12-04");
    expect(window.total).toBe(1_627_00);
    expect(window.bills.map(({ payee, dueDate, amount }) => ({ payee, dueDate, amount }))).toEqual([
      { payee: "Rent", dueDate: "2026-12-01", amount: 1_450_00 },
      { payee: "Internet", dueDate: "2026-12-02", amount: 62_00 },
      { payee: "Phone", dueDate: "2026-12-03", amount: 45_00 },
      { payee: "Power", dueDate: "2026-12-03", amount: 70_00 },
    ]);
  });

  it("leaves out a bill due today, since it has already come out", () => {
    // 9am on Tuesday 1 December: rent is due today.
    const bank = bankAt("2026-12-01T14:00:00Z");

    const window = samsBillsBeforePayday(bank);

    expect(window.bills.map((bill) => bill.payee)).toEqual(["Internet", "Phone", "Power"]);
    expect(window.total).toBe(177_00);
  });

  it("counts a bill due the day before payday but not one due on payday itself", () => {
    const bank = bankAt("2026-11-20T14:00:00Z");
    const sam = signInByName(bank, "Sam Calloway");
    const [checking] = bank.customerData.listAccounts(sam);
    bank.customerData.addScheduledBill(sam, {
      accountId: checking!.id,
      payee: "Streaming",
      category: "Subscriptions",
      amount: cents(15_00),
      dayOfMonth: 4,
    });

    const window = bank.billsBeforePayday(sam);

    expect(window.bills.map((bill) => bill.dueDate)).toEqual(["2026-12-01", "2026-12-02", "2026-12-03", "2026-12-03"]);
    expect(window.total).toBe(1_627_00);
  });

  it("is empty the day before payday", () => {
    const bank = bankAt("2026-11-19T14:00:00Z");

    expect(samsBillsBeforePayday(bank)).toEqual({ nextPayday: "2026-11-20", bills: [], total: 0 });
  });

  it("counts a bill set for the 31st on the last day of a shorter month", () => {
    const bank = bankAt("2026-11-20T14:00:00Z");
    const sam = signInByName(bank, "Sam Calloway");
    const [checking] = bank.customerData.listAccounts(sam);
    bank.customerData.addScheduledBill(sam, {
      accountId: checking!.id,
      payee: "Insurance",
      category: "Health",
      amount: cents(80_00),
      dayOfMonth: 31,
    });

    const window = bank.billsBeforePayday(sam);

    expect(window.bills[0]).toMatchObject({ payee: "Insurance", dueDate: "2026-11-30" });
    expect(window.total).toBe(1_707_00);
  });

  it("uses the date in New York, so late on the evening before payday the window is still empty", () => {
    // 11:30pm on Thursday 19 November in New York is already Friday in UTC.
    const bank = bankAt("2026-11-20T04:30:00Z");

    expect(samsBillsBeforePayday(bank).bills).toEqual([]);
  });

  it("gives Priya their own bills before their own payday", () => {
    const bank = bankAt("2026-11-25T14:00:00Z");

    const window = bank.billsBeforePayday(signInByName(bank, "Priya Natarajan"));

    expect(window.nextPayday).toBe("2026-12-09");
    expect(window.bills.map(({ payee, dueDate }) => ({ payee, dueDate }))).toEqual([
      { payee: "Rent", dueDate: "2026-11-28" },
      { payee: "Phone", dueDate: "2026-11-30" },
      { payee: "Gym", dueDate: "2026-12-06" },
    ]);
    expect(window.total).toBe(1_247_00);
  });

  it("lists no bills for a customer no payroll pays, since there is no next payday", () => {
    const bank = bankAt("2026-11-20T14:00:00Z");
    const newcomer = bank.systemData.createCustomer("Jordan Ellery");

    expect(bank.billsBeforePayday(newcomer)).toEqual({ nextPayday: null, bills: [], total: 0 });
  });
});

describe("Safe to spend on Home", () => {
  it("is checking minus the $1,500 Buffer minus bills before payday, $340 after Sam's 20 Nov paycheck", () => {
    const bank = bankAt("2026-11-20T14:00:00Z");
    const sam = signInByName(bank, "Sam Calloway");
    // With the buffer Rule off, the agent leaves the $340 in checking. The Buffer stays $1,500.
    const [rule] = bank.customerData.listRules(sam);
    if (rule) bank.switchRule(sam, rule.id, false);
    bank.postPaycheck();

    const home = bank.readHome(sam);

    expect(home.safeToSpend).toEqual({ amount: 340_00, checking: 3_467_00, buffer: 1_500_00, billsBeforePayday: 1_627_00 });
    expect(home.billsBeforePayday.bills.map((bill) => bill.payee)).toEqual(["Rent", "Internet", "Phone", "Power"]);
  });

  it("goes below zero when checking holds less than the Buffer", () => {
    const bank = bankAt("2026-11-19T14:00:00Z");

    const home = bank.readHome(signInByName(bank, "Sam Calloway"));

    expect(home.safeToSpend?.amount).toBe(-1_273_00);
  });
});
