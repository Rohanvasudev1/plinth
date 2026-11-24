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
      // Groceries took up each change in Subscriptions, so the two move in opposite directions:
      // ($1,123.00 × 3 + $1,110.01 × 2 + $1,107.01) ÷ 6 = $1,116.005, and ($15.00 × 3 + $27.99 × 2 + $30.99) ÷ 6 = $21.995.
      Groceries: 1_116_01,
      "Eating out": 550_00,
      Shopping: 1_320_00,
      Transport: 215_00,
      Subscriptions: 22_00,
      Entertainment: 90_00,
      Health: 168_00,
    });
  });

  it("puts Sam's November On pace on 19 Nov: Card purchases scaled from 19 of 30 days, Scheduled bills at their full amount", () => {
    const bank = openTestBank();
    const page = figuresFor(bank, "Sam Calloway");

    // From 1 to 18 November Sam made $3,167.60 of Card purchases. $3,167.60 × 30 ÷ 19 = $5,001.473…
    // The four Scheduled bills add their full $1,627.00 for the month.
    expect(page.onPace.spending).toBe(6_628_47);
    expect(onPaceByCategory(page)).toEqual({
      Housing: 1_450_00, // Rent, not scaled
      Utilities: 177_00, // Internet, Phone and Power, not scaled
      Groceries: 862_99, // $546.56 × 30 ÷ 19 = $862.989…
      "Eating out": 929_21, // $588.50 × 30 ÷ 19 = $929.210…
      Shopping: 2_701_82, // $1,711.15 × 30 ÷ 19 = $2,701.815…
      Transport: 266_21, // $168.60 × 30 ÷ 19 = $266.210…
      Subscriptions: 48_93, // Tunewell $18.00 and Clipreel $12.99: $30.99 × 30 ÷ 19 = $48.931…
      Entertainment: 67_11, // $42.50 × 30 ÷ 19 = $67.105…
      Health: 125_21, // $79.30 × 30 ÷ 19 = $125.210…
    });
  });

  it("doesn't scale Rent up on the 1st: Scheduled bills count once, paid or not, and Card purchases scale from 1 of 31 days", () => {
    const bank = openTestBank();
    const sam = signInByName(bank, "Sam Calloway");
    const [checking] = bank.customerData.listAccounts(sam);
    if (!checking) throw new Error("Sam's checking account is missing");
    // From Thursday 19 November to Tuesday 1 December, when Rent is paid. Internet, Phone and Power aren't due yet.
    for (let day = 0; day < 12; day++) bank.advanceClock();
    bank.cardPurchase(sam, { accountId: checking.id, merchant: "morning-crumb-cafe", amount: cents(20_00), idempotencyKey: "card:coffee" });

    const page = figuresFor(bank, "Sam Calloway");

    // $20.00 × 31 ÷ 1 = $620.00, plus $1,627.00 of Scheduled bills.
    expect(page.onPace.spending).toBe(2_247_00);
    expect(onPaceByCategory(page)).toEqual({
      Housing: 1_450_00,
      Utilities: 177_00,
      Groceries: 0,
      "Eating out": 620_00,
      Shopping: 0,
      Transport: 0,
      Subscriptions: 0,
      Entertainment: 0,
      Health: 0,
    });
  });

  it("leaves Sam $1,912.00 to save in the Usual month, and $391.53 On pace", () => {
    const bank = openTestBank();
    const page = figuresFor(bank, "Sam Calloway");

    // $7,020.00 − $5,108.00, and $7,020.00 − $6,628.47
    expect(page.leftToSave).toEqual({ usualMonth: 1_912_00, onPace: 391_53 });
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

    // ($3,167.60 + $25.40) × 30 ÷ 20 = $4,789.50, plus $1,627.00 of Scheduled bills.
    expect(page.onPace.spending).toBe(6_416_50);
    expect(onPaceByCategory(page).Entertainment).toBe(101_85); // ($42.50 + $25.40) × 30 ÷ 20
    expect(page.usualMonth.income).toBe(7_020_00);
    expect(page.leftToSave).toEqual({ usualMonth: 1_912_00, onPace: 603_50 });
  });

  it("shows Sam and Priya each only their own figures, with only their own purchases today", () => {
    const bank = openTestBank();
    const sam = signInByName(bank, "Sam Calloway");
    const priya = signInByName(bank, "Priya Natarajan");
    const [samsChecking] = bank.customerData.listAccounts(sam);
    const [priyasChecking] = bank.customerData.listAccounts(priya);
    if (!samsChecking || !priyasChecking) throw new Error("A seeded checking account is missing");
    bank.cardPurchase(sam, { accountId: samsChecking.id, merchant: "bright-reel-cinema", amount: cents(25_40), idempotencyKey: "card:film" });
    bank.cardPurchase(priya, { accountId: priyasChecking.id, merchant: "bright-reel-cinema", amount: cents(19_00), idempotencyKey: "card:film" });

    const sams = figuresFor(bank, "Sam Calloway");
    const priyas = figuresFor(bank, "Priya Natarajan");

    expect(sams.fullMonths).toBe(6);
    expect(sams.usualMonth).toEqual({ income: 7_020_00, spending: 5_108_00 });
    // ($3,167.60 + $25.40) × 30 ÷ 19 = $5,041.578…, plus $1,627.00 of Scheduled bills.
    expect(sams.onPace.spending).toBe(6_668_58);
    expect(onPaceByCategory(sams).Entertainment).toBe(107_21); // ($42.50 + $25.40) × 30 ÷ 19

    // October, Priya's one full month: two paychecks of $2,480, and $2,447.00 of Card purchases plus Rent, Phone
    // and Gym at $1,180.00 + $38.00 + $29.00.
    expect(priyas.fullMonths).toBe(1);
    expect(priyas.usualMonth).toEqual({ income: 4_960_00, spending: 3_694_00 });
    // ($1,316.90 + $19.00) × 30 ÷ 19 = $2,109.315…, plus $1,247.00 of Scheduled bills, though Rent and Phone aren't
    // due until the 28th and 30th.
    expect(priyas.onPace.spending).toBe(3_356_32);
    expect(onPaceByCategory(priyas).Entertainment).toBe(30_00); // $19.00 × 30 ÷ 19
    expect(onPaceByCategory(priyas).Housing).toBe(1_180_00);
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
