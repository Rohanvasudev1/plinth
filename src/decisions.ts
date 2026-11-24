import { cents, type Cents } from "./money";

export type DecisionResult = "Done" | "Refused" | "Reversed";

/** The guardrails checked before every agent action that moves money, in the order they run. */
export const GUARDRAILS = ["ownership", "positive amount", "Rule on", "Buffer kept"] as const;
export type Guardrail = (typeof GUARDRAILS)[number];

/** One row of a Decision log entry's Why panel. */
export interface WhyRow {
  label: string;
  value: string;
}

/**
 * Who took a Decision log entry's action: the customer's agent, or the customer undoing one of its actions or
 * changing a Rule, their settings record or Pause.
 */
export type DecisionActor = "agent" | "customer";

/**
 * One entry in the customer's Decision log: an action their agent took or tried to take, or a change the
 * customer made: an Undo, or an edit to a Rule or their settings record.
 */
export interface Decision {
  id: number;
  at: Date;
  actor: DecisionActor;
  trigger: {
    /** The ledger event the agent reacted to. */
    ledgerEventId: number | null;
    description: string;
  };
  /** The Rule version the action used or the customer's change wrote. Null only on a settings change. */
  rule: { id: number; version: number } | null;
  /** What the agent did or tried to do, such as "Moved $340 to House fund". */
  action: string;
  /** The customer's account the money moved or would move from. Null when the Rule names one that isn't theirs. */
  fromAccountId: number | null;
  /** The customer's account the money moved or would move to. Null when the Rule names one that isn't theirs. */
  toAccountId: number | null;
  amount: Cents;
  result: DecisionResult;
  /** The guardrail that stopped a Refused action. Null otherwise. */
  refusedBy: Guardrail | null;
  why: WhyRow[];
  /** The ledger transaction that moved the money. Null on a Refused entry. */
  ledgerTransactionId: number | null;
  /** On a Reversed entry, the entry it reverses. */
  reversesDecisionId: number | null;
  /** On an agent action the customer undid, their Reversed entry. Null otherwise. */
  reversedByDecisionId: number | null;
}

export type NewDecision = Omit<Decision, "id" | "at" | "reversedByDecisionId">;

/**
 * A Decision log entry for a change the customer made to their agent, such as a Rule or settings edit: Done, by
 * the customer, moving no money.
 */
export function customerChangeDecision(change: {
  trigger: string;
  rule: Decision["rule"];
  action: string;
  why: WhyRow[];
}): NewDecision {
  return {
    actor: "customer",
    trigger: { ledgerEventId: null, description: change.trigger },
    rule: change.rule,
    action: change.action,
    fromAccountId: null,
    toAccountId: null,
    amount: cents(0),
    result: "Done",
    refusedBy: null,
    why: change.why,
    ledgerTransactionId: null,
    reversesDecisionId: null,
  };
}

export function isGuardrail(name: string): name is Guardrail {
  return (GUARDRAILS as readonly string[]).includes(name);
}
