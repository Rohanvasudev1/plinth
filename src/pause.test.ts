import { describe, expect, it } from "vitest";
import { createBank, type Bank } from "./bank";
import { fixedClock } from "./clock";
import type { Customer } from "./customer-data";
import { openTestDatabase } from "./db/database";
import { agentEntriesIn, openTestBank, signInByName } from "./test-bank";

/** Friday 20 November 2026, 9am in New York: Acme Corp's first payday. */
const FIRST_PAYDAY_9AM = new Date("2026-11-20T14:00:00Z");

function bankAt(at: Date): Bank {
  return createBank({ db: openTestDatabase(), clock: fixedClock(at) });
}

function balancesOf(bank: Bank, customer: Customer) {
  const [checking, savings] = bank.customerData.listAccounts(customer);
  return { checking: checking?.balance, savings: savings?.balance };
}

describe("Pause", () => {
  it("writes a Decision log entry with the customer as actor when the customer pauses and unpauses", () => {
    const bank = bankAt(FIRST_PAYDAY_9AM);
    const sam = signInByName(bank, "Sam Calloway");

    bank.setAgentPaused(sam, true);
    expect(bank.isAgentPaused(sam)).toBe(true);
    bank.setAgentPaused(sam, false);
    expect(bank.isAgentPaused(sam)).toBe(false);

    const [unpaused, paused] = bank.readDecisionLog(sam);
    expect(paused).toMatchObject({ actor: "customer", action: "Paused your agent", result: "Done", amount: 0 });
    expect(unpaused).toMatchObject({ actor: "customer", action: "Unpaused your agent", result: "Done", amount: 0 });
  });

  it("refuses the sweep with the agent_paused guardrail and moves nothing when a paycheck lands while paused", () => {
    const bank = bankAt(FIRST_PAYDAY_9AM);
    const sam = signInByName(bank, "Sam Calloway");
    bank.setAgentPaused(sam, true);

    bank.postPaycheck();

    // The $3,467 paycheck lands in Checking and stays there: nothing goes to the House fund.
    expect(balancesOf(bank, sam)).toEqual({ checking: 3_467_00, savings: 12_400_00 });
    const [entry] = agentEntriesIn(bank, sam);
    expect(entry).toMatchObject({
      result: "Refused",
      refusedBy: "agent_paused",
      ledgerTransactionId: null,
      trigger: { description: "Paycheck from Acme Corp" },
    });
    expect(entry?.why).toContainEqual({
      label: "Checked by",
      value: "Refused by the Pause guardrail: Agent paused until you unpause it",
    });
  });

  it("doesn't rerun the sweep missed while paused when the customer unpauses", () => {
    const bank = bankAt(FIRST_PAYDAY_9AM);
    const sam = signInByName(bank, "Sam Calloway");
    bank.setAgentPaused(sam, true);
    bank.postPaycheck();

    bank.setAgentPaused(sam, false);

    expect(balancesOf(bank, sam)).toEqual({ checking: 3_467_00, savings: 12_400_00 });
    expect(agentEntriesIn(bank, sam).map((entry) => entry.result)).toEqual(["Refused"]);
  });

  it("sweeps again on the first paycheck after the customer unpauses", () => {
    const bank = openTestBank();
    const sam = signInByName(bank, "Sam Calloway");
    bank.setAgentPaused(sam, true);
    bank.advanceClock();
    bank.setAgentPaused(sam, false);

    // Acme Corp pays every 14 days: on to the next payday.
    for (let day = 0; day < 14; day++) bank.advanceClock();

    expect(agentEntriesIn(bank, sam).map((entry) => entry.result)).toEqual(["Done", "Refused"]);
  });

  it("Priya pausing her agent doesn't pause Sam's", () => {
    const bank = bankAt(FIRST_PAYDAY_9AM);
    const sam = signInByName(bank, "Sam Calloway");
    const priya = signInByName(bank, "Priya Natarajan");

    bank.setAgentPaused(priya, true);
    bank.postPaycheck();

    expect(bank.isAgentPaused(sam)).toBe(false);
    expect(bank.readDecisionLog(sam).map((entry) => entry.action)).toEqual(["Moved $340 to House fund"]);
    expect(balancesOf(bank, sam)).toEqual({ checking: 3_127_00, savings: 12_740_00 });
  });

  it("shows on Home whether the agent is paused", () => {
    const bank = openTestBank();
    const sam = signInByName(bank, "Sam Calloway");
    expect(bank.readHome(sam).agentPaused).toBe(false);

    bank.setAgentPaused(sam, true);

    expect(bank.readHome(sam).agentPaused).toBe(true);
  });

  it("writes no entry when the customer asks for the state the agent is already in", () => {
    const bank = openTestBank();
    const sam = signInByName(bank, "Sam Calloway");
    bank.setAgentPaused(sam, true);

    bank.setAgentPaused(sam, true);

    expect(bank.readDecisionLog(sam).map((entry) => entry.action)).toEqual(["Paused your agent"]);
  });
});
