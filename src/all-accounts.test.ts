import { describe, expect, it, vi } from "vitest";
import { SIMULATION_START } from "./app-clock";
import type { Bank } from "./bank";
import { localDate } from "./calendar";
import type { Customer } from "./customer-data";
import { consentFrom, LinkedAccountError } from "./linked-accounts";
import { openTestBank, signInByName } from "./test-bank";

describe("All accounts", () => {
  it("shows Sam's Cash, Investments, Debt and Net worth to the cent on 19 Nov", () => {
    const bank = openTestBank();
    const sam = signInByName(bank, "Sam Calloway");

    const view = bank.readAllAccounts(sam);

    expect(view.figures).toEqual({
      cash: 12_627_00,
      investments: 41_200_00,
      debt: -17_110_55,
      netWorth: 36_716_45,
    });
  });

  it("lists Sam's Plinth accounts, then the three seeded Linked accounts with their Consent and last Sync", () => {
    const bank = openTestBank();
    const sam = signInByName(bank, "Sam Calloway");

    const view = bank.readAllAccounts(sam);

    expect(view.plinthAccounts.map(({ name, balance }) => ({ name, balance }))).toEqual([
      { name: "Checking", balance: 227_00 },
      { name: "House fund", balance: 12_400_00 },
    ]);
    expect(view.linkedAccounts).toEqual([
      expect.objectContaining({ institution: "Summit Card", type: "credit_card", balance: -2_310_55 }),
      expect.objectContaining({ institution: "Northwind", type: "retirement", balance: 41_200_00 }),
      expect.objectContaining({ institution: "Keystone Student Lending", type: "loan", balance: -14_800_00 }),
    ]);
    for (const linked of view.linkedAccounts) {
      expect(linked).toMatchObject({
        syncedAt: SIMULATION_START,
        consentStart: "2026-05-23",
        consentEnd: "2027-05-23",
        consentEnded: false,
      });
    }
  });

  it("writes one access log entry by Plinth for each of Sam's seeded Syncs, and none for Priya", () => {
    const bank = openTestBank();
    const sam = signInByName(bank, "Sam Calloway");
    const priya = signInByName(bank, "Priya Natarajan");

    const samsLog = bank.readPrivacy(sam).accessLog.filter((entry) => entry.who === "plinth");

    expect(samsLog).toHaveLength(3);
    expect(samsLog.map((entry) => ({ who: entry.who, at: entry.at }))).toEqual(
      Array(3).fill({ who: "plinth", at: SIMULATION_START }),
    );
    expect(samsLog.map((entry) => entry.what).sort()).toEqual([
      "Your Keystone Student Lending loan balance",
      "Your Northwind retirement (401(k)) balance",
      "Your Summit Card credit card balance",
    ]);
    expect(bank.readPrivacy(priya).accessLog.filter((entry) => entry.who === "plinth")).toEqual([]);
  });

  it("shows Priya, with no Linked accounts, only her Plinth accounts", () => {
    const bank = openTestBank();
    const priya = signInByName(bank, "Priya Natarajan");

    const view = bank.readAllAccounts(priya);

    expect(view.linkedAccounts).toEqual([]);
    expect(view.figures).toEqual({ cash: 3_986_42, investments: 0, debt: 0, netWorth: 3_986_42 });
  });
});

describe("Link another bank", () => {
  it("lists the accounts Sam can link, with the Consent end date 12 months from today", () => {
    const bank = openTestBank();
    const sam = signInByName(bank, "Sam Calloway");

    expect(bank.listLinkableAccounts(sam)).toEqual([
      { key: "harbor-credit-union", institution: "Harbor Credit Union", type: "checking", consentEnd: "2027-11-19" },
      { key: "lakeside-bank", institution: "Lakeside Bank", type: "savings", consentEnd: "2027-11-19" },
    ]);
  });

  it("links Harbor Credit Union with a new Consent, raising Sam's Cash and Net worth, and leaves it off the list", () => {
    const bank = openTestBank();
    const sam = signInByName(bank, "Sam Calloway");

    bank.linkAccount(sam, "harbor-credit-union");

    const view = bank.readAllAccounts(sam);
    expect(view.figures).toMatchObject({ cash: 14_767_00, netWorth: 38_856_45 });
    expect(view.linkedAccounts.at(-1)).toMatchObject({
      institution: "Harbor Credit Union",
      balance: 2_140_00,
      syncedAt: SIMULATION_START,
      consentStart: "2026-11-19",
      consentEnd: "2027-11-19",
    });
    expect(bank.listLinkableAccounts(sam).map((account) => account.key)).toEqual(["lakeside-bank"]);
  });

  it("writes one Decision log entry with Sam as actor and one access log entry for its Sync", () => {
    const bank = openTestBank();
    const sam = signInByName(bank, "Sam Calloway");
    const logBefore = bank.readPrivacy(sam).accessLog.length;

    bank.linkAccount(sam, "harbor-credit-union");

    const [newest] = bank.readDecisionLog(sam);
    expect(newest).toMatchObject({ actor: "customer", result: "Done", action: "Linked Harbor Credit Union checking", amount: 0 });
    const log = bank.readPrivacy(sam).accessLog;
    expect(log).toHaveLength(logBefore + 1);
    expect(log[0]).toMatchObject({ who: "plinth", what: "Your Harbor Credit Union checking balance" });
  });

  it("refuses an account already linked, or one the customer doesn't hold, writing nothing", () => {
    const bank = openTestBank();
    const sam = signInByName(bank, "Sam Calloway");
    const priya = signInByName(bank, "Priya Natarajan");
    const decisionsBefore = bank.readDecisionLog(sam).length;

    expect(() => bank.linkAccount(sam, "summit-card")).toThrow(LinkedAccountError);
    expect(() => bank.linkAccount(priya, "summit-card")).toThrow(LinkedAccountError);

    expect(bank.readDecisionLog(sam)).toHaveLength(decisionsBefore);
    expect(bank.readAllAccounts(priya).linkedAccounts).toEqual([]);
  });

  it("links while the agent is paused", () => {
    const bank = openTestBank();
    const sam = signInByName(bank, "Sam Calloway");
    bank.setAgentPaused(sam, true);

    bank.linkAccount(sam, "lakeside-bank");

    expect(bank.readAllAccounts(sam).figures.cash).toBe(17_827_00);
  });
});

/** 9am in New York on 20 Nov 2026, after one clock advance. */
const NOV_20_9AM = new Date("2026-11-20T14:00:00Z");

function plinthEntries(bank: Bank, customer: Customer) {
  return bank.readPrivacy(customer).accessLog.filter((entry) => entry.who === "plinth");
}

describe("Sync", () => {
  it("syncs each of Sam's Linked accounts once when the clock advances to 20 Nov", () => {
    const bank = openTestBank();
    const sam = signInByName(bank, "Sam Calloway");

    bank.advanceClock();

    const view = bank.readAllAccounts(sam);
    expect(view.linkedAccounts.find((linked) => linked.institution === "Summit Card")?.balance).toBe(-2_355_55);
    expect(view.linkedAccounts.map((linked) => linked.syncedAt)).toEqual([NOV_20_9AM, NOV_20_9AM, NOV_20_9AM]);
    expect(view.figures.debt).toBe(-17_155_55);
    expect(view.figures.netWorth).toBe(view.figures.cash + view.figures.investments + view.figures.debt);
    const syncs = plinthEntries(bank, sam).filter((entry) => entry.at.getTime() === NOV_20_9AM.getTime());
    expect(syncs).toHaveLength(3);
  });

  it("still syncs while the agent is paused", () => {
    const bank = openTestBank();
    const sam = signInByName(bank, "Sam Calloway");
    bank.setAgentPaused(sam, true);

    bank.advanceClock();

    expect(bank.readAllAccounts(sam).figures.debt).toBe(-17_155_55);
  });

  it("puts the clock back and syncs nothing when the advance fails", () => {
    const bank = openTestBank();
    const sam = signInByName(bank, "Sam Calloway");
    const failing = vi.spyOn(bank.customerData, "saveLinkedAccountSync").mockImplementationOnce(() => {
      throw new Error("the Institution is down");
    });

    expect(() => bank.advanceClock()).toThrow("the Institution is down");

    failing.mockRestore();
    expect(bank.clock.now()).toEqual(SIMULATION_START);
    expect(bank.readAllAccounts(sam).linkedAccounts.map((linked) => linked.syncedAt)).toEqual(
      Array(3).fill(SIMULATION_START),
    );
  });
});

describe("Consent", () => {
  /** 9am in New York (EDT) on 23 May 2027, the day Sam's seeded Consents end. */
  const MAY_23_2027_9AM = new Date("2027-05-23T13:00:00Z");

  it("takes Sam's three Linked accounts out of the figures once their Consent ends on 23 May 2027", () => {
    const bank = openTestBank();
    const sam = signInByName(bank, "Sam Calloway");
    bank.clock.setTo(MAY_23_2027_9AM);

    const view = bank.readAllAccounts(sam);

    expect(view.linkedAccounts.map((linked) => linked.consentEnded)).toEqual([true, true, true]);
    expect(view.figures).toMatchObject({ investments: 0, debt: 0 });
    expect(view.figures.netWorth).toBe(view.figures.cash);
  });

  it("doesn't sync a Linked account whose Consent has ended on the new date", () => {
    const bank = openTestBank();
    const sam = signInByName(bank, "Sam Calloway");
    bank.clock.setTo(new Date("2027-05-22T13:00:00Z"));
    const logBefore = plinthEntries(bank, sam).length;

    bank.advanceClock();

    expect(plinthEntries(bank, sam)).toHaveLength(logBefore);
    expect(bank.readAllAccounts(sam).linkedAccounts.map((linked) => linked.syncedAt)).toEqual(
      Array(3).fill(SIMULATION_START),
    );
  });

  it("doesn't sync them on the next advance from 23 May 2027 either", () => {
    const bank = openTestBank();
    const sam = signInByName(bank, "Sam Calloway");
    bank.clock.setTo(MAY_23_2027_9AM);
    const logBefore = plinthEntries(bank, sam).length;

    bank.advanceClock();

    expect(plinthEntries(bank, sam)).toHaveLength(logBefore);
    expect(bank.readAllAccounts(sam).linkedAccounts.map((linked) => linked.consentEnded)).toEqual([true, true, true]);
  });

  it("renews an ended Consent for 12 months from today, syncs, and writes a Decision log entry", () => {
    const bank = openTestBank();
    const sam = signInByName(bank, "Sam Calloway");
    bank.clock.setTo(MAY_23_2027_9AM);
    const summit = bank.readAllAccounts(sam).linkedAccounts[0];
    if (!summit) throw new Error("Sam has no Summit Card");
    const logBefore = plinthEntries(bank, sam).length;

    bank.renewConsent(sam, summit.id);

    const renewed = bank.readAllAccounts(sam).linkedAccounts[0];
    expect(renewed).toMatchObject({
      consentStart: "2027-05-23",
      consentEnd: "2028-05-23",
      consentEnded: false,
      syncedAt: MAY_23_2027_9AM,
    });
    expect(bank.readAllAccounts(sam).figures.debt).toBe(renewed?.balance);
    expect(plinthEntries(bank, sam)).toHaveLength(logBefore + 1);
    expect(bank.readDecisionLog(sam)[0]).toMatchObject({
      actor: "customer",
      action: "Renewed your Consent for Summit Card credit card",
    });
  });

  it("refuses to renew a Consent that hasn't ended, or another customer's Linked account", () => {
    const bank = openTestBank();
    const sam = signInByName(bank, "Sam Calloway");
    const priya = signInByName(bank, "Priya Natarajan");
    const summitId = bank.readAllAccounts(sam).linkedAccounts[0]?.id ?? -1;

    expect(() => bank.renewConsent(sam, summitId)).toThrow(LinkedAccountError);
    bank.clock.setTo(MAY_23_2027_9AM);
    expect(() => bank.renewConsent(priya, summitId)).toThrow(LinkedAccountError);
  });

  it("ends a Consent given on 29 Feb on 28 Feb the next year", () => {
    expect(consentFrom(localDate("2028-02-29"))).toEqual({ start: "2028-02-29", end: "2029-02-28" });
  });
});

describe("Unlink", () => {
  it("deletes Summit Card at once, with a Decision log entry by Sam and an access log entry by Plinth", () => {
    const bank = openTestBank();
    const sam = signInByName(bank, "Sam Calloway");
    const summitId = bank.readAllAccounts(sam).linkedAccounts[0]?.id ?? -1;
    const logBefore = plinthEntries(bank, sam).length;

    bank.unlinkAccount(sam, summitId);

    const view = bank.readAllAccounts(sam);
    expect(view.linkedAccounts.map((linked) => linked.institution)).toEqual(["Northwind", "Keystone Student Lending"]);
    expect(view.figures.debt).toBe(-14_800_00);
    expect(bank.readDecisionLog(sam)[0]).toMatchObject({ actor: "customer", action: "Unlinked Summit Card credit card" });
    const log = plinthEntries(bank, sam);
    expect(log).toHaveLength(logBefore + 1);
    expect(log[0]).toMatchObject({ what: "Your Summit Card credit card balance and Consent" });
  });

  it("lets Sam link Summit Card again with a new Consent", () => {
    const bank = openTestBank();
    const sam = signInByName(bank, "Sam Calloway");
    bank.unlinkAccount(sam, bank.readAllAccounts(sam).linkedAccounts[0]?.id ?? -1);

    expect(bank.listLinkableAccounts(sam).map((account) => account.key)).toContain("summit-card");
    bank.linkAccount(sam, "summit-card");

    expect(bank.readAllAccounts(sam).linkedAccounts.at(-1)).toMatchObject({
      institution: "Summit Card",
      consentStart: "2026-11-19",
      consentEnd: "2027-11-19",
    });
  });

  it("unlinks an account whose Consent has ended, and refuses another customer's", () => {
    const bank = openTestBank();
    const sam = signInByName(bank, "Sam Calloway");
    const priya = signInByName(bank, "Priya Natarajan");
    const summitId = bank.readAllAccounts(sam).linkedAccounts[0]?.id ?? -1;

    expect(() => bank.unlinkAccount(priya, summitId)).toThrow(LinkedAccountError);
    bank.clock.setTo(new Date("2027-06-01T13:00:00Z"));
    bank.unlinkAccount(sam, summitId);

    expect(bank.readAllAccounts(sam).linkedAccounts).toHaveLength(2);
  });
});

describe("Linked accounts are kept apart", () => {
  it("shows Sam and Priya, who both link Harbor Credit Union and both sync, only their own figures and access log", () => {
    const bank = openTestBank();
    const sam = signInByName(bank, "Sam Calloway");
    const priya = signInByName(bank, "Priya Natarajan");
    bank.linkAccount(sam, "harbor-credit-union");
    bank.linkAccount(priya, "harbor-credit-union");

    bank.advanceClock();

    const samsView = bank.readAllAccounts(sam);
    const priyasView = bank.readAllAccounts(priya);
    expect(samsView.linkedAccounts.map((linked) => linked.institution)).toEqual([
      "Summit Card",
      "Northwind",
      "Keystone Student Lending",
      "Harbor Credit Union",
    ]);
    expect(priyasView.linkedAccounts.map((linked) => linked.institution)).toEqual(["Harbor Credit Union"]);
    const samsIds = samsView.linkedAccounts.map((linked) => linked.id);
    expect(priyasView.linkedAccounts.every((linked) => !samsIds.includes(linked.id))).toBe(true);
    expect(priyasView.figures).toMatchObject({ investments: 0, debt: 0 });

    // Priya's Plinth entries: Harbor's Sync on link and on the advance. Sam's: three seeded, Harbor on link, four on the advance.
    expect(plinthEntries(bank, priya).map((entry) => entry.what)).toEqual(Array(2).fill("Your Harbor Credit Union checking balance"));
    expect(plinthEntries(bank, sam)).toHaveLength(8);
  });
});
