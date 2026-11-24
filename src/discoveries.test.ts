import { describe, expect, it } from "vitest";
import type { Bank } from "./bank";
import { localDate } from "./calendar";
import type { Customer } from "./customer-data";
import type { Finding, NewFinding } from "./findings";
import { openTestBank, signInByName } from "./test-bank";

/** A Mission-kind Finding written straight to the test database, as a Mission will write one. */
function missionFinding(overrides: Partial<NewFinding> = {}): NewFinding {
  return {
    kind: "mission",
    title: "Three months off next summer would leave you $4,200.00 short",
    facts: [
      { label: "Usual month", value: "$7,020.00 in, $5,108.00 out", source: "From your Usual month" },
      { label: "House fund", value: "$12,400.00", source: "From your Goals" },
    ],
    options: [{ key: "read_report" }, { key: "remind_me", date: localDate("2026-12-01") }, { key: "not_now" }],
    agentsView: "I would pick Remind me: your bonus lands in December.",
    report: "The full working: three months of spending at $5,108.00 is $15,324.00.",
    ...overrides,
  };
}

function samWithMissionFinding(overrides: Partial<NewFinding> = {}): { bank: Bank; sam: Customer; finding: Finding } {
  const bank = openTestBank();
  const sam = signInByName(bank, "Sam Calloway");
  const finding = bank.customerData.createFinding(sam, missionFinding(overrides));
  return { bank, sam, finding };
}

function customerEntries(bank: Bank, customer: Customer) {
  return bank.readDecisionLog(customer).filter((entry) => entry.actor === "customer");
}

describe("Options on a Mission Finding", () => {
  it("Read the full report returns the stored report, leaves the Finding open and writes a Decision log entry", () => {
    const { bank, sam, finding } = samWithMissionFinding();
    const before = customerEntries(bank, sam).length;

    const outcome = bank.chooseOption(sam, finding.id, "read_report");

    expect(outcome).toMatchObject({ ok: true, finding: { id: finding.id, state: "open", chosenOption: null } });
    expect(outcome.ok && outcome.finding.report).toBe(
      "The full working: three months of spending at $5,108.00 is $15,324.00.",
    );
    const entries = customerEntries(bank, sam);
    expect(entries).toHaveLength(before + 1);
    expect(entries[0]).toMatchObject({ rule: null, action: "Read the full report: “Three months off next summer would leave you $4,200.00 short”", result: "Done" });
  });

  it("Not now and Keep paying close the Finding as chosen, each with a Decision log entry", () => {
    for (const key of ["not_now", "keep_paying"] as const) {
      const { bank, sam, finding } = samWithMissionFinding({ options: [{ key: "not_now" }, { key: "keep_paying" }] });
      const before = customerEntries(bank, sam).length;

      const outcome = bank.chooseOption(sam, finding.id, key);

      expect(outcome, key).toMatchObject({ ok: true, finding: { state: "chosen", chosenOption: key } });
      expect(customerEntries(bank, sam), key).toHaveLength(before + 1);
      expect(bank.chooseOption(sam, finding.id, "not_now"), key).toMatchObject({ ok: false });
    }
  });

  it("Remind me snoozes the Finding until its date, with a Decision log entry", () => {
    const { bank, sam, finding } = samWithMissionFinding();
    const before = customerEntries(bank, sam).length;

    const outcome = bank.chooseOption(sam, finding.id, "remind_me");

    expect(outcome).toMatchObject({ ok: true, finding: { state: "snoozed", snoozedUntil: "2026-12-01" } });
    const entries = customerEntries(bank, sam);
    expect(entries).toHaveLength(before + 1);
    expect(entries[0]?.why).toContainEqual({ label: "What changes", value: "Shows again on Tue 1 Dec" });
    expect(bank.chooseOption(sam, finding.id, "not_now")).toMatchObject({ ok: false });
  });

  it("Remind me on a date that has already come changes nothing", () => {
    const { bank, sam, finding } = samWithMissionFinding({
      options: [{ key: "remind_me", date: localDate("2026-11-19") }, { key: "not_now" }],
    });

    expect(bank.chooseOption(sam, finding.id, "remind_me")).toMatchObject({ ok: false, finding: { state: "open" } });
  });
});

describe("A snoozed Finding", () => {
  it("opens again once the simulated clock reaches its date, and writes a Decision log entry when it does", () => {
    const { bank, sam, finding } = samWithMissionFinding({
      options: [{ key: "remind_me", date: localDate("2026-11-21") }, { key: "not_now" }],
    });
    bank.chooseOption(sam, finding.id, "remind_me");
    const before = customerEntries(bank, sam).length;

    bank.advanceClock(); // Friday 20 November
    expect(bank.customerData.getFinding(sam, finding.id)).toMatchObject({ state: "snoozed" });
    expect(customerEntries(bank, sam)).toHaveLength(before);

    bank.advanceClock(); // Saturday 21 November
    expect(bank.customerData.getFinding(sam, finding.id)).toMatchObject({ state: "open", snoozedUntil: null });
    const entries = customerEntries(bank, sam);
    expect(entries).toHaveLength(before + 1);
    expect(entries[0]).toMatchObject({
      trigger: { description: "Your reminder date came" },
      action: "Showed you “Three months off next summer would leave you $4,200.00 short” again",
    });

    bank.advanceClock();
    expect(customerEntries(bank, sam)).toHaveLength(before + 1);
    expect(bank.chooseOption(sam, finding.id, "not_now")).toMatchObject({ ok: true });
  });
});

describe("The Discoveries page", () => {
  it("lists every Finding newest first, sweep and Mission alike, and counts the open ones", () => {
    const bank = openTestBank();
    const sam = signInByName(bank, "Sam Calloway");
    bank.changeSettings(sam, { autonomyLevel: "ask_first" });
    const older = bank.customerData.createFinding(sam, missionFinding({ title: "Older" }));
    bank.chooseOption(sam, older.id, "not_now");
    bank.advanceClock(); // Friday 20 November: payday makes a sweep Finding
    const newer = bank.customerData.createFinding(sam, missionFinding({ title: "Newer" }));

    const page = bank.readDiscoveries(sam);

    expect(page.findings.map((finding) => finding.title)).toEqual([
      "Newer",
      "$340.00 above your Buffer in Checking",
      "Older",
      // Sam's seeded Subscription price rise Findings, made when the bank started.
      "Tunewell Streaming went up from $15.00 to $18.00",
      "Your Clipreel free trial turned paid at $12.99",
    ]);
    expect(page.findings[0]?.id).toBe(newer.id);
    expect(page.findings[1]?.facts.every((fact) => fact.source.length > 0)).toBe(true);
    expect(page.openFindingCount).toBe(4);
    expect(bank.readHome(sam).openFindingCount).toBe(4);
  });

  it("shows the Agent's view as the current Advice setting allows, and under never sends none of its text", () => {
    const { bank, sam } = samWithMissionFinding();
    const view = "I would pick Remind me: your bonus lands in December.";

    expect(bank.readSettings(sam)?.adviceSetting).toBe("on_request");
    expect(bank.readDiscoveries(sam).findings[0]?.agentsView).toEqual({ shown: "on_request", text: view });

    bank.changeSettings(sam, { adviceSetting: "always" });
    expect(bank.readDiscoveries(sam).findings[0]?.agentsView).toEqual({ shown: "always", text: view });

    bank.changeSettings(sam, { adviceSetting: "never" });
    const page = bank.readDiscoveries(sam);
    expect(page.adviceSetting).toBe("never");
    expect(page.findings[0]?.agentsView).toBeNull();
    expect(JSON.stringify(page)).not.toContain("I would pick");
  });

  it("shows no Agent's view on a Finding that has none, under any Advice setting", () => {
    const { bank, sam } = samWithMissionFinding({ agentsView: null });
    for (const adviceSetting of ["never", "on_request", "always"] as const) {
      bank.changeSettings(sam, { adviceSetting });
      expect(bank.readDiscoveries(sam).findings[0]?.agentsView, adviceSetting).toBeNull();
    }
  });

  it("holds only the signed-in customer's Findings", () => {
    const bank = openTestBank();
    const sam = signInByName(bank, "Sam Calloway");
    const priya = signInByName(bank, "Priya Natarajan");
    bank.customerData.createFinding(sam, missionFinding({ title: "Sam's Finding" }));
    bank.customerData.createFinding(priya, missionFinding({ title: "Priya's Finding" }));

    expect(bank.readDiscoveries(sam).findings.map((finding) => finding.title)).toEqual([
      "Sam's Finding",
      "Tunewell Streaming went up from $15.00 to $18.00",
      "Your Clipreel free trial turned paid at $12.99",
    ]);
    expect(bank.readDiscoveries(priya).findings.map((finding) => finding.title)).toEqual(["Priya's Finding"]);
    expect(bank.readDiscoveries(priya).openFindingCount).toBe(1);
  });
});
