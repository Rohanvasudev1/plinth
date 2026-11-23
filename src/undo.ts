import type { Customer, CustomerData } from "./customer-data";
import type { Decision, WhyRow } from "./decisions";
import { cents, formatDollars, formatDollarsBriefly } from "./money";

/** Undo put the money back and wrote a Reversed entry linked to the original. */
export interface UndoDone {
  ok: true;
  /** The Reversed Decision log entry. */
  reversal: Decision;
}

/** Undo moved nothing and wrote nothing. `reason` reads after "Undo refused: ". */
export interface UndoRefused {
  ok: false;
  reason: string;
}

export type UndoResult = UndoDone | UndoRefused;

/** The idempotency key of the ledger transaction that reverses one Decision log entry. */
export function undoKey(decisionId: number): string {
  return `undo:${decisionId}`;
}

/**
 * Undoes one of the customer's agent actions (ADR 0002): posts the opposite transfer under the key
 * `undo:<decision id>` and writes a Reversed entry linked to the original, both in one database
 * transaction. The original entries are never changed, so an action can be undone once, with no time
 * limit. Undo is refused, and nothing is written, when the entry isn't one of the customer's own agent
 * actions, when it was already undone, or when the account the money went to no longer holds the amount.
 */
export function undoAgentAction(
  deps: { customerData: CustomerData },
  customer: Customer,
  decisionId: number,
): UndoResult {
  const { customerData } = deps;
  return customerData.inOneTransaction<UndoResult>(() => {
    // Only the customer's own entries come back, so another customer's action reads as missing.
    const original = customerData.getDecision(customer, decisionId);
    if (!original) return refused("that isn't one of your agent's actions");
    if (original.result === "Refused") return refused("your agent refused that action, so no money moved");
    if (original.result === "Reversed") return refused("that entry is an Undo, not an action your agent took");
    // The reversing transfer and its Reversed entry are written together, so the key answers "already undone".
    if (customerData.findLedgerTransaction(customer, undoKey(original.id))) {
      return refused("you have already undone that action");
    }

    // Undo moves the money the way the action didn't: out of where it went, back to where it came from.
    const movedTo = original.toAccountId === null ? undefined : customerData.getAccount(customer, original.toAccountId);
    const movedFrom =
      original.fromAccountId === null ? undefined : customerData.getAccount(customer, original.fromAccountId);
    if (!movedTo || !movedFrom) return refused("that action didn't move money between two of your accounts");
    if (original.amount <= 0) return refused("that action moved no money");
    if (movedTo.balance < original.amount) {
      return refused(`${movedTo.name} no longer holds the ${formatDollars(original.amount)} to move back`);
    }

    const posted = customerData.postLedgerTransaction(customer, {
      idempotencyKey: undoKey(original.id),
      description: `Undo of ${original.action}`,
      entries: [
        { accountId: movedTo.id, amount: cents(-original.amount) },
        { accountId: movedFrom.id, amount: original.amount },
      ],
    });
    const reversal = customerData.recordDecision(customer, {
      actor: original.actor,
      trigger: { ledgerEventId: null, description: "You pressed Undo" },
      rule: original.rule,
      action: `Moved ${formatDollarsBriefly(original.amount)} back to ${movedFrom.name}`,
      fromAccountId: movedTo.id,
      toAccountId: movedFrom.id,
      amount: original.amount,
      result: "Reversed",
      refusedBy: null,
      why: whyUndone(original, movedTo.name, movedFrom.name),
      ledgerTransactionId: posted.ledgerTransactionId,
      reversesDecisionId: original.id,
    });
    return { ok: true, reversal };
  });
}

function refused(reason: string): UndoRefused {
  return { ok: false, reason };
}

/** The Why panel of a Reversed entry: what was undone, under which Rule, and the checks Undo ran. */
function whyUndone(original: Decision, movedToName: string, movedFromName: string): WhyRow[] {
  const rule = original.why.find((row) => row.label === "Rule");
  return [
    { label: "Trigger", value: `You pressed Undo on "${original.action}"` },
    { label: "Undo of", value: `Decision log entry #${original.id}, which moved the money the other way` },
    ...(rule ? [rule] : []),
    {
      label: "Checked by",
      value: `Undo checks passed: your own agent action, not already undone, ${movedToName} still held ${formatDollars(original.amount)} to move back to ${movedFromName}`,
    },
  ];
}
