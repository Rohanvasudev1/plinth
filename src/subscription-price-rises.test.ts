import { describe, expect, it } from "vitest";
import type { Bank } from "./bank";
import type { Customer } from "./customer-data";
import type { Finding } from "./findings";
import { cents } from "./money";
import type { MerchantKey } from "./simulator";
import { openTestBank, signInByName } from "./test-bank";

function subscriptionFindings(bank: Bank, customer: Customer): Finding[] {
  return bank.readFindings(customer).filter((finding) => finding.kind === "subscription_price_rise");
}

describe("the Subscription price rises Standing search on a fresh seed", () => {
  it("gives Sam exactly two open Findings, Tunewell and Clipreel, and Priya and Alex none", () => {
    const bank = openTestBank();
    const sam = signInByName(bank, "Sam Calloway");

    const findings = subscriptionFindings(bank, sam);

    expect(findings.map((finding) => [finding.title, finding.state]).sort()).toEqual([
      ["Tunewell Streaming went up from $15.00 to $18.00", "open"],
      ["Your Clipreel free trial turned paid at $12.99", "open"],
    ]);
    expect(subscriptionFindings(bank, signInByName(bank, "Priya Natarajan"))).toEqual([]);
    expect(subscriptionFindings(bank, signInByName(bank, "Alex Okafor"))).toEqual([]);
  });

  it("states the old and new charges, what Plinth can't see, each from your card charges, with Keep paying and Remind me in a month", () => {
    const bank = openTestBank();
    const sam = signInByName(bank, "Sam Calloway");
    const findings = subscriptionFindings(bank, sam);
    const tunewell = findings.find((finding) => finding.title.startsWith("Tunewell"));
    const clipreel = findings.find((finding) => finding.title.includes("Clipreel"));

    expect(tunewell).toMatchObject({
      standingSearch: "subscription_price_rises",
      rule: null,
      agentsView: null,
      facts: [
        { label: "Before", value: "$15.00 on Tue 15 Sept", source: "From your card charges" },
        { label: "Now", value: "$18.00 on Thu 15 Oct", source: "From your card charges" },
        { label: "What Plinth can see", value: "Plinth can see what you pay, not whether you use it", source: "From your card charges" },
      ],
      // The bank starts on 19 Nov 2026, so a month later is 19 Dec.
      options: [{ key: "keep_paying" }, { key: "remind_me", date: "2026-12-19" }],
    });
    expect(clipreel?.facts).toEqual([
      { label: "Free trial turned paid", value: "$12.99 on Fri 14 Aug", source: "From your card charges" },
      { label: "What Plinth can see", value: "Plinth can see what you pay, not whether you use it", source: "From your card charges" },
    ]);
  });
});

/** Sam, with a Card purchase helper that spends from Checking at one Merchant on today's simulated date. */
function samBuying(): { bank: Bank; sam: Customer; buy: (merchant: MerchantKey, amount: number) => void } {
  const bank = openTestBank();
  const sam = signInByName(bank, "Sam Calloway");
  const checking = bank.customerData.listAccounts(sam).find((account) => account.kind === "checking");
  if (!checking) throw new Error("Sam's checking account is missing");
  let purchases = 0;
  return {
    bank,
    sam,
    buy(merchant, amount) {
      purchases += 1;
      bank.cardPurchase(sam, { accountId: checking.id, merchant, amount: cents(amount), idempotencyKey: `card:test:${purchases}` });
    },
  };
}

describe("the Subscription price rises Standing search as card charges post", () => {
  it("makes no second Finding for the same higher price, and a new one for a further rise", () => {
    const { bank, sam, buy } = samBuying();

    buy("tunewell-streaming", 18_00);
    expect(subscriptionFindings(bank, sam)).toHaveLength(2);

    buy("tunewell-streaming", 21_00);
    const findings = subscriptionFindings(bank, sam);
    expect(findings).toHaveLength(3);
    expect(findings[0]).toMatchObject({
      title: "Tunewell Streaming went up from $18.00 to $21.00",
      state: "open",
      facts: [
        { label: "Before", value: "$18.00 on Thu 19 Nov" },
        { label: "Now", value: "$21.00 on Thu 19 Nov" },
        { label: "What Plinth can see" },
      ],
    });

    buy("tunewell-streaming", 21_00);
    expect(subscriptionFindings(bank, sam)).toHaveLength(3);
  });

  it("finds nothing when a price goes down, nor at a Merchant outside Subscriptions", () => {
    const { bank, sam, buy } = samBuying();

    buy("tunewell-streaming", 9_00);
    buy("morning-crumb-cafe", 4_00);
    buy("morning-crumb-cafe", 40_00);

    expect(subscriptionFindings(bank, sam)).toHaveLength(2);
  });

  it("reports a free-trial Merchant's first charge to Priya, then nothing for the next charge at the same price", () => {
    const bank = openTestBank();
    const priya = signInByName(bank, "Priya Natarajan");
    const checking = bank.customerData.listAccounts(priya).find((account) => account.kind === "checking");
    if (!checking) throw new Error("Priya's checking account is missing");
    const buy = (key: string) =>
      bank.cardPurchase(priya, { accountId: checking.id, merchant: "clipreel", amount: cents(12_99), idempotencyKey: key });

    buy("card:clipreel:1");
    buy("card:clipreel:2");

    expect(subscriptionFindings(bank, priya).map((finding) => [finding.title, finding.facts[0]?.value])).toEqual([
      ["Your Clipreel free trial turned paid at $12.99", "$12.99 on Thu 19 Nov"],
    ]);
  });
});

describe("the Subscription price rises switch", () => {
  it("is on by default, and shows on Discoveries", () => {
    const bank = openTestBank();
    const sam = signInByName(bank, "Sam Calloway");

    expect(bank.readSettings(sam)?.standingSearches).toEqual({ subscription_price_rises: true });
    expect(bank.readDiscoveries(sam).standingSearches).toEqual([
      { search: "subscription_price_rises", on: true },
    ]);
  });

  it("switched off, expires the search's open and snoozed Findings, logs the change, and finds nothing new", () => {
    const { bank, sam, buy } = samBuying();
    const [first, second] = subscriptionFindings(bank, sam);
    if (!first || !second) throw new Error("Sam's seeded Findings are missing");
    expect(bank.chooseOption(sam, first.id, "remind_me")).toMatchObject({ ok: true });

    bank.setStandingSearch(sam, "subscription_price_rises", false);

    expect(subscriptionFindings(bank, sam).map((finding) => finding.state)).toEqual(["expired", "expired"]);
    expect(bank.readSettings(sam)?.standingSearches.subscription_price_rises).toBe(false);
    expect(bank.readDecisionLog(sam)[0]).toMatchObject({
      actor: "customer",
      action: "Changed your settings: Subscription price rises",
      why: expect.arrayContaining([{ label: "Subscription price rises", value: "On → Off" }]),
    });
    buy("tunewell-streaming", 21_00);
    expect(subscriptionFindings(bank, sam)).toHaveLength(2);
    expect(bank.readDiscoveries(sam).standingSearches[0]?.on).toBe(false);
  });

  it("switched back on, checks existing charges: nothing new for prices already reported, a Finding for a rise it missed", () => {
    const { bank, sam, buy } = samBuying();
    bank.setStandingSearch(sam, "subscription_price_rises", false);

    bank.setStandingSearch(sam, "subscription_price_rises", true);
    expect(subscriptionFindings(bank, sam).map((finding) => finding.state)).toEqual(["expired", "expired"]);
    expect(bank.readDecisionLog(sam)[0]).toMatchObject({
      why: expect.arrayContaining([{ label: "Subscription price rises", value: "Off → On" }]),
    });

    bank.setStandingSearch(sam, "subscription_price_rises", false);
    buy("tunewell-streaming", 21_00);
    bank.setStandingSearch(sam, "subscription_price_rises", true);
    expect(subscriptionFindings(bank, sam).map((finding) => [finding.title, finding.state])).toEqual([
      ["Tunewell Streaming went up from $18.00 to $21.00", "open"],
      ["Tunewell Streaming went up from $15.00 to $18.00", "expired"],
      ["Your Clipreel free trial turned paid at $12.99", "expired"],
    ]);
  });

  it("asked for the state it is already in, changes nothing and logs nothing", () => {
    const bank = openTestBank();
    const sam = signInByName(bank, "Sam Calloway");
    const entries = bank.readDecisionLog(sam).length;

    bank.setStandingSearch(sam, "subscription_price_rises", true);

    expect(bank.readDecisionLog(sam)).toHaveLength(entries);
    expect(subscriptionFindings(bank, sam).map((finding) => finding.state)).toEqual(["open", "open"]);
  });
});
