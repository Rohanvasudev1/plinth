import { describe, expect, it } from "vitest";
import { createBank, type Bank } from "./bank";
import { fixedClock } from "./clock";
import type { Customer } from "./customer-data";
import { openTestDatabase } from "./db/database";
import { accessLogTable } from "./db/schema";
import { cents } from "./money";
import { SettingsError } from "./settings";
import type { MerchantKey } from "./simulator";
import { FAKE_TEST_QUESTIONS } from "./fake-mission-model";
import type { MissionModel } from "./mission-model";
import { openTestBank, signInByName } from "./test-bank";

/** Friday 20 November 2026, 9am in New York: Sam's first payday. */
const SAM_PAYDAY_9AM = new Date("2026-11-20T14:00:00Z");
/** Friday 27 November 2026, 9am in New York: Alex's first payday. */
const ALEX_PAYDAY_9AM = new Date("2026-11-27T14:00:00Z");

function bankAt(at: Date): Bank {
  return createBank({ db: openTestDatabase(), clock: fixedClock(at) });
}

/** A model that never reports back, so its Mission runs until it is stopped. */
const silentModel: MissionModel = { runMission: () => new Promise(() => {}) };

function accessLogOf(bank: Bank, customer: Customer) {
  return bank.readPrivacy(customer).accessLog;
}

describe("Access log: the buffer agent's sweep check", () => {
  it("writes one entry by Your agent when the sweep is Done", () => {
    const bank = bankAt(SAM_PAYDAY_9AM);
    const sam = signInByName(bank, "Sam Calloway");
    const before = accessLogOf(bank, sam).length;

    bank.postPaycheck();

    const log = accessLogOf(bank, sam);
    expect(log).toHaveLength(before + 1);
    expect(log[0]).toMatchObject({ who: "agent", at: SAM_PAYDAY_9AM });
    expect(log[0]?.what).toBe("Your checking and savings balances, bills before payday and buffer Rule");
    expect(log[0]?.why).toContain("$3,240.00 from Acme Corp");
    expect(bank.readDecisionLog(sam)[0]?.result).toBe("Done");
  });

  it("writes one entry when the paused agent's sweep is Refused", () => {
    const bank = bankAt(SAM_PAYDAY_9AM);
    const sam = signInByName(bank, "Sam Calloway");
    bank.setAgentPaused(sam, true);
    const before = accessLogOf(bank, sam).length;

    bank.postPaycheck();

    expect(accessLogOf(bank, sam)).toHaveLength(before + 1);
    expect(accessLogOf(bank, sam)[0]?.who).toBe("agent");
    expect(bank.readDecisionLog(sam)[0]).toMatchObject({ result: "Refused", refusedBy: "agent_paused" });
  });

  it("writes one entry when the agent asks with a sweep Finding", () => {
    const bank = bankAt(SAM_PAYDAY_9AM);
    const sam = signInByName(bank, "Sam Calloway");
    bank.changeSettings(sam, { autonomyLevel: "ask_first" });
    const before = accessLogOf(bank, sam).length;

    bank.postPaycheck();

    expect(accessLogOf(bank, sam)).toHaveLength(before + 1);
    expect(bank.readFindings(sam)[0]).toMatchObject({ kind: "sweep", state: "open" });
  });

  it("writes one entry when Skip's buffer Rule, with no sweep target, takes no action", () => {
    const bank = bankAt(ALEX_PAYDAY_9AM);
    const alex = signInByName(bank, "Alex Okafor");
    bank.skipSetup(alex);
    const decisionsBefore = bank.readDecisionLog(alex).length;
    const before = accessLogOf(bank, alex).length;

    bank.postPaycheck();

    expect(accessLogOf(bank, alex)).toHaveLength(before + 1);
    expect(accessLogOf(bank, alex)[0]?.why).toContain("$2,100.00 from Acme Corp");
    expect(bank.readDecisionLog(alex)).toHaveLength(decisionsBefore);
  });

  it("writes nothing for a customer who hasn't finished setup", () => {
    const bank = bankAt(ALEX_PAYDAY_9AM);
    const alex = signInByName(bank, "Alex Okafor");

    bank.postPaycheck();

    expect(accessLogOf(bank, alex)).toEqual([]);
  });

  it("keeps each customer's entries to themselves when Sam and Priya both get a paycheck check", () => {
    const bank = openTestBank();
    const sam = signInByName(bank, "Sam Calloway");
    const priya = signInByName(bank, "Priya Natarajan");

    // Sam is paid on 20 Nov and Priya on 25 Nov.
    for (let day = 0; day < 6; day += 1) bank.advanceClock();

    // Each log holds the bank start's scan of existing purchases, then only that customer's own paycheck check.
    const scan = "Your Card purchases at Subscriptions Merchants";
    const paycheckCheck = "Your checking and savings balances, bills before payday and buffer Rule";
    expect(accessLogOf(bank, sam).map((entry) => [entry.what, entry.why.match(/\$[\d,.]+ from Acme Corp/)?.[0]])).toEqual([
      [paycheckCheck, "$3,240.00 from Acme Corp"],
      [scan, undefined],
    ]);
    expect(accessLogOf(bank, priya).map((entry) => [entry.what, entry.why.match(/\$[\d,.]+ from Acme Corp/)?.[0]])).toEqual([
      [paycheckCheck, "$2,480.00 from Acme Corp"],
      [scan, undefined],
    ]);
  });
});

describe("Access log: Missions", () => {
  it("writes one entry by Your agent listing the Read list when a Mission reports back", async () => {
    const bank = openTestBank();
    const sam = signInByName(bank, "Sam Calloway");
    const before = accessLogOf(bank, sam).length;

    const finished = await bank.startMission(sam, "Am I on track for my House fund?").ended;

    expect(finished.state).toBe("reported");
    const log = accessLogOf(bank, sam);
    expect(log).toHaveLength(before + 1);
    expect(log[0]?.who).toBe("agent");
    expect(log[0]?.what).toBe(
      "Fri 21 Aug to Thu 19 Nov; Usual month and On pace; Goals; 3-year Projection; 30 days from Thu 19 Nov; Scheduled bills",
    );
    expect(log[0]?.why).toContain("Am I on track for my House fund?");
  });

  it("writes one entry when a Mission fails", async () => {
    const bank = openTestBank();
    const sam = signInByName(bank, "Sam Calloway");
    const before = accessLogOf(bank, sam).length;

    const finished = await bank.startMission(sam, FAKE_TEST_QUESTIONS.modelError).ended;

    expect(finished.state).toBe("failed");
    expect(accessLogOf(bank, sam)).toHaveLength(before + 1);
  });

  it("writes one entry reading Nothing when a Mission that read nothing is stopped", async () => {
    const bank = createBank({ db: openTestDatabase(), clock: fixedClock(SAM_PAYDAY_9AM), missionModel: silentModel });
    const sam = signInByName(bank, "Sam Calloway");
    const before = accessLogOf(bank, sam).length;
    const { mission } = bank.startMission(sam, "Where does my money go?");
    expect(accessLogOf(bank, sam)).toHaveLength(before);

    bank.stopMission(sam, mission.id);
    bank.stopMission(sam, mission.id);

    expect(accessLogOf(bank, sam)).toHaveLength(before + 1);
    expect(accessLogOf(bank, sam)[0]).toMatchObject({ who: "agent", what: "Nothing" });
  });
});

describe("Access log: Subscription price rises", () => {
  function buy(bank: Bank, customer: Customer, merchant: MerchantKey, key: string) {
    const checking = bank.customerData.listAccounts(customer).find((account) => account.kind === "checking");
    if (!checking) throw new Error("No checking account");
    bank.cardPurchase(customer, { accountId: checking.id, merchant, amount: cents(5_00), idempotencyKey: key });
  }

  it("writes one entry for the scan of existing purchases when the bank starts, for each customer with the switch on", () => {
    const bank = openTestBank();

    for (const name of ["Sam Calloway", "Priya Natarajan"]) {
      expect(accessLogOf(bank, signInByName(bank, name))).toMatchObject([
        { who: "agent", what: "Your Card purchases at Subscriptions Merchants" },
      ]);
    }
    expect(accessLogOf(bank, signInByName(bank, "Alex Okafor"))).toEqual([]);
  });

  it("writes one entry per Card purchase it checks at a Subscriptions Merchant, and none at other Merchants", () => {
    const bank = openTestBank();
    const sam = signInByName(bank, "Sam Calloway");
    const before = accessLogOf(bank, sam).length;

    buy(bank, sam, "green-basket-market", "card:test:1");
    expect(accessLogOf(bank, sam)).toHaveLength(before);

    buy(bank, sam, "tunewell-streaming", "card:test:2");
    expect(accessLogOf(bank, sam)).toHaveLength(before + 1);
    expect(accessLogOf(bank, sam)[0]).toMatchObject({ who: "agent", what: "Your Card purchases at Tunewell Streaming" });
  });

  it("writes nothing while the switch is off, and one entry for the scan when it is switched back on", () => {
    const bank = openTestBank();
    const sam = signInByName(bank, "Sam Calloway");
    const before = accessLogOf(bank, sam).length;

    bank.setStandingSearch(sam, "subscription_price_rises", false);
    buy(bank, sam, "tunewell-streaming", "card:test:1");
    expect(accessLogOf(bank, sam)).toHaveLength(before);

    bank.setStandingSearch(sam, "subscription_price_rises", true);
    expect(accessLogOf(bank, sam)).toHaveLength(before + 1);
    expect(accessLogOf(bank, sam)[0]?.what).toBe("Your Card purchases at Subscriptions Merchants");
  });

  it("writes nothing for a customer who hasn't finished setup", () => {
    const bank = openTestBank();
    const alex = signInByName(bank, "Alex Okafor");

    buy(bank, alex, "clipreel", "card:test:1");

    expect(accessLogOf(bank, alex)).toEqual([]);
  });
});

describe("Access log records", () => {
  it("are refused any update or delete by the database", () => {
    const db = openTestDatabase();
    const bank = createBank({ db, clock: fixedClock(SAM_PAYDAY_9AM) });
    const sam = signInByName(bank, "Sam Calloway");
    expect(accessLogOf(bank, sam).length).toBeGreaterThan(0);

    expect(() => db.update(accessLogTable).set({ what: "Nothing" }).run()).toThrow(/append-only/);
    expect(() => db.delete(accessLogTable).run()).toThrow(/append-only/);
    expect(accessLogOf(bank, sam).length).toBeGreaterThan(0);
  });

  it("are not written by any page's reads", async () => {
    const bank = openTestBank();
    // Give every customer something on each page: a paycheck check, a sweep, a Finding and a Mission.
    for (let day = 0; day < 6; day += 1) bank.advanceClock();
    const sam = signInByName(bank, "Sam Calloway");
    const mission = await bank.startMission(sam, "Where does my money go?").ended;
    const counts = () => bank.listCustomers().map((customer) => accessLogOf(bank, customer).length);
    const before = counts();

    for (const customer of bank.listCustomers()) {
      bank.findCustomer(customer.id);
      bank.signIn(customer.id);
      bank.readHome(customer);
      bank.readActivity(customer);
      bank.readForecastPage(customer);
      bank.billsBeforePayday(customer);
      bank.readForecast(customer);
      bank.readDecisionLog(customer);
      bank.readSettings(customer);
      bank.readSetupAnswers(customer);
      bank.isAgentPaused(customer);
      bank.readFindings(customer);
      bank.readDiscoveries(customer);
      bank.countOpenFindings(customer);
      bank.readMission(customer, mission.id);
      bank.readPrivacy(customer);
      bank.customerData.listAccounts(customer);
      bank.customerData.listRules(customer);
    }

    expect(counts()).toEqual(before);
  });
});

describe("Data choices on Privacy", () => {
  it("shows Sam's three Data choices, and turning one on writes the next settings version and a Decision log entry", () => {
    const bank = openTestBank();
    const sam = signInByName(bank, "Sam Calloway");
    expect(bank.readPrivacy(sam).dataChoices).toEqual({ trainModels: false, shareWithPartners: false, keepChatHistory: false });
    const decisionsBefore = bank.readDecisionLog(sam).length;

    bank.setDataChoice(sam, "keepChatHistory", true);

    expect(bank.readPrivacy(sam).dataChoices).toEqual({ trainModels: false, shareWithPartners: false, keepChatHistory: true });
    expect(bank.readDecisionLog(sam)).toHaveLength(decisionsBefore + 1);
    expect(bank.readDecisionLog(sam)[0]).toMatchObject({
      actor: "customer",
      action: "Changed your settings: Keep chat history",
      result: "Done",
    });
    expect(bank.readDecisionLog(sam)[0]?.why).toContainEqual({ label: "Keep chat history", value: "Off → On" });
  });

  it("changes nothing when a Data choice is already in the state asked for", () => {
    const bank = openTestBank();
    const sam = signInByName(bank, "Sam Calloway");
    const decisionsBefore = bank.readDecisionLog(sam).length;

    bank.setDataChoice(sam, "trainModels", false);

    expect(bank.readDecisionLog(sam)).toHaveLength(decisionsBefore);
    expect(bank.readSettings(sam)?.version).toBe(1);
  });

  it("has no Data choices for Alex, who hasn't finished setup, and refuses to change one", () => {
    const bank = openTestBank();
    const alex = signInByName(bank, "Alex Okafor");

    expect(bank.readPrivacy(alex).dataChoices).toBeNull();
    expect(() => bank.setDataChoice(alex, "shareWithPartners", true)).toThrow(SettingsError);
    expect(bank.readDecisionLog(alex)).toEqual([]);
  });
});
