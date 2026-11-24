import { describe, expect, it } from "vitest";
import { createBank, type Bank } from "./bank";
import { fixedClock } from "./clock";
import { openTestDatabase } from "./db/database";
import type { Customer } from "./customer-data";
import type { CustomerExport } from "./export";
import { cents } from "./money";
import { openTestBank, signInByName } from "./test-bank";

/** Friday 20 November 2026, 9am in New York: Sam's first payday. */
const SAM_PAYDAY_9AM = new Date("2026-11-20T14:00:00Z");

/** Every key in `value`, however deep, with the values it holds. */
function keysIn(value: unknown, found: [string, unknown][] = []): [string, unknown][] {
  if (Array.isArray(value)) for (const item of value) keysIn(item, found);
  else if (typeof value === "object" && value !== null) {
    for (const [key, inner] of Object.entries(value)) {
      found.push([key, inner]);
      keysIn(inner, found);
    }
  }
  return found;
}

/** The ids of every row in each section of an Export. */
function idsIn(file: CustomerExport): Record<string, number[]> {
  return {
    plinthAccounts: file.plinthAccounts.map((row) => row.id),
    linkedAccounts: file.linkedAccounts.map((row) => row.id),
    ledgerTransactions: file.ledgerTransactions.map((row) => row.id),
    decisionLog: file.decisionLog.map((row) => row.id),
    findings: file.findings.map((row) => row.id),
    missions: file.missions.map((row) => row.id),
    rules: file.rules.map((row) => row.id),
    accessLog: file.accessLog.map((row) => row.id),
  };
}

/** Gives Sam something in every section: a reported Mission and its Finding, a second settings version, a second
 * version of each Rule and a Goal target. */
async function samWithDataEverywhere(bank: Bank): Promise<Customer> {
  const sam = signInByName(bank, "Sam Calloway");
  await bank.startMission(sam, "What's my Usual month?").ended;
  bank.setDataChoice(sam, "keepChatHistory", true);
  for (const rule of bank.customerData.listRules(sam)) bank.switchRule(sam, rule.id, false);
  const houseFund = bank.customerData.listAccounts(sam).find((account) => account.name === "House fund");
  if (!houseFund) throw new Error("Sam has no House fund");
  bank.setGoalTarget(sam, houseFund.id, cents(60_000_00));
  return sam;
}

describe("Export", () => {
  it("writes one access log entry by You before building the file, so the file holds it", () => {
    const bank = openTestBank();
    const sam = signInByName(bank, "Sam Calloway");
    const before = bank.readPrivacy(sam).accessLog.length;

    const file = bank.buildExport(sam);

    const log = bank.readPrivacy(sam).accessLog;
    expect(log).toHaveLength(before + 1);
    expect(log[0]).toMatchObject({ who: "customer", what: "Everything Plinth holds about you" });
    expect(file.accessLog).toHaveLength(before + 1);
    expect(file.accessLog[0]).toMatchObject({ id: log[0]?.id, who: "customer", at: "2026-11-19T14:00:00.000Z" });
  });

  it("holds Sam's accounts, Linked accounts, ledger, Decision log, Findings, Missions, settings, Rules, Goals and access log", async () => {
    const bank = openTestBank();
    const sam = await samWithDataEverywhere(bank);

    const file = bank.buildExport(sam);

    expect(file.customer).toEqual({ id: sam.id, name: "Sam Calloway" });
    expect(file.plinthAccounts.map(({ kind, name, balanceCents }) => ({ kind, name, balanceCents }))).toEqual([
      { kind: "checking", name: "Checking", balanceCents: 227_00 },
      { kind: "savings", name: "House fund", balanceCents: 12_400_00 },
    ]);
    expect(file.linkedAccounts.map(({ institution, type, balanceCents, consent }) => ({ institution, type, balanceCents, consent }))).toEqual([
      { institution: "Summit Card", type: "credit_card", balanceCents: -2_310_55, consent: { start: "2026-05-23", end: "2027-05-23" } },
      { institution: "Northwind", type: "retirement", balanceCents: 41_200_00, consent: { start: "2026-05-23", end: "2027-05-23" } },
      { institution: "Keystone Student Lending", type: "loan", balanceCents: -14_800_00, consent: { start: "2026-05-23", end: "2027-05-23" } },
    ]);
    expect(file.linkedAccounts[0]?.syncedAt).toBe("2026-11-19T14:00:00.000Z");
    expect(file.ledgerTransactions).toHaveLength(bank.customerData.listLedgerTransactions(sam).length);
    for (const transaction of file.ledgerTransactions) {
      expect(transaction.entries.reduce((sum, entry) => sum + entry.amountCents, 0)).toBe(0);
    }
    expect(file.decisionLog.map((entry) => entry.action)).toEqual(bank.readDecisionLog(sam).map((entry) => entry.action));
    expect(file.findings.map((finding) => finding.id)).toEqual(bank.readFindings(sam).map((finding) => finding.id));
    expect(file.findings.filter((finding) => finding.kind === "mission")).toEqual([
      expect.objectContaining({ missionId: file.missions[0]?.id, state: "open" }),
    ]);
    expect(file.missions).toHaveLength(1);
    expect(file.missions[0]).toMatchObject({ question: "What's my Usual month?", state: "reported" });
    expect(file.missions[0]?.readList.length).toBeGreaterThan(0);
    expect(file.settingsVersions.map((settings) => [settings.version, settings.dataChoices.keepChatHistory])).toEqual([
      [1, false],
      [2, true],
    ]);
    expect(file.rules.map((rule) => [rule.kind, rule.versions.map((version) => [version.version, version.on])])).toEqual([
      ["buffer", [[1, true], [2, false]]],
      ["payment_limit", [[1, true], [2, false]]],
    ]);
    expect(file.rules[0]?.versions[0]?.parameters).toMatchObject({ bufferCents: 1_500_00 });
    expect(file.goals).toEqual([
      { accountId: file.plinthAccounts[1]?.id, accountName: "House fund", goal: "buy_home", targetCents: 60_000_00, balanceCents: 12_400_00 },
    ]);
    expect(file.accessLog[0]).toMatchObject({ who: "customer" });
  });

  it("keeps money as integer cents in fields ending Cents, times as ISO 8601 in UTC, and names Sam once, at the top", async () => {
    const bank = createBank({ db: openTestDatabase(), clock: fixedClock(SAM_PAYDAY_9AM) });
    const sam = await samWithDataEverywhere(bank);
    // Ask first turns the paycheck's sweep into a Finding with a Move Option, which names an amount.
    bank.changeSettings(sam, { autonomyLevel: "ask_first" });
    for (const rule of bank.customerData.listRules(sam)) bank.switchRule(sam, rule.id, true);
    bank.postPaycheck();

    const text = JSON.stringify(bank.buildExport(sam));
    const keys = keysIn(JSON.parse(text));

    expect(keys.some(([key, value]) => key === "options" && JSON.stringify(value).includes('"move"'))).toBe(true);
    // The only numbers that aren't money are ids and version numbers.
    const numbersNotCents = keys.filter(([key, value]) => typeof value === "number" && !key.endsWith("Cents"));
    expect(numbersNotCents.filter(([key]) => !(key === "id" || key === "version" || key.endsWith("Id")))).toEqual([]);
    for (const [, value] of keys.filter(([key]) => key.endsWith("Cents"))) {
      if (value !== null) expect(Number.isInteger(value)).toBe(true);
    }
    const times = keys.filter(([key]) => key === "at" || key.endsWith("At"));
    expect(times.length).toBeGreaterThan(0);
    for (const [, value] of times) {
      if (value !== null) expect(value).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    }
    expect(text.split("Sam")).toHaveLength(2);
    expect(Object.keys(JSON.parse(text))[0]).toBe("customer");
  });

  it("holds only Sam's data in Sam's file and only Priya's in Priya's, when both have linked, synced and exported", async () => {
    const bank = openTestBank();
    const sam = signInByName(bank, "Sam Calloway");
    const priya = signInByName(bank, "Priya Natarajan");
    for (const customer of [sam, priya]) {
      bank.linkAccount(customer, "harbor-credit-union");
      await bank.startMission(customer, "What's my Usual month?").ended;
    }
    bank.advanceClock();
    bank.buildExport(priya);

    const samFile = bank.buildExport(sam);
    const priyaFile = bank.buildExport(priya);

    expect(samFile.customer.name).toBe("Sam Calloway");
    expect(priyaFile.customer.name).toBe("Priya Natarajan");
    const samText = JSON.stringify(samFile);
    const priyaText = JSON.stringify(priyaFile);
    expect(samText).not.toContain("Priya");
    expect(priyaText).not.toContain("Sam");
    const samIds = idsIn(samFile);
    const priyaIds = idsIn(priyaFile);
    for (const [section, ids] of Object.entries(priyaIds)) {
      expect(ids.length, `Priya has ${section}`).toBeGreaterThan(0);
      expect(samIds[section]?.filter((id) => ids.includes(id)), section).toEqual([]);
    }
    // Nested ids too: none of Priya's own accounts, ledger transactions, Missions or Findings is named anywhere in Sam's file.
    const priyaIdsNamedBy: Record<string, number[]> = {
      accountId: priyaIds.plinthAccounts!,
      fromAccountId: priyaIds.plinthAccounts!,
      toAccountId: priyaIds.plinthAccounts!,
      ledgerTransactionId: priyaIds.ledgerTransactions!,
      missionId: priyaIds.missions!,
      findingId: priyaIds.findings!,
    };
    const samNestedIds = keysIn(samFile).filter(([key]) => key in priyaIdsNamedBy);
    expect(samNestedIds.length).toBeGreaterThan(0);
    expect(samNestedIds.filter(([key, value]) => priyaIdsNamedBy[key]?.includes(value as number))).toEqual([]);
    // Figures: no balance of Priya's Plinth accounts appears as an amount in Sam's file, and the reverse.
    const amountsIn = (file: CustomerExport) =>
      new Set(keysIn(file).filter(([key]) => key.endsWith("Cents")).map(([, value]) => value));
    const samAmounts = amountsIn(samFile);
    const priyaAmounts = amountsIn(priyaFile);
    expect(priyaFile.plinthAccounts.map((account) => account.balanceCents).filter((balance) => samAmounts.has(balance))).toEqual([]);
    expect(samFile.plinthAccounts.map((account) => account.balanceCents).filter((balance) => priyaAmounts.has(balance))).toEqual([]);
    expect(samFile.plinthAccounts.map((account) => account.balanceCents)).toEqual(
      bank.customerData.listAccounts(sam).map((account) => account.balance),
    );
    expect(priyaFile.plinthAccounts.map((account) => account.balanceCents)).toEqual(
      bank.customerData.listAccounts(priya).map((account) => account.balance),
    );
    expect(priyaFile.linkedAccounts.map((linked) => linked.institution)).toEqual(["Harbor Credit Union"]);
    expect(samFile.accessLog.filter((entry) => entry.who === "customer")).toHaveLength(1);
    expect(priyaFile.accessLog.filter((entry) => entry.who === "customer")).toHaveLength(2);
    expect(priyaFile.accessLog.filter((entry) => entry.who === "plinth")).toHaveLength(2);
  });
});
