import { describe, expect, it } from "vitest";
import { createBank, type Bank } from "./bank";
import { fixedClock } from "./clock";
import type { Customer } from "./customer-data";
import { openTestDatabase } from "./db/database";
import type { Decision } from "./decisions";
import { cents } from "./money";
import { signInByName } from "./test-bank";

/** Sam's bank on payday, 20 Nov 2026, after the paycheck posted and the agent swept $340 to the House fund. */
function afterSamsSweep(): { bank: Bank; sam: Customer; sweep: Decision } {
  const bank = createBank({ db: openTestDatabase(), clock: fixedClock(new Date("2026-11-20T14:00:00Z")) });
  const sam = signInByName(bank, "Sam Calloway");
  bank.postPaycheck();
  const [sweep] = bank.readDecisionLog(sam);
  if (!sweep) throw new Error("The paycheck didn't sweep");
  return { bank, sam, sweep };
}

function balances(bank: Bank, customer: Customer): number[] {
  return bank.customerData.listAccounts(customer).map((account) => account.balance);
}

describe("Undo", () => {
  it("moves the swept money back to Checking with key undo:<decision id> and writes a Reversed entry linked to the sweep", () => {
    const { bank, sam, sweep } = afterSamsSweep();
    expect(balances(bank, sam)).toEqual([3_127_00, 12_740_00]);

    const outcome = bank.undo(sam, sweep.id);

    expect(outcome).toEqual({ ok: true, reversal: expect.objectContaining({ result: "Reversed" }) });
    expect(balances(bank, sam)).toEqual([3_467_00, 12_400_00]);
    const undone = bank.customerData.findLedgerTransaction(sam, `undo:${sweep.id}`);
    const [checking, houseFund] = bank.customerData.listAccounts(sam);
    expect(undone?.entries).toEqual([
      { accountId: houseFund?.id, amount: -340_00 },
      { accountId: checking?.id, amount: 340_00 },
    ]);
    const [reversal, original] = bank.readDecisionLog(sam);
    expect(reversal).toEqual(
      expect.objectContaining({
        actor: "customer",
        action: "Moved $340 back to Checking",
        fromAccountId: houseFund?.id,
        toAccountId: checking?.id,
        amount: 340_00,
        result: "Reversed",
        refusedBy: null,
        ledgerTransactionId: undone?.id,
        reversesDecisionId: sweep.id,
        reversedByDecisionId: null,
      }),
    );
    expect(original).toEqual({ ...sweep, reversedByDecisionId: reversal?.id });
  });

  it("is refused, and moves nothing more, when the action was already undone", () => {
    const { bank, sam, sweep } = afterSamsSweep();
    bank.undo(sam, sweep.id);

    expect(bank.undo(sam, sweep.id)).toEqual({ ok: false, reason: "This action was already undone." });
    expect(balances(bank, sam)).toEqual([3_467_00, 12_400_00]);
    expect(bank.readDecisionLog(sam).map((entry) => entry.result)).toEqual(["Reversed", "Done"]);
  });

  it("is refused with the reason when a card purchase has drained the House fund below the amount", () => {
    const { bank, sam, sweep } = afterSamsSweep();
    const [, houseFund] = bank.customerData.listAccounts(sam);
    if (!houseFund) throw new Error("Sam's House fund is missing");
    bank.cardPurchase(sam, { accountId: houseFund.id, amount: cents(12_500_00), idempotencyKey: "card:drain" });

    expect(bank.undo(sam, sweep.id)).toEqual({
      ok: false,
      reason: "House fund holds $240.00, less than the $340.00 to move back.",
    });
    expect(balances(bank, sam)).toEqual([3_127_00, 240_00]);
    expect(bank.readDecisionLog(sam)).toEqual([sweep]);
  });

  it("only undoes actions that moved money, not Refused or Reversed entries", () => {
    const { bank, sam, sweep } = afterSamsSweep();
    const { reversal } = bank.undo(sam, sweep.id) as { reversal: Decision };

    expect(bank.undo(sam, reversal.id)).toEqual({ ok: false, reason: "Only an agent action that moved money can be undone." });
    expect(balances(bank, sam)).toEqual([3_467_00, 12_400_00]);
  });

  it("can't undo another customer's action", () => {
    const { bank, sam, sweep } = afterSamsSweep();
    const priya = signInByName(bank, "Priya Natarajan");

    expect(bank.undo(priya, sweep.id)).toEqual({ ok: false, reason: "There is no such action to undo." });
    expect(balances(bank, sam)).toEqual([3_127_00, 12_740_00]);
    expect(bank.readDecisionLog(sam)).toEqual([sweep]);
  });
});
