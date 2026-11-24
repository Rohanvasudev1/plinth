import { describe, expect, it, vi } from "vitest";
import { createBank, type Bank } from "./bank";
import { fixedClock } from "./clock";
import { openTestDatabase } from "./db/database";
import { cents } from "./money";
import { CardDeclinedError } from "./simulator";
import { openTestBank, signInByName, withoutSweeps } from "./test-bank";

/** Friday 20 November 2026, 9am in New York: Acme Corp's first payday. */
const FIRST_PAYDAY_9AM = new Date("2026-11-20T14:00:00Z");

/** A seeded bank with every buffer Rule switched off, so balances show only what the Simulator posted. */
function bankAt(at: Date): Bank {
  return withoutSweeps(createBank({ db: openTestDatabase(), clock: fixedClock(at) }));
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

    expect(bank.postPaycheck()).toEqual([expect.objectContaining({ date: "2026-12-04", amount: 3_240_00 })]);
  });

  it("posts nothing when today isn't a payday", () => {
    for (const notPayday of ["2026-11-19T14:00:00Z", "2026-11-26T14:00:00Z", "2026-12-03T14:00:00Z"]) {
      const bank = bankAt(new Date(notPayday));

      expect(bank.postPaycheck()).toEqual([]);
      expect(samsBalances(bank).checking).toBe(227_00);
    }
  });
});

describe("Advance clock one day", () => {
  it("moves the simulated time forward one day", () => {
    const bank = withoutSweeps(openTestBank());

    bank.advanceClock();

    expect(bank.clock.now().toISOString()).toBe("2026-11-20T14:00:00.000Z");
    expect(bank.readHome(signInByName(bank, "Sam Calloway")).today.toISOString()).toBe("2026-11-20T14:00:00.000Z");
  });

  it("posts the paycheck whose date it passes", () => {
    const bank = withoutSweeps(openTestBank());

    const advanced = bank.advanceClock();

    expect(advanced.posted).toEqual([expect.objectContaining({ kind: "paycheck", date: "2026-11-20", created: true })]);
    expect(samsBalances(bank).checking).toBe(3_467_00);
  });

  it("posts nothing on days it passes that aren't paydays", () => {
    const bank = bankAt(FIRST_PAYDAY_9AM);

    expect(bank.advanceClock().posted).toEqual([]);
    expect(samsBalances(bank).checking).toBe(227_00);
  });

  it("doesn't pay twice when today's paycheck was already posted by hand", () => {
    const bank = withoutSweeps(openTestBank());

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

  it("pays every 14 days and pays bills as they fall due, in date order across several pay cycles", () => {
    const bank = withoutSweeps(openTestBank());
    const sam = signInByName(bank, "Sam Calloway");
    const seeded = bank.customerData.listLedgerTransactions(sam).length;

    for (let day = 0; day < 30; day++) bank.advanceClock();

    const keys = bank.customerData
      .listLedgerTransactions(sam)
      .slice(seeded)
      .map((transaction) => transaction.idempotencyKey);
    const [rent, internet, phone, power] = bank.customerData.listScheduledBills(sam).map((bill) => bill.id);
    expect(keys).toEqual([
      "payroll:acme-corp:2026-11-20",
      `bill:${rent}:2026-12-01`,
      `bill:${internet}:2026-12-02`,
      `bill:${phone}:2026-12-03`,
      `bill:${power}:2026-12-03`,
      "payroll:acme-corp:2026-12-04",
      "payroll:acme-corp:2026-12-18",
    ]);
    expect(samsBalances(bank).checking).toBe(227_00 + 3 * 3_240_00 - 1_627_00);
  });

  it("pays a bill that falls due from checking through the Biller clearing account", () => {
    // 9am on Monday 30 November; rent is due tomorrow.
    const bank = bankAt(new Date("2026-11-30T14:00:00Z"));
    const sam = signInByName(bank, "Sam Calloway");
    const [checking] = bank.customerData.listAccounts(sam);
    const [rent] = bank.customerData.listScheduledBills(sam);
    const biller = bank.systemData.ensureSystemAccount("biller");

    const advanced = bank.advanceClock();

    expect(advanced.posted).toEqual([
      expect.objectContaining({ kind: "bill", customerId: sam.id, payee: "Rent", date: "2026-12-01", amount: 1_450_00, created: true }),
    ]);
    const posted = bank.customerData.findLedgerTransaction(sam, `bill:${rent?.id}:2026-12-01`);
    expect(posted?.entries).toEqual([
      { accountId: checking?.id, amount: -1_450_00 },
      { accountId: biller, amount: 1_450_00 },
    ]);
    expect(posted?.postedAt.toISOString()).toBe("2026-12-01T14:00:00.000Z");
    expect(samsBalances(bank).checking).toBe(227_00 - 1_450_00);
  });

  it("posts the paycheck before the bills on a day that has both", () => {
    // 9am on Thursday 31 December; 1 January is both a payday and rent day.
    const bank = bankAt(new Date("2026-12-31T14:00:00Z"));
    const sam = signInByName(bank, "Sam Calloway");

    const samsPosted = bank
      .advanceClock()
      .posted.filter((transaction) => transaction.customerId === sam.id)
      .map((transaction) => `${transaction.kind} ${transaction.date}`);

    expect(samsPosted).toEqual(["paycheck 2027-01-01", "bill 2027-01-01"]);
  });

  it("doesn't pay a bill twice when the clock passes its due date again", () => {
    const start = new Date("2026-11-30T14:00:00Z");
    const bank = bankAt(start);

    bank.advanceClock();
    bank.clock.setTo(start);
    const again = bank.advanceClock();

    expect(again.posted).toEqual([expect.objectContaining({ kind: "bill", payee: "Rent", created: false })]);
    expect(samsBalances(bank).checking).toBe(227_00 - 1_450_00);
  });

  it("leaves the clock where it was and posts nothing when one of the day's ledger transactions fails", () => {
    // 9am on Thursday 31 December; 1 January has Sam's paycheck, then rent.
    const start = new Date("2026-12-31T14:00:00Z");
    const bank = bankAt(start);
    const post = bank.customerData.postLedgerTransaction.bind(bank.customerData);
    vi.spyOn(bank.customerData, "postLedgerTransaction").mockImplementation((customer, transaction) => {
      if (transaction.idempotencyKey.startsWith("bill:")) throw new Error("The Biller is down");
      return post(customer, transaction);
    });

    expect(() => bank.advanceClock()).toThrow("The Biller is down");

    expect(bank.clock.now()).toEqual(start);
    expect(samsBalances(bank).checking).toBe(227_00);
  });

  it("has moved the clock to the new day by the time rules hear about the paychecks and bills", () => {
    const bank = withoutSweeps(openTestBank());
    const clockSeenByRules: string[] = [];
    bank.ledgerEvents.subscribe(() => clockSeenByRules.push(bank.clock.now().toISOString()));

    bank.advanceClock();

    expect(clockSeenByRules).toEqual(["2026-11-20T14:00:00.000Z"]);
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
    const bank = withoutSweeps(openTestBank());
    const { sam, houseFund } = samWithAccounts(bank);
    const merchant = bank.systemData.ensureSystemAccount("merchant");

    bank.cardPurchase(sam, { accountId: houseFund.id, merchant: "harbor-and-pine-goods", amount: cents(12_000_00), idempotencyKey: "card:test-1" });

    expect(samsBalances(bank)).toEqual({ checking: 227_00, houseFund: 400_00 });
    expect(bank.customerData.listLedgerTransactions(sam).at(-1)?.entries).toEqual([
      { accountId: houseFund.id, amount: -12_000_00 },
      { accountId: merchant, amount: 12_000_00 },
    ]);
  });

  it("changes nothing when the same purchase is submitted twice", () => {
    const bank = withoutSweeps(openTestBank());
    const { sam, checking } = samWithAccounts(bank);
    const purchase = { accountId: checking.id, merchant: "harbor-and-pine-goods" as const, amount: cents(19_99), idempotencyKey: "card:test-2" };

    bank.cardPurchase(sam, purchase);
    const repeat = bank.cardPurchase(sam, purchase);

    expect(repeat.created).toBe(false);
    expect(samsBalances(bank).checking).toBe(207_01);
  });

  it("treats a repeat of a purchase that emptied the account as already done, not declined", () => {
    const bank = withoutSweeps(openTestBank());
    const { sam, houseFund } = samWithAccounts(bank);
    const purchase = { accountId: houseFund.id, merchant: "harbor-and-pine-goods" as const, amount: cents(12_400_00), idempotencyKey: "card:test-5" };

    bank.cardPurchase(sam, purchase);

    expect(bank.cardPurchase(sam, purchase).created).toBe(false);
    expect(samsBalances(bank).houseFund).toBe(0);
  });

  it("is declined, moving nothing, when the account holds less than the amount", () => {
    const bank = withoutSweeps(openTestBank());
    const { sam, checking } = samWithAccounts(bank);

    expect(() =>
      bank.cardPurchase(sam, { accountId: checking.id, merchant: "harbor-and-pine-goods", amount: cents(227_01), idempotencyKey: "card:test-3" }),
    ).toThrow(CardDeclinedError);
    expect(samsBalances(bank).checking).toBe(227_00);
  });

  it("is declined for an amount of zero or less", () => {
    const bank = withoutSweeps(openTestBank());
    const { sam, checking } = samWithAccounts(bank);

    for (const amount of [0, -5_00]) {
      expect(() =>
        bank.cardPurchase(sam, { accountId: checking.id, merchant: "harbor-and-pine-goods", amount: cents(amount), idempotencyKey: `card:zero${amount}` }),
      ).toThrow(CardDeclinedError);
    }
    expect(samsBalances(bank).checking).toBe(227_00);
  });

  it("can't spend from another customer's account", () => {
    const bank = withoutSweeps(openTestBank());
    const { houseFund } = samWithAccounts(bank);
    const priya = signInByName(bank, "Priya Natarajan");

    expect(() =>
      bank.cardPurchase(priya, { accountId: houseFund.id, merchant: "harbor-and-pine-goods", amount: cents(1_00), idempotencyKey: "card:test-4" }),
    ).toThrow(CardDeclinedError);
    expect(samsBalances(bank).houseFund).toBe(12_400_00);
  });
});
