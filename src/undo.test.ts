import { describe, expect, it } from "vitest";
import { createBank, type Bank } from "./bank";
import { fixedClock } from "./clock";
import type { Customer } from "./customer-data";
import { openTestDatabase } from "./db/database";
import { cents } from "./money";
import { signInByName } from "./test-bank";

/** Friday 20 November 2026, 9am in New York: Acme Corp's first payday, which sweeps Sam $340. */
const FIRST_PAYDAY_9AM = new Date("2026-11-20T14:00:00Z");

function bankOnPayday(): Bank {
  return createBank({ db: openTestDatabase(), clock: fixedClock(FIRST_PAYDAY_9AM) });
}

function balancesOf(bank: Bank, customer: Customer) {
  const [checking, savings] = bank.customerData.listAccounts(customer);
  return { checking: checking?.balance, savings: savings?.balance };
}

/** Sam after the paycheck swept $340 to the House fund, with the id of the sweep's entry. */
function samAfterTheSweep(bank: Bank): { sam: Customer; sweepDecisionId: number } {
  const sam = signInByName(bank, "Sam Calloway");
  bank.postPaycheck();
  const [sweep] = bank.readAgentActions(sam);
  if (!sweep) throw new Error("The sweep wasn't logged");
  return { sam, sweepDecisionId: sweep.decisionId };
}

describe("Undo", () => {
  it("posts the opposite transfer under undo:<decision id> and writes a Reversed entry linked to the original", () => {
    const bank = bankOnPayday();
    const { sam, sweepDecisionId } = samAfterTheSweep(bank);
    const [checking, houseFund] = bank.customerData.listAccounts(sam);

    const result = bank.undo(sam, sweepDecisionId);

    expect(result.ok).toBe(true);
    expect(balancesOf(bank, sam)).toEqual({ checking: 3_467_00, savings: 12_400_00 });
    const reversal = bank.customerData.findLedgerTransaction(sam, `undo:${sweepDecisionId}`);
    expect(reversal?.entries).toEqual([
      { accountId: houseFund?.id, amount: -340_00 },
      { accountId: checking?.id, amount: 340_00 },
    ]);
    expect(bank.readDecisionLog(sam)).toEqual([
      expect.objectContaining({
        action: "Moved $340 back to Checking",
        result: "Reversed",
        fromAccountId: houseFund?.id,
        toAccountId: checking?.id,
        amount: 340_00,
        refusedBy: null,
        ledgerTransactionId: reversal?.id,
        reversesDecisionId: sweepDecisionId,
      }),
      // The original entry is left exactly as it was written.
      expect.objectContaining({ id: sweepDecisionId, result: "Done", reversesDecisionId: null }),
    ]);
  });

  it("explains itself: the Reversed entry's Why names the entry it reverses, the Rule and the checks", () => {
    const bank = bankOnPayday();
    const { sam, sweepDecisionId } = samAfterTheSweep(bank);

    const result = bank.undo(sam, sweepDecisionId);

    expect(result.ok && result.reversal.why).toEqual([
      { label: "Trigger", value: 'You pressed Undo on "Moved $340 to House fund"' },
      {
        label: "Undo of",
        value: `Decision log entry #${sweepDecisionId}, which moved the money the other way`,
      },
      { label: "Rule", value: "Buffer Rule v1: keep $1,500 in Checking, move the rest to House fund" },
      {
        label: "Checked by",
        value:
          "Undo checks passed: your own agent action, not already undone, House fund still held $340.00 to move back to Checking",
      },
    ]);
  });

  it("refuses a second Undo of the same action, and moves nothing", () => {
    const bank = bankOnPayday();
    const { sam, sweepDecisionId } = samAfterTheSweep(bank);
    expect(bank.undo(sam, sweepDecisionId).ok).toBe(true);

    const again = bank.undo(sam, sweepDecisionId);

    expect(again).toEqual({ ok: false, reason: "you have already undone that action" });
    expect(balancesOf(bank, sam)).toEqual({ checking: 3_467_00, savings: 12_400_00 });
    expect(bank.readDecisionLog(sam)).toHaveLength(2);
  });

  it("refuses Undo with a reason when a card purchase has drained the House fund", () => {
    const bank = bankOnPayday();
    const { sam, sweepDecisionId } = samAfterTheSweep(bank);
    const [, houseFund] = bank.customerData.listAccounts(sam);
    if (!houseFund) throw new Error("Sam's House fund is missing");
    // The House fund held $12,740 after the sweep. Spending all but $339 leaves it short of the $340.
    bank.cardPurchase(sam, {
      accountId: houseFund.id,
      amount: cents(12_401_00),
      idempotencyKey: "card:sofa",
    });

    const result = bank.undo(sam, sweepDecisionId);

    expect(result).toEqual({
      ok: false,
      reason: "House fund no longer holds the $340.00 to move back",
    });
    expect(balancesOf(bank, sam)).toEqual({ checking: 3_127_00, savings: 339_00 });
    expect(bank.customerData.findLedgerTransaction(sam, `undo:${sweepDecisionId}`)).toBeUndefined();
    expect(bank.readDecisionLog(sam)).toHaveLength(1);
  });

  it("only the customer can Undo: another customer's action isn't theirs to reverse", () => {
    const bank = bankOnPayday();
    const { sam, sweepDecisionId } = samAfterTheSweep(bank);
    const priya = signInByName(bank, "Priya Natarajan");

    const result = bank.undo(priya, sweepDecisionId);

    expect(result).toEqual({ ok: false, reason: "that isn't one of your agent's actions" });
    expect(balancesOf(bank, sam)).toEqual({ checking: 3_127_00, savings: 12_740_00 });
    expect(bank.readDecisionLog(priya)).toEqual([]);
  });

  it("refuses Undo of a Refused entry, because no money moved", () => {
    // Priya's 25 Nov paycheck is refused: her Rule points at Sam's House fund.
    const bank = createBank({ db: openTestDatabase(), clock: fixedClock(new Date("2026-11-25T14:00:00Z")) });
    const sam = signInByName(bank, "Sam Calloway");
    const priya = signInByName(bank, "Priya Natarajan");
    const [, samsHouseFund] = bank.customerData.listAccounts(sam);
    const [seeded] = bank.customerData.listRules(priya);
    if (!samsHouseFund || !seeded) throw new Error("Seed data is missing");
    bank.customerData.switchRule(priya, seeded.id, false);
    bank.customerData.createRule(priya, {
      kind: "buffer",
      parameters: { ...seeded.parameters, savingsAccountId: samsHouseFund.id },
      on: true,
    });
    bank.postPaycheck();
    const [refusedAction] = bank.readAgentActions(priya);
    if (!refusedAction) throw new Error("The refused action wasn't logged");

    const result = bank.undo(priya, refusedAction.decisionId);

    expect(result).toEqual({ ok: false, reason: "your agent refused that action, so no money moved" });
    expect(refusedAction.canUndo).toBe(false);
  });

  it("refuses Undo of an Undo, which is not an action the agent took", () => {
    const bank = bankOnPayday();
    const { sam, sweepDecisionId } = samAfterTheSweep(bank);
    const undone = bank.undo(sam, sweepDecisionId);
    if (!undone.ok) throw new Error("The sweep wasn't undone");

    const result = bank.undo(sam, undone.reversal.id);

    expect(result).toEqual({ ok: false, reason: "that entry is an Undo, not an action your agent took" });
  });

  it("refuses an Undo of an entry that doesn't exist", () => {
    const bank = bankOnPayday();
    const sam = signInByName(bank, "Sam Calloway");

    expect(bank.undo(sam, 9999)).toEqual({ ok: false, reason: "that isn't one of your agent's actions" });
  });
});

describe("What your agent did", () => {
  it("lists the customer's agent actions with their state, newest first", () => {
    const bank = bankOnPayday();
    const { sam, sweepDecisionId } = samAfterTheSweep(bank);

    expect(bank.readAgentActions(sam)).toEqual([
      {
        decisionId: sweepDecisionId,
        at: FIRST_PAYDAY_9AM,
        action: "Moved $340 to House fund",
        state: "Done",
        amount: 340_00,
        why: expect.arrayContaining([
          { label: "Trigger", value: "Paycheck of $3,240.00 from Acme Corp posted" },
          {
            label: "Bills before payday",
            value: "$1,627.00 before payday on Fri 4 Dec: Rent $1,450, Internet $62, Phone $45, Power $70",
          },
          { label: "Rule", value: "Buffer Rule v1: keep $1,500 in Checking, move the rest to House fund" },
          { label: "Checked by", value: "Guardrails passed: ownership, positive amount, Rule on, Buffer kept" },
        ]),
        canUndo: true,
      },
    ]);
  });

  it("shows an undone action as Reversed with no Undo left, and doesn't list the Undo as an action", () => {
    const bank = bankOnPayday();
    const { sam, sweepDecisionId } = samAfterTheSweep(bank);

    bank.undo(sam, sweepDecisionId);

    expect(bank.readAgentActions(sam)).toEqual([
      expect.objectContaining({ decisionId: sweepDecisionId, state: "Reversed", canUndo: false }),
    ]);
    // The Decision log keeps the full record, including the Undo itself.
    expect(bank.readDecisionLog(sam).map((entry) => entry.result)).toEqual(["Reversed", "Done"]);
  });

  it("shows only the customer's own actions", () => {
    const bank = bankOnPayday();
    const { sam } = samAfterTheSweep(bank);
    const priya = signInByName(bank, "Priya Natarajan");

    expect(bank.readAgentActions(sam)).toHaveLength(1);
    expect(bank.readAgentActions(priya)).toEqual([]);
  });
});

describe("The unseen-action toast", () => {
  it("has the sweep to toast once, then nothing after Home has shown it", () => {
    const bank = bankOnPayday();
    const { sam, sweepDecisionId } = samAfterTheSweep(bank);

    expect(bank.readHome(sam).unseenActions).toEqual([
      expect.objectContaining({ decisionId: sweepDecisionId, action: "Moved $340 to House fund" }),
    ]);

    bank.markAgentActionsSeen(sam);

    expect(bank.readHome(sam).unseenActions).toEqual([]);
    // Marking them seen hides the toast without hiding the actions themselves.
    expect(bank.readHome(sam).agentActions).toHaveLength(1);
  });

  it("toasts the next paycheck's sweep, even though the first was already seen", () => {
    const bank = bankOnPayday();
    const { sam } = samAfterTheSweep(bank);
    bank.markAgentActionsSeen(sam);

    // The next payday is 4 December, which sweeps again.
    for (let day = 0; day < 14; day++) bank.advanceClock();

    expect(bank.readHome(sam).unseenActions.map((action) => action.at.toISOString())).toEqual([
      "2026-12-04T14:00:00.000Z",
    ]);
  });

  it("doesn't toast one customer's actions to another", () => {
    const bank = bankOnPayday();
    samAfterTheSweep(bank);
    const priya = signInByName(bank, "Priya Natarajan");

    expect(bank.readHome(priya).unseenActions).toEqual([]);
  });

  it("doesn't toast the customer's own Undo back at them", () => {
    const bank = bankOnPayday();
    const { sam, sweepDecisionId } = samAfterTheSweep(bank);
    bank.markAgentActionsSeen(sam);

    bank.undo(sam, sweepDecisionId);

    expect(bank.readHome(sam).unseenActions).toEqual([]);
  });
});
