import { describe, expect, it } from "vitest";
import { createBank, type Bank } from "./bank";
import { localDate } from "./calendar";
import { fixedClock } from "./clock";
import type { Customer } from "./customer-data";
import { openTestDatabase } from "./db/database";
import { cents } from "./money";
import { agentEntriesIn, openTestBank, signInByName } from "./test-bank";

/** Friday 20 November 2026, 9am in New York: Acme Corp's first payday, when Sam's sweep would be $340. */
const FIRST_PAYDAY_9AM = new Date("2026-11-20T14:00:00Z");

function bankAt(at: Date): Bank {
  return createBank({ db: openTestDatabase(), clock: fixedClock(at) });
}

function balancesOf(bank: Bank, customer: Customer) {
  const [checking, savings] = bank.customerData.listAccounts(customer);
  return { checking: checking?.balance, savings: savings?.balance };
}

describe("The Autonomy level and the sweep", () => {
  it("with ask_first, makes an open sweep Finding with Move and Leave it Options and moves nothing", () => {
    const bank = bankAt(FIRST_PAYDAY_9AM);
    const sam = signInByName(bank, "Sam Calloway");
    bank.changeSettings(sam, { autonomyLevel: "ask_first" });
    const [checking, houseFund] = bank.customerData.listAccounts(sam);
    const paycheckEvents: number[] = [];
    bank.ledgerEvents.subscribe((event) => paycheckEvents.push(event.id));

    bank.postPaycheck();

    expect(balancesOf(bank, sam)).toEqual({ checking: 3_467_00, savings: 12_400_00 });
    expect(agentEntriesIn(bank, sam)).toEqual([]);
    const [finding, ...others] = bank.readFindings(sam);
    expect(others).toEqual([]);
    expect(finding).toMatchObject({
      kind: "sweep",
      state: "open",
      ledgerEventId: paycheckEvents[0],
      options: [
        { key: "move", amount: 340_00, fromAccountId: checking?.id, toAccountId: houseFund?.id },
        { key: "leave", accountId: checking?.id },
      ],
    });
    expect(finding?.facts).toContainEqual({ label: "Paycheck", value: "$3,240.00 from Acme Corp" });
  });

  it("with within_rules, sweeps alone and makes no Finding", () => {
    const bank = bankAt(FIRST_PAYDAY_9AM);
    const sam = signInByName(bank, "Sam Calloway");
    expect(bank.readSettings(sam)?.autonomyLevel).toBe("within_rules");

    bank.postPaycheck();

    expect(balancesOf(bank, sam)).toEqual({ checking: 3_127_00, savings: 12_740_00 });
    expect(bank.readFindings(sam)).toEqual([]);
  });

  it("with small_things, sweeps alone under and at the Payment limit, and makes a Finding over it", () => {
    for (const { limit, swept } of [
      { limit: 500_00, swept: true },
      { limit: 340_00, swept: true },
      { limit: 339_00, swept: false },
    ]) {
      const bank = bankAt(FIRST_PAYDAY_9AM);
      const sam = signInByName(bank, "Sam Calloway");
      bank.changeSettings(sam, { autonomyLevel: "small_things" });
      setPaymentLimit(bank, sam, limit);

      bank.postPaycheck();

      if (swept) {
        expect(balancesOf(bank, sam), `limit ${limit}`).toEqual({ checking: 3_127_00, savings: 12_740_00 });
        expect(bank.readFindings(sam), `limit ${limit}`).toEqual([]);
        expect(agentEntriesIn(bank, sam)[0]?.why).toContainEqual({
          label: "Checked by",
          value: "Guardrails passed: Pause, ownership, positive amount, Rule on, Buffer kept, Payment limit",
        });
      } else {
        expect(balancesOf(bank, sam), `limit ${limit}`).toEqual({ checking: 3_467_00, savings: 12_400_00 });
        const [finding] = bank.readFindings(sam);
        expect(finding?.options[0]).toMatchObject({ key: "move", amount: 340_00 });
        expect(finding?.facts).toContainEqual({
          label: "Why your agent is asking",
          value: "$340.00 is over your $339.00 Payment limit",
        });
      }
    }
  });
});

function setPaymentLimit(bank: Bank, customer: Customer, limit: number): void {
  const rule = bank.customerData.listRules(customer).find((candidate) => candidate.kind === "payment_limit");
  if (!rule) throw new Error("The seeded payment limit Rule is missing");
  bank.setPaymentLimit(customer, rule.id, cents(limit));
}

/** Sam on payday with "Ask me before everything", after the paycheck made a $340 sweep Finding. */
function samAskedAboutSweep(): { bank: Bank; sam: Customer; findingId: number } {
  const bank = bankAt(FIRST_PAYDAY_9AM);
  const sam = signInByName(bank, "Sam Calloway");
  bank.changeSettings(sam, { autonomyLevel: "ask_first" });
  bank.postPaycheck();
  const [finding] = bank.readFindings(sam);
  if (!finding) throw new Error("The paycheck made no Finding");
  return { bank, sam, findingId: finding.id };
}

describe("Picking an Option on a sweep Finding", () => {
  it("Move posts the sweep with key finding:<id> and writes a Done entry triggered by the customer's choice", () => {
    const { bank, sam, findingId } = samAskedAboutSweep();
    const [checking, houseFund] = bank.customerData.listAccounts(sam);

    const outcome = bank.chooseOption(sam, findingId, "move");

    expect(outcome).toMatchObject({ ok: true });
    expect(balancesOf(bank, sam)).toEqual({ checking: 3_127_00, savings: 12_740_00 });
    const posted = bank.customerData.findLedgerTransaction(sam, `finding:${findingId}`);
    expect(posted?.entries).toEqual([
      { accountId: checking?.id, amount: -340_00 },
      { accountId: houseFund?.id, amount: 340_00 },
    ]);
    const [done, ...others] = agentEntriesIn(bank, sam);
    expect(others).toEqual([]);
    expect(done).toMatchObject({
      action: "Moved $340 to House fund",
      result: "Done",
      trigger: { description: "You chose this Option" },
      ledgerTransactionId: posted?.id,
      amount: 340_00,
    });
    expect(bank.readFindings(sam)).toEqual([expect.objectContaining({ state: "chosen", chosenOption: "move" })]);
  });

  it("Move picked twice moves money once", () => {
    const { bank, sam, findingId } = samAskedAboutSweep();

    bank.chooseOption(sam, findingId, "move");
    const again = bank.chooseOption(sam, findingId, "move");

    expect(again).toMatchObject({ ok: false });
    expect(balancesOf(bank, sam)).toEqual({ checking: 3_127_00, savings: 12_740_00 });
    expect(agentEntriesIn(bank, sam)).toHaveLength(1);
  });

  it("Move after a card purchase drains checking is refused by the Buffer kept guardrail, moves nothing, and shows why on the Finding", () => {
    const { bank, sam, findingId } = samAskedAboutSweep();
    const [checking] = bank.customerData.listAccounts(sam);
    if (!checking) throw new Error("Sam's Checking is missing");
    bank.cardPurchase(sam, { accountId: checking.id, amount: cents(100_00), idempotencyKey: "card:groceries" });

    const outcome = bank.chooseOption(sam, findingId, "move");

    const reason = "checking would fall below the $1,500.00 Buffer plus $1,627.00 of bills";
    expect(outcome).toMatchObject({ ok: false, reason });
    expect(balancesOf(bank, sam)).toEqual({ checking: 3_367_00, savings: 12_400_00 });
    expect(bank.customerData.findLedgerTransaction(sam, `finding:${findingId}`)).toBeUndefined();
    expect(agentEntriesIn(bank, sam)).toEqual([
      expect.objectContaining({
        action: "Move $340 to House fund",
        result: "Refused",
        refusedBy: "Buffer kept",
        trigger: expect.objectContaining({ description: "You chose this Option" }),
      }),
    ]);
    expect(bank.readFindings(sam)).toEqual([
      expect.objectContaining({ state: "open", refusal: { guardrail: "Buffer kept", reason } }),
    ]);
  });

  it("Leave it moves nothing and writes a Decision log entry with the customer as actor", () => {
    const { bank, sam, findingId } = samAskedAboutSweep();

    const outcome = bank.chooseOption(sam, findingId, "leave");

    expect(outcome).toMatchObject({ ok: true });
    expect(balancesOf(bank, sam)).toEqual({ checking: 3_467_00, savings: 12_400_00 });
    expect(bank.readDecisionLog(sam)[0]).toMatchObject({
      actor: "customer",
      action: "Left the money in Checking",
      result: "Done",
      amount: 0,
      ledgerTransactionId: null,
      trigger: { description: "You chose this Option" },
    });
    expect(bank.readFindings(sam)).toEqual([expect.objectContaining({ state: "chosen", chosenOption: "leave" })]);
    expect(bank.chooseOption(sam, findingId, "move")).toMatchObject({ ok: false });
    expect(balancesOf(bank, sam)).toEqual({ checking: 3_467_00, savings: 12_400_00 });
  });

  it("Undo moves the money from a picked Move back to Checking", () => {
    const { bank, sam, findingId } = samAskedAboutSweep();
    const picked = bank.chooseOption(sam, findingId, "move");
    if (!picked.ok) throw new Error(picked.reason);

    const undone = bank.undo(sam, picked.decision.id);

    expect(undone).toMatchObject({ ok: true, reversal: { action: "Moved $340 back to Checking", result: "Reversed" } });
    expect(balancesOf(bank, sam)).toEqual({ checking: 3_467_00, savings: 12_400_00 });
  });
});

describe("Sweep Findings over time", () => {
  it("a new paycheck expires the open sweep Finding before making a new one", () => {
    const bank = openTestBank();
    const sam = signInByName(bank, "Sam Calloway");
    bank.changeSettings(sam, { autonomyLevel: "ask_first" });
    // The clock starts on Thursday 19 November: the next day is payday, and Acme Corp pays every 14 days.
    bank.advanceClock();
    const [first] = bank.readFindings(sam);

    for (let day = 0; day < 14; day++) bank.advanceClock();

    const [newest, expired, ...others] = bank.readFindings(sam);
    expect(others).toEqual([]);
    expect(newest).toMatchObject({ state: "open" });
    expect(newest?.ledgerEventId).not.toBe(first?.ledgerEventId);
    expect(expired).toMatchObject({ id: first?.id, state: "expired" });
    expect(bank.chooseOption(sam, expired?.id ?? 0, "move")).toMatchObject({ ok: false });
  });

  it("while paused, a paycheck writes Refused agent_paused, makes no Finding and moves nothing", () => {
    const bank = bankAt(FIRST_PAYDAY_9AM);
    const sam = signInByName(bank, "Sam Calloway");
    bank.changeSettings(sam, { autonomyLevel: "ask_first" });
    bank.setAgentPaused(sam, true);

    bank.postPaycheck();

    expect(bank.readFindings(sam)).toEqual([]);
    expect(balancesOf(bank, sam)).toEqual({ checking: 3_467_00, savings: 12_400_00 });
    expect(agentEntriesIn(bank, sam)).toEqual([
      expect.objectContaining({ result: "Refused", refusedBy: "agent_paused" }),
    ]);
  });

  it("Priya can't see or pick Sam's Findings", () => {
    const { bank, sam, findingId } = samAskedAboutSweep();
    const priya = signInByName(bank, "Priya Natarajan");

    expect(bank.readFindings(priya)).toEqual([]);
    expect(bank.chooseOption(priya, findingId, "move")).toEqual({
      ok: false,
      reason: "There is no such Finding.",
      finding: undefined,
    });
    expect(balancesOf(bank, sam)).toEqual({ checking: 3_467_00, savings: 12_400_00 });
    expect(bank.readFindings(sam)).toEqual([expect.objectContaining({ state: "open" })]);
  });

  it("Home shows open Findings first, then chosen and expired ones", () => {
    const bank = openTestBank();
    const sam = signInByName(bank, "Sam Calloway");
    bank.changeSettings(sam, { autonomyLevel: "ask_first" });
    bank.advanceClock();
    const [first] = bank.readFindings(sam);
    bank.chooseOption(sam, first?.id ?? 0, "leave");
    for (let day = 0; day < 14; day++) bank.advanceClock();

    expect(bank.readHome(sam).findings.map((finding) => finding.state)).toEqual(["open", "chosen"]);
  });

  it("for a customer with no settings record, who hasn't finished setup, a paycheck makes no Finding and moves nothing", () => {
    const bank = bankAt(FIRST_PAYDAY_9AM);
    const newcomer = bank.systemData.createCustomer("Jordan Fielding");
    const checking = bank.customerData.openAccount(newcomer, { kind: "checking", name: "Checking" });
    const savings = bank.customerData.openAccount(newcomer, { kind: "savings", name: "Rainy day fund" });
    bank.customerData.addPayroll(newcomer, {
      accountId: checking.id,
      employer: "acme-corp",
      amount: cents(2_000_00),
      firstPayDate: localDate("2026-11-20"),
      intervalDays: 14,
    });
    bank.customerData.createRule(newcomer, {
      kind: "buffer",
      parameters: { checkingAccountId: checking.id, savingsAccountId: savings.id, buffer: cents(500_00) },
      on: true,
    });

    bank.postPaycheck();

    expect(bank.readFindings(newcomer)).toEqual([]);
    expect(bank.readDecisionLog(newcomer)).toEqual([]);
    expect(balancesOf(bank, newcomer)).toEqual({ checking: 2_000_00, savings: 0 });
  });

  it("a Finding isn't a refusal: under ask_first its facts give the reason and name no guardrail", () => {
    const { bank, sam } = samAskedAboutSweep();

    const [finding] = bank.readFindings(sam);

    expect(finding?.facts).toContainEqual({
      label: "Why your agent is asking",
      value: "You asked your agent to ask you before everything",
    });
    expect(JSON.stringify(finding?.facts)).not.toMatch(/guardrail/i);
    expect(finding?.refusal).toBeNull();
  });
});

describe("Picking Move while the agent is paused", () => {
  it("moves the money, since Pause stops only automatic actions, and lists only the guardrails that ran", () => {
    const { bank, sam, findingId } = samAskedAboutSweep();
    bank.setAgentPaused(sam, true);

    const outcome = bank.chooseOption(sam, findingId, "move");

    expect(outcome).toMatchObject({ ok: true });
    expect(balancesOf(bank, sam)).toEqual({ checking: 3_127_00, savings: 12_740_00 });
    const [done] = agentEntriesIn(bank, sam);
    expect(done?.why).toContainEqual({
      label: "Checked by",
      value: "Guardrails passed: ownership, positive amount, Rule on, Buffer kept",
    });
  });
});
