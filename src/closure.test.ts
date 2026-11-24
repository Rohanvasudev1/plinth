import { describe, expect, it } from "vitest";
import { ClosedCustomerError, type Bank } from "./bank";
import type { Customer } from "./customer-data";
import { FAKE_TEST_QUESTIONS } from "./fake-mission-model";
import { ClosureError } from "./closure";
import { MissionError } from "./missions";
import { cents } from "./money";
import { CardDeclinedError } from "./simulator";
import { openTestBank, signInByName } from "./test-bank";

/**
 * Sam with the most to delete: a reported Mission with its Finding, a running Mission, a snoozed Finding and the
 * seeded open Findings, settings, a Goal target and three Linked accounts.
 */
async function samWithEverything(bank: Bank): Promise<Customer> {
  const sam = signInByName(bank, "Sam Calloway");
  const reported = await bank.startMission(sam, "What's my Usual month?").ended;
  expect(reported.state).toBe("reported");
  const toSnooze = bank.readFindings(sam).find((finding) => finding.options.some((option) => option.key === "remind_me"));
  if (!toSnooze) throw new Error("Sam has no Finding to snooze");
  bank.chooseOption(sam, toSnooze.id, "remind_me");
  bank.startMission(sam, FAKE_TEST_QUESTIONS.runLong);
  return sam;
}

/** The sum of every Plinth account balance the customer holds. */
function plinthTotal(bank: Bank, customer: Customer): number {
  return bank.customerData.listAccounts(customer).reduce((sum, account) => sum + account.balance, 0);
}

describe("Close and delete", () => {
  it("pays out Sam's Plinth balances as one ledger transaction under closure:<id> that sums to zero, leaving every balance at zero", () => {
    const bank = openTestBank();
    const sam = signInByName(bank, "Sam Calloway");
    expect(bank.readClosureSummary(sam).payout).toBe(12_627_00);

    const closed = bank.closeAndDelete(sam);

    expect(closed.payout).toBe(12_627_00);
    for (const account of bank.customerData.listAccounts(sam)) expect(account.balance).toBe(0);
    const payout = bank.customerData.findLedgerTransaction(sam, `closure:${sam.id}`);
    expect(payout?.entries.reduce((sum, entry) => sum + entry.amount, 0)).toBe(0);
    expect(payout?.entries.filter((entry) => entry.amount < 0)).toEqual([
      expect.objectContaining({ amount: -227_00 }),
      expect.objectContaining({ amount: -12_400_00 }),
    ]);
    const clearing = bank.systemData.ensureSystemAccount("accountClosure");
    expect(payout?.entries.filter((entry) => entry.accountId === clearing).map((entry) => entry.amount)).toEqual([
      227_00, 12_400_00,
    ]);
    expect(plinthTotal(bank, sam)).toBe(0);
  });

  it("stops Sam's running Mission and deletes his Missions, Findings, settings, Goal targets and Linked accounts", async () => {
    const bank = openTestBank();
    const sam = await samWithEverything(bank);
    const running = bank.customerData.listMissions(sam).find((mission) => mission.state === "running");
    expect(running).toBeDefined();
    expect(bank.readFindings(sam).map((finding) => finding.state)).toEqual(expect.arrayContaining(["open", "snoozed"]));

    bank.closeAndDelete(sam);

    expect(bank.customerData.listMissions(sam)).toEqual([]);
    expect(bank.readFindings(sam)).toEqual([]);
    expect(bank.readSettings(sam)).toBeUndefined();
    expect(bank.customerData.listAccounts(sam).map((account) => account.goalTarget)).toEqual([null, null]);
    expect(bank.customerData.listLinkedAccounts(sam)).toEqual([]);
    const log = bank.readDecisionLog(sam);
    const stopped = log.find((entry) => entry.result === "Stopped");
    expect(stopped?.action).toContain(FAKE_TEST_QUESTIONS.runLong);
    expect(log.filter((entry) => entry.action.startsWith("Unlinked "))).toHaveLength(3);
  });

  it("keeps the Ledger, the Decision log with its text but no links to deleted rows, the Rules and the access log", async () => {
    const bank = openTestBank();
    const sam = await samWithEverything(bank);
    const ledgerBefore = bank.customerData.listLedgerTransactions(sam);
    const logBefore = bank.readDecisionLog(sam);
    const accessBefore = bank.readPrivacy(sam).accessLog;
    const rulesBefore = bank.customerData.listRules(sam);
    expect(logBefore.some((entry) => entry.missionId !== null && entry.findingId !== null)).toBe(true);

    bank.closeAndDelete(sam);

    expect(bank.customerData.listLedgerTransactions(sam).slice(0, ledgerBefore.length)).toEqual(ledgerBefore);
    expect(bank.customerData.listLedgerTransactions(sam)).toHaveLength(ledgerBefore.length + 1);
    const logAfter = bank.readDecisionLog(sam);
    for (const entry of logBefore) {
      expect(logAfter.find((after) => after.id === entry.id)).toEqual({ ...entry, missionId: null, findingId: null });
    }
    expect(bank.customerData.listRules(sam)).toEqual(rulesBefore);
    const accessAfter = bank.readPrivacy(sam).accessLog;
    expect(accessAfter.slice(-accessBefore.length)).toEqual(accessBefore);
    // One for the stopped Mission and one for each of the three Linked accounts unlinked.
    const added = accessAfter.slice(0, accessAfter.length - accessBefore.length);
    expect(added.map((entry) => entry.who).sort()).toEqual(["agent", "plinth", "plinth", "plinth"]);
    expect(added.filter((entry) => entry.who === "plinth").map((entry) => entry.why)).toEqual(
      Array(3).fill("You closed your Plinth account, so Plinth deleted its copy of that data"),
    );
  });

  it("writes \"Closed your Plinth account\" with the payout as the last Decision log entry, and refuses closing twice", () => {
    const bank = openTestBank();
    const sam = signInByName(bank, "Sam Calloway");

    bank.closeAndDelete(sam);

    const [latest] = bank.readDecisionLog(sam);
    expect(latest).toMatchObject({ actor: "customer", action: "Closed your Plinth account", amount: 12_627_00, result: "Done" });
    expect(latest?.why).toContainEqual({ label: "Payout", value: "$12,627.00 paid out to you" });
    const ledgerCount = bank.customerData.listLedgerTransactions(sam).length;
    const logCount = bank.readDecisionLog(sam).length;
    expect(() => bank.closeAndDelete(sam)).toThrow(ClosureError);
    expect(bank.customerData.listLedgerTransactions(sam)).toHaveLength(ledgerCount);
    expect(bank.readDecisionLog(sam)).toHaveLength(logCount);
  });

  it("keeps a Closed customer on Sign in as but refuses to sign them in", () => {
    const bank = openTestBank();
    const sam = signInByName(bank, "Sam Calloway");

    bank.closeAndDelete(sam);

    expect(bank.listCustomers().map((customer) => customer.name)).toContain("Sam Calloway");
    expect(bank.isClosed(sam)).toBe(true);
    expect(() => bank.signIn(sam.id)).toThrow(ClosedCustomerError);
    expect(() => bank.signIn(sam.id)).toThrow("This account is closed");
  });

  it("shows Alex a $400.00 payout, and closes Alex, who has no settings, Linked accounts or Missions", () => {
    const bank = openTestBank();
    const alex = signInByName(bank, "Alex Okafor");
    const accessBefore = bank.readPrivacy(alex).accessLog;

    expect(bank.readClosureSummary(alex).payout).toBe(400_00);
    expect(bank.closeAndDelete(alex).payout).toBe(400_00);

    expect(plinthTotal(bank, alex)).toBe(0);
    expect(bank.readPrivacy(alex).accessLog).toEqual(accessBefore);
    expect(bank.readClosureSummary(alex).payout).toBe(0);
  });

  it("posts no paychecks, bills or Card purchases for a Closed customer, runs no Sync, and starts no Mission", () => {
    const bank = openTestBank();
    const sam = signInByName(bank, "Sam Calloway");
    const [checking] = bank.customerData.listAccounts(sam);
    if (!checking) throw new Error("Sam has no checking account");
    bank.closeAndDelete(sam);
    const ledgerCount = bank.customerData.listLedgerTransactions(sam).length;
    const accessCount = bank.readPrivacy(sam).accessLog.length;
    const logCount = bank.readDecisionLog(sam).length;

    // 20 Nov is Sam's payday and 1-3 Dec his bills' due dates.
    for (let day = 0; day < 15; day += 1) bank.advanceClock();

    expect(() =>
      bank.cardPurchase(sam, { accountId: checking.id, merchant: "tunewell-streaming", amount: cents(1_00), idempotencyKey: "closed" }),
    ).toThrow(CardDeclinedError);
    expect(() => bank.startMission(sam, "What's my Usual month?")).toThrow(MissionError);
    expect(bank.customerData.listLedgerTransactions(sam)).toHaveLength(ledgerCount);
    expect(bank.readPrivacy(sam).accessLog).toHaveLength(accessCount);
    expect(bank.readDecisionLog(sam)).toHaveLength(logCount);
    expect(bank.customerData.listMissions(sam)).toEqual([]);
    expect(bank.readFindings(sam)).toEqual([]);
  });

  it("runs no agent or Standing search for a Closed customer even when a ledger event of theirs posts", () => {
    const bank = openTestBank();
    const sam = signInByName(bank, "Sam Calloway");
    const [checking] = bank.customerData.listAccounts(sam);
    if (!checking) throw new Error("Sam has no checking account");
    bank.closeAndDelete(sam);
    const accessCount = bank.readPrivacy(sam).accessLog.length;
    const logCount = bank.readDecisionLog(sam).length;

    // A paycheck and a Card purchase reaching the ledger anyway, past the Simulator's checks.
    bank.customerData.postLedgerTransaction(sam, {
      idempotencyKey: "payroll:acme-corp:2026-11-20",
      description: "Paycheck from Acme Corp",
      entries: [
        { accountId: bank.systemData.ensureSystemAccount("acmePayroll"), amount: cents(-3_240_00) },
        { accountId: checking.id, amount: cents(3_240_00) },
      ],
    });
    bank.customerData.postLedgerTransaction(sam, {
      idempotencyKey: "card:closed",
      description: "Card purchase at Tunewell Streaming",
      counterparty: "Tunewell Streaming",
      category: "Subscriptions",
      entries: [
        { accountId: checking.id, amount: cents(-25_00) },
        { accountId: bank.systemData.ensureSystemAccount("merchant"), amount: cents(25_00) },
      ],
    });

    expect(bank.readPrivacy(sam).accessLog).toHaveLength(accessCount);
    expect(bank.readDecisionLog(sam)).toHaveLength(logCount);
    expect(bank.readFindings(sam)).toEqual([]);
  });

  it("leaves Priya's balances, Linked accounts, Findings and access log unchanged and readable when Sam closes", async () => {
    const bank = openTestBank();
    const sam = await samWithEverything(bank);
    const priya = signInByName(bank, "Priya Natarajan");
    bank.linkAccount(priya, "harbor-credit-union");
    const priyasMission = await bank.startMission(priya, "What's my Usual month?").ended;
    const before = {
      accounts: bank.customerData.listAccounts(priya),
      linked: bank.customerData.listLinkedAccounts(priya),
      findings: bank.readFindings(priya),
      access: bank.readPrivacy(priya).accessLog,
      log: bank.readDecisionLog(priya),
      settings: bank.readSettings(priya),
    };
    expect(before.linked).toHaveLength(1);
    expect(before.findings.some((finding) => finding.missionId === priyasMission.id)).toBe(true);

    bank.closeAndDelete(sam);

    expect(bank.isClosed(priya)).toBe(false);
    expect(bank.signIn(priya.id)).toEqual(priya);
    expect(bank.customerData.listAccounts(priya)).toEqual(before.accounts);
    expect(bank.customerData.listLinkedAccounts(priya)).toEqual(before.linked);
    expect(bank.readFindings(priya)).toEqual(before.findings);
    expect(bank.readPrivacy(priya).accessLog).toEqual(before.access);
    expect(bank.readDecisionLog(priya)).toEqual(before.log);
    expect(bank.readSettings(priya)).toEqual(before.settings);
    // Sam's closure entries are his own: none of Priya's views holds them.
    expect(bank.readPrivacy(sam).accessLog.every((entry) => !before.access.some((own) => own.id === entry.id))).toBe(true);
    // Priya's Sync still runs on the next advance.
    bank.advanceClock();
    expect(bank.readPrivacy(priya).accessLog.length).toBeGreaterThan(before.access.length);
  });
});
