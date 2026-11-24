import { describe, expect, it } from "vitest";
import type { Bank } from "./bank";
import { cents } from "./money";
import { openTestBank, signInByName } from "./test-bank";

describe("the Forecast page", () => {
  it("tells Alex, with no history, that there isn't enough history yet", () => {
    const bank = openTestBank();
    const alex = signInByName(bank, "Alex Okafor");

    expect(bank.readForecastPage(alex)).toEqual({ kind: "not_enough_history" });
  });

  it("still tells Alex there isn't enough history once Alex starts spending this month", () => {
    const bank = openTestBank();
    const alex = signInByName(bank, "Alex Okafor");
    const [checking] = bank.customerData.listAccounts(alex);
    if (!checking) throw new Error("Alex's checking account is missing");
    bank.cardPurchase(alex, { accountId: checking.id, merchant: "green-basket-market", amount: cents(64_20), idempotencyKey: "card:food" });
    for (let day = 0; day < 15; day++) bank.advanceClock();

    expect(bank.readForecastPage(alex)).toEqual({ kind: "not_enough_history" });
  });

  it("works out Sam's Usual month over May to October, per Category and in total", () => {
    const bank = openTestBank();
    const page = figuresFor(bank, "Sam Calloway");

    expect(page.fullMonths).toBe(6);
    // Thirteen paychecks of $3,240 from May to October (July has three) is $42,120, so $7,020 a month.
    expect(page.usualMonth.income).toBe(7_020_00);
    // Every full month repeats the same bills and Card purchases, so the Usual month is any one of them.
    expect(page.usualMonth.spending).toBe(5_108_00);
    expect(usualByCategory(page)).toEqual({
      Housing: 1_450_00,
      Utilities: 177_00,
      Groceries: 1_120_00,
      "Eating out": 550_00,
      Shopping: 1_320_00,
      Transport: 215_00,
      Subscriptions: 18_00,
      Entertainment: 90_00,
      Health: 168_00,
    });
  });

  it("puts Sam's November On pace from spending so far, scaled from 19 of 30 days to the whole month", () => {
    const bank = openTestBank();
    const page = figuresFor(bank, "Sam Calloway");

    // From 1 to 18 November Sam paid $1,627.00 of bills and $3,167.60 of Card purchases: $4,794.60 so far.
    // $4,794.60 × 30 ÷ 19 = $7,570.421…
    expect(page.onPace.spending).toBe(7_570_42);
    expect(onPaceByCategory(page)).toEqual({
      Housing: 2_289_47, // $1,450.00 × 30 ÷ 19 = $2,289.473…
      Utilities: 279_47, // $177.00 × 30 ÷ 19 = $279.473…
      Groceries: 883_50, // $559.55 × 30 ÷ 19 = $883.50
      "Eating out": 929_21, // $588.50 × 30 ÷ 19 = $929.210…
      Shopping: 2_701_82, // $1,711.15 × 30 ÷ 19 = $2,701.815…
      Transport: 266_21, // $168.60 × 30 ÷ 19 = $266.210…
      Subscriptions: 28_42, // $18.00 × 30 ÷ 19 = $28.421…
      Entertainment: 67_11, // $42.50 × 30 ÷ 19 = $67.105…
      Health: 125_21, // $79.30 × 30 ÷ 19 = $125.210…
    });
  });

  it("leaves Sam $1,912.00 to save in the Usual month, and $550.42 short On pace", () => {
    const bank = openTestBank();
    const page = figuresFor(bank, "Sam Calloway");

    expect(page.leftToSave).toEqual({ usualMonth: 1_912_00, onPace: -550_42 });
  });

  it("counts a Card purchase as spending, but not a paycheck, the agent's sweep or Sam's own transfer", () => {
    const bank = openTestBank();
    const sam = signInByName(bank, "Sam Calloway");
    const [checking, houseFund] = bank.customerData.listAccounts(sam);
    if (!checking || !houseFund) throw new Error("Sam's seeded accounts are missing");
    bank.cardPurchase(sam, { accountId: checking.id, merchant: "bright-reel-cinema", amount: cents(25_40), idempotencyKey: "card:film" });
    bank.customerData.postLedgerTransaction(sam, {
      idempotencyKey: "transfer:1",
      description: "Transfer to Checking",
      counterparty: "Checking",
      category: "Savings",
      entries: [
        { accountId: houseFund.id, amount: cents(-100_00) },
        { accountId: checking.id, amount: cents(100_00) },
      ],
    });
    // Friday 20 November: the paycheck lands and the agent sweeps to the House fund.
    bank.advanceClock();
    expect(bank.readDecisionLog(sam).map((entry) => entry.result)).toContain("Done");

    const page = figuresFor(bank, "Sam Calloway");

    // ($4,794.60 + $25.40) × 30 ÷ 20 = $7,230.00
    expect(page.onPace.spending).toBe(7_230_00);
    expect(onPaceByCategory(page).Entertainment).toBe(101_85); // ($42.50 + $25.40) × 30 ÷ 20
    expect(page.usualMonth.income).toBe(7_020_00);
    expect(page.leftToSave).toEqual({ usualMonth: 1_912_00, onPace: -210_00 });
  });

  it("gives Priya her own figures from October, her one full month, and none of Sam's", () => {
    const bank = openTestBank();
    const sam = signInByName(bank, "Sam Calloway");
    const [checking] = bank.customerData.listAccounts(sam);
    if (!checking) throw new Error("Sam's checking account is missing");
    const before = figuresFor(bank, "Priya Natarajan");
    bank.cardPurchase(sam, { accountId: checking.id, merchant: "harbor-and-pine-goods", amount: cents(120_00), idempotencyKey: "card:lamp" });

    const priyas = figuresFor(bank, "Priya Natarajan");

    expect(priyas.fullMonths).toBe(1);
    // Two paychecks of $2,480 in October.
    expect(priyas.usualMonth.income).toBe(4_960_00);
    // $2,447.00 of Card purchases, and Rent, Phone and Gym: $1,180.00 + $38.00 + $29.00.
    expect(priyas.usualMonth.spending).toBe(3_694_00);
    expect(priyas).toEqual(before);
  });
});

function figuresFor(bank: Bank, name: string) {
  const page = bank.readForecastPage(signInByName(bank, name));
  if (page.kind !== "figures") throw new Error(`${name} has no Forecast figures`);
  return page;
}

function usualByCategory(page: ReturnType<typeof figuresFor>) {
  return Object.fromEntries(page.categories.map((row) => [row.category, row.usualMonth]));
}

function onPaceByCategory(page: ReturnType<typeof figuresFor>) {
  return Object.fromEntries(page.categories.map((row) => [row.category, row.onPace]));
}
