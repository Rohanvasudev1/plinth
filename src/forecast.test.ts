import { describe, expect, it } from "vitest";
import type { Bank, Forecast } from "./bank";
import type { Customer } from "./customer-data";
import { cents, type Cents } from "./money";
import { openTestBank, signInByName } from "./test-bank";

/** The Forecast's balance on one date, which must be one of its 30 days. */
function balanceOn(forecast: Forecast | null, date: string): Cents {
  const day = forecast?.days.find((candidate) => candidate.date === date);
  if (!day) throw new Error(`The Forecast has no day ${date}`);
  return day.balance;
}

function samIn(bank: Bank): Customer {
  return signInByName(bank, "Sam Calloway");
}

// Sam on Thursday 19 November: $227.00 in Checking, a $1,500.00 Buffer, a $3,240.00 paycheck every other Friday
// from 20 November, and Rent $1,450.00 on the 1st, Internet $62.00 on the 2nd, Phone $45.00 and Power $70.00 on the
// 3rd. His Card purchases from 21 August to 18 November, the 90 days before today, come to $11,711.45: $1,581.85 in
// late August, $3,481.00 in each of September and October, and $3,167.60 in November so far. That is $130.13 a day.
describe("30-day Forecast", () => {
  it("runs for the 30 days after today, starting from today's checking balance, with the Buffer", () => {
    const bank = openTestBank();
    const forecast = bank.readForecast(samIn(bank));

    expect(forecast?.start).toEqual({ date: "2026-11-19", balance: 227_00 });
    expect(forecast?.days).toHaveLength(30);
    expect(forecast?.days[0]?.date).toBe("2026-11-20");
    expect(forecast?.days[29]?.date).toBe("2026-12-19");
    expect(forecast?.buffer).toBe(1_500_00);
  });

  it("subtracts a daily allowance of the average daily Card purchases over the last 90 days", () => {
    const bank = openTestBank();
    const forecast = bank.readForecast(samIn(bank));

    expect(forecast?.dailyAllowance).toBe(130_13);
    // No paycheck or bill between 21 and 30 November: the allowance alone, ten times.
    expect(balanceOn(forecast, "2026-11-30") - balanceOn(forecast, "2026-11-20")).toBe(-1_301_30);
  });

  it("adds paychecks, subtracts Scheduled bills, and under within_rules subtracts the sweeps the buffer Rule would make", () => {
    const bank = openTestBank();
    const forecast = bank.readForecast(samIn(bank));

    // 20 Nov: $227.00 + $3,240.00 paycheck, then the $340 sweep (above the Buffer and $1,627.00 of bills before
    // 4 Dec), less $130.13.
    expect(balanceOn(forecast, "2026-11-20")).toBe(2_996_87);
    // 1 Dec: $1,695.57 on 30 Nov, less Rent and the allowance.
    expect(balanceOn(forecast, "2026-12-01")).toBe(115_44);
    // 3 Dec: less Phone, Power and the allowance, after Internet on 2 Dec.
    expect(balanceOn(forecast, "2026-12-03")).toBe(-321_82);
    // 4 Dec: + $3,240.00 makes $2,918.18; no bills before 18 Dec, so the sweep is $1,418; less the allowance.
    expect(balanceOn(forecast, "2026-12-04")).toBe(1_370_05);
    expect(forecast?.lowest).toEqual({ date: "2026-12-03", balance: -321_82 });
  });

  it("leaves sweeps out under ask_first, since the agent would ask before moving anything", () => {
    const bank = openTestBank();
    const sam = samIn(bank);
    bank.changeSettings(sam, { autonomyLevel: "ask_first" });

    const forecast = bank.readForecast(sam);

    expect(balanceOn(forecast, "2026-11-20")).toBe(3_336_87);
    expect(balanceOn(forecast, "2026-12-03")).toBe(18_18);
    expect(balanceOn(forecast, "2026-12-04")).toBe(3_128_05);
  });

  it("under small_things keeps a sweep at or under the Payment limit and leaves out one over it", () => {
    const bank = openTestBank();
    const sam = samIn(bank);
    // Sam's seeded Payment limit is $500: the $340 sweep is under it, the $1,418 sweep on 4 Dec isn't.
    bank.changeSettings(sam, { autonomyLevel: "small_things" });

    const forecast = bank.readForecast(sam);

    expect(balanceOn(forecast, "2026-11-20")).toBe(2_996_87);
    expect(balanceOn(forecast, "2026-12-04")).toBe(2_788_05);
  });

  it("leaves sweeps out while the agent is paused", () => {
    const bank = openTestBank();
    const sam = samIn(bank);
    bank.setAgentPaused(sam, true);

    expect(balanceOn(bank.readForecast(sam), "2026-11-20")).toBe(3_336_87);
  });

  it("gives a customer with no history an allowance of zero, and no Buffer or sweeps before setup", () => {
    const bank = openTestBank();
    const alex = signInByName(bank, "Alex Okafor");

    const forecast = bank.readForecast(alex);

    // $400.00 in Checking, with $2,100.00 paychecks on 27 November and 11 December.
    expect(forecast?.dailyAllowance).toBe(0);
    expect(forecast?.buffer).toBeNull();
    expect(balanceOn(forecast, "2026-11-26")).toBe(400_00);
    expect(balanceOn(forecast, "2026-11-27")).toBe(2_500_00);
    expect(balanceOn(forecast, "2026-12-11")).toBe(4_600_00);
    expect(forecast?.lowest).toEqual({ date: "2026-11-20", balance: 400_00 });
  });

  it("is worked out from the ledger when read, so a Card purchase today lowers every day", () => {
    const bank = openTestBank();
    const sam = samIn(bank);
    // No sweeps under ask_first, so nothing absorbs the purchase.
    bank.changeSettings(sam, { autonomyLevel: "ask_first" });
    const [checking] = bank.customerData.listAccounts(sam);
    if (!checking) throw new Error("Sam's checking account is missing");
    bank.cardPurchase(sam, { accountId: checking.id, merchant: "lantern-noodle-bar", amount: cents(27_00), idempotencyKey: "card:today" });

    const forecast = bank.readForecast(sam);

    expect(forecast?.start.balance).toBe(200_00);
    expect(balanceOn(forecast, "2026-11-20")).toBe(3_309_87);
    expect(balanceOn(forecast, "2026-12-03")).toBe(-8_82);
  });

  it("takes a purchase today out of the next sweep under within_rules, so the days after the paycheck don't change", () => {
    const bank = openTestBank();
    const sam = samIn(bank);
    const [checking] = bank.customerData.listAccounts(sam);
    if (!checking) throw new Error("Sam's checking account is missing");
    bank.cardPurchase(sam, { accountId: checking.id, merchant: "lantern-noodle-bar", amount: cents(27_00), idempotencyKey: "card:today" });

    const forecast = bank.readForecast(sam);

    // The 20 Nov sweep is $313 instead of $340.
    expect(balanceOn(forecast, "2026-11-20")).toBe(2_996_87);
    expect(forecast?.lowest).toEqual({ date: "2026-12-03", balance: -321_82 });
  });

  it("Priya's Forecast is worked out from her own Checking, not Sam's", () => {
    const bank = openTestBank();
    const priya = signInByName(bank, "Priya Natarajan");

    const forecast = bank.readForecast(priya);

    expect(forecast?.start).toEqual({ date: "2026-11-19", balance: 1_836_42 });
    expect(forecast?.buffer).toBe(500_00);
  });
});
