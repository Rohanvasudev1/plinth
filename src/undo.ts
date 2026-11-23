import type { Customer, CustomerData } from "./customer-data";
import type { Decision, WhyRow } from "./decisions";
import { cents, formatDollars, formatDollarsBriefly } from "./money";

/** What happened when the customer pressed Undo: their Reversed entry, or the reason nothing moved. */
export type UndoOutcome = { ok: true; reversal: Decision } | { ok: false; reason: string };

/**
 * Undoes one of the customer's agent actions (ADR 0002): posts the reversing ledger transaction under the key
 * `undo:<decision id>` and writes a Reversed entry, by the customer, linked to the original, both in one
 * database transaction. Refused, with the reason and nothing moved, when the action isn't the customer's,
 * isn't an agent action that moved money, was already undone, or the account it moved money to no longer
 * holds the amount.
 */
export function undoAgentAction(customerData: CustomerData, customer: Customer, decisionId: number): UndoOutcome {
  return customerData.inOneTransaction((): UndoOutcome => {
    const original = customerData.getDecision(customer, decisionId);
    if (!original) return refused("There is no such action to undo.");
    if (original.actor !== "agent" || original.result !== "Done") {
      return refused("Only an agent action that moved money can be undone.");
    }
    if (original.reversedByDecisionId !== null) return refused(ALREADY_UNDONE);

    // The money goes back the way it came: out of the account the action moved it to, into the one it moved it from.
    const movedTo = original.toAccountId === null ? undefined : customerData.getAccount(customer, original.toAccountId);
    const movedFrom =
      original.fromAccountId === null ? undefined : customerData.getAccount(customer, original.fromAccountId);
    if (!movedTo || !movedFrom) return refused("The accounts this action used are no longer yours.");
    if (movedTo.balance < original.amount) {
      return refused(
        `${movedTo.name} holds ${formatDollars(movedTo.balance)}, less than the ${formatDollars(original.amount)} to move back.`,
      );
    }

    const posted = customerData.postLedgerTransaction(customer, {
      idempotencyKey: `undo:${original.id}`,
      description: `Undo: ${original.action}`,
      entries: [
        { accountId: movedTo.id, amount: cents(-original.amount) },
        { accountId: movedFrom.id, amount: original.amount },
      ],
    });
    if (!posted.created) return refused(ALREADY_UNDONE);

    const originalRule = original.why.find((row) => row.label === "Rule");
    const why: WhyRow[] = [
      { label: "Trigger", value: `You pressed Undo on “${original.action}”` },
      ...(originalRule ? [originalRule] : []),
      {
        label: "Checked by",
        value: `Not undone before, and ${movedTo.name} held ${formatDollars(movedTo.balance)}, enough to move ${formatDollars(original.amount)} back`,
      },
    ];
    const reversal = customerData.recordDecision(customer, {
      actor: "customer",
      trigger: { ledgerEventId: null, description: "You pressed Undo" },
      rule: original.rule,
      action: `Moved ${formatDollarsBriefly(original.amount)} back to ${movedFrom.name}`,
      fromAccountId: movedTo.id,
      toAccountId: movedFrom.id,
      amount: original.amount,
      result: "Reversed",
      refusedBy: null,
      why,
      ledgerTransactionId: posted.ledgerTransactionId,
      reversesDecisionId: original.id,
    });
    return { ok: true, reversal };
  });
}

const ALREADY_UNDONE = "This action was already undone.";

function refused(reason: string): UndoOutcome {
  return { ok: false, reason };
}
