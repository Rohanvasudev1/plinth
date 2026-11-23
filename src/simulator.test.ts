import { describe, expect, it } from "vitest";
import { createBank, type Bank } from "./bank";
import { fixedClock } from "./clock";
import { openTestDatabase } from "./db/database";
import { cents } from "./money";
import { CardDeclinedError } from "./simulator";
import { openTestBank, signInByName } from "./test-bank";

/** Friday 20 November 2026, 9am in New York: Acme Corp's first payday. */
const FIRST_PAYDAY_9AM = new Date("2026-11-20T14:00:00Z");

function bankAt(at: Date): Bank {
  return createBank({ db: openTestDatabase(), clock: fixedClock(at) });
}

function samsBalances(bank: Bank) {
  const home = bank.readHome(signInByName(bank, "Sam Calloway"));
  return { checking: home.checking?.balance, houseFund: home.savings[0]?.balance };
}

describe("Post paycheck", () => {
  it("pays Sam $3,240 from Acme Corp into Checking on a payday", () => {
    const bank = bankAt(FIRST_PAYDAY_9AM);

    bank.postPaycheck();

    expect(samsBalances(bank)).toEqual({ checking: 3_467_00, houseFund: 12_400_00 });
  });

  it("changes nothing when the same paycheck is posted twice", () => {
    const bank = bankAt(FIRST_PAYDAY_9AM);

    const [first] = bank.postPaycheck();
    const [second] = bank.postPaycheck();

    expect(first?.created).toBe(true);
    expect(second).toMatchObject({ created: false, ledgerTransactionId: first?.ledgerTransactionId });
    expect(samsBalances(bank)).toEqual({ checking: 3_467_00, houseFund: 12_400_00 });
  });

  it("posts with the key payroll:<employer>:<pay date> through the Acme Corp payroll clearing account", () => {
    const bank = bankAt(FIRST_PAYDAY_9AM);
    const sam = signInByName(bank, "Sam Calloway");
    const acmePayroll = bank.systemData.ensureSystemAccount("acmePayroll");

    bank.postPaycheck();

    const paycheck = bank.customerData.listLedgerTransactions(sam).at(-1);
    expect(paycheck?.idempotencyKey).toBe("payroll:acme-corp:2026-11-20");
    expect(paycheck?.entries).toContainEqual({ accountId: acmePayroll, amount: -3_240_00 });
  });

  it("pays again 14 days later, using the date in New York rather than UTC", () => {
    // 11:30pm on Friday 4 December in New York is already Saturday in UTC.
    const bank = bankAt(new Date("2026-12-05T04:30:00Z"));

    expect(bank.postPaycheck()).toEqual([expect.objectContaining({ payDate: "2026-12-04", amount: 3_240_00 })]);
  });

  it("posts nothing when today isn't a payday", () => {
    for (const notPayday of ["2026-11-19T14:00:00Z", "2026-11-27T14:00:00Z", "2026-12-03T14:00:00Z"]) {
      const bank = bankAt(new Date(notPayday));

      expect(bank.postPaycheck()).toEqual([]);
      expect(samsBalances(bank).checking).toBe(227_00);
    }
  });
});

describe("Advance clock one day", () => {
  it("moves the simulated time forward one day", () => {
    const bank = openTestBank();

    bank.advanceClock();

    expect(bank.clock.now().toISOString()).toBe("2026-11-20T14:00:00.000Z");
    expect(bank.readHome(signInByName(bank, "Sam Calloway")).today.toISOString()).toBe("2026-11-20T14:00:00.000Z");
  });

  it("posts the paycheck whose date it passes", () => {
    const bank = openTestBank();

    const advanced = bank.advanceClock();

    expect(advanced.paychecks).toEqual([expect.objectContaining({ payDate: "2026-11-20", created: true })]);
    expect(samsBalances(bank).checking).toBe(3_467_00);
  });

  it("posts nothing on days it passes that aren't paydays", () => {
    const bank = bankAt(FIRST_PAYDAY_9AM);

    expect(bank.advanceClock().paychecks).toEqual([]);
    expect(samsBalances(bank).checking).toBe(227_00);
  });

  it("doesn't pay twice when today's paycheck was already posted by hand", () => {
    const bank = openTestBank();

    bank.advanceClock();
    bank.postPaycheck();

    expect(samsBalances(bank).checking).toBe(3_467_00);
  });

  it("keeps the time of day in New York across a daylight saving change", () => {
    // 9am EST on Saturday 13 March 2027; clocks spring forward overnight.
    const bank = bankAt(new Date("2027-03-13T14:00:00Z"));

    expect(bank.advanceClock().now.toISOString()).toBe("2027-03-14T13:00:00.000Z");
  });

  it("moves to the next date even when a day is 25 hours long", () => {
    // 12:30am EDT on Sunday 7 November 2027; clocks fall back at 2am.
    const bank = bankAt(new Date("2027-11-07T04:30:00Z"));

    expect(bank.advanceClock().now.toISOString()).toBe("2027-11-08T05:30:00.000Z");
  });

  it("pays every 14 days across several pay cycles, in date order", () => {
    const bank = openTestBank();
    const sam = signInByName(bank, "Sam Calloway");

    for (let day = 0; day < 30; day++) bank.advanceClock();

    const payrollKeys = bank.customerData
      .listLedgerTransactions(sam)
      .map((transaction) => transaction.idempotencyKey)
      .filter((key) => key.startsWith("payroll:"));
    expect(payrollKeys).toEqual([
      "payroll:acme-corp:2026-11-20",
      "payroll:acme-corp:2026-12-04",
      "payroll:acme-corp:2026-12-18",
    ]);
    expect(samsBalances(bank).checking).toBe(227_00 + 3 * 3_240_00);
  });
});

describe("Card purchase", () => {
  function samWithAccounts(bank: Bank) {
    const sam = signInByName(bank, "Sam Calloway");
    const [checking, houseFund] = bank.customerData.listAccounts(sam);
    if (!checking || !houseFund) throw new Error("Sam's seeded accounts are missing");
    return { sam, checking, houseFund };
  }

  it("spends the amount from the chosen account through the Merchant clearing account", () => {
    const bank = openTestBank();
    const { sam, houseFund } = samWithAccounts(bank);
    const merchant = bank.systemData.ensureSystemAccount("merchant");

    bank.cardPurchase(sam, { accountId: houseFund.id, amount: cents(12_000_00), idempotencyKey: "card:test-1" });

    expect(samsBalances(bank)).toEqual({ checking: 227_00, houseFund: 400_00 });
    expect(bank.customerData.listLedgerTransactions(sam).at(-1)?.entries).toEqual([
      { accountId: houseFund.id, amount: -12_000_00 },
      { accountId: merchant, amount: 12_000_00 },
    ]);
  });

  it("changes nothing when the same purchase is submitted twice", () => {
    const bank = openTestBank();
    const { sam, checking } = samWithAccounts(bank);
    const purchase = { accountId: checking.id, amount: cents(19_99), idempotencyKey: "card:test-2" };

    bank.cardPurchase(sam, purchase);
    const repeat = bank.cardPurchase(sam, purchase);

    expect(repeat.created).toBe(false);
    expect(samsBalances(bank).checking).toBe(207_01);
  });

  it("treats a repeat of a purchase that emptied the account as already done, not declined", () => {
    const bank = openTestBank();
    const { sam, houseFund } = samWithAccounts(bank);
    const purchase = { accountId: houseFund.id, amount: cents(12_400_00), idempotencyKey: "card:test-5" };

    bank.cardPurchase(sam, purchase);

    expect(bank.cardPurchase(sam, purchase).created).toBe(false);
    expect(samsBalances(bank).houseFund).toBe(0);
  });

  it("is declined, moving nothing, when the account holds less than the amount", () => {
    const bank = openTestBank();
    const { sam, checking } = samWithAccounts(bank);

    expect(() =>
      bank.cardPurchase(sam, { accountId: checking.id, amount: cents(227_01), idempotencyKey: "card:test-3" }),
    ).toThrow(CardDeclinedError);
    expect(samsBalances(bank).checking).toBe(227_00);
  });

  it("is declined for an amount of zero or less", () => {
    const bank = openTestBank();
    const { sam, checking } = samWithAccounts(bank);

    for (const amount of [0, -5_00]) {
      expect(() =>
        bank.cardPurchase(sam, { accountId: checking.id, amount: cents(amount), idempotencyKey: `card:zero${amount}` }),
      ).toThrow(CardDeclinedError);
    }
    expect(samsBalances(bank).checking).toBe(227_00);
  });

  it("can't spend from another customer's account", () => {
    const bank = openTestBank();
    const { houseFund } = samWithAccounts(bank);
    const priya = signInByName(bank, "Priya Natarajan");

    expect(() =>
      bank.cardPurchase(priya, { accountId: houseFund.id, amount: cents(1_00), idempotencyKey: "card:test-4" }),
    ).toThrow(CardDeclinedError);
    expect(samsBalances(bank).houseFund).toBe(12_400_00);
  });
});
