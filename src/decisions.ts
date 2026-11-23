import type { Cents } from "./money";

export type DecisionResult = "Done" | "Refused" | "Reversed";

/** The guardrails checked before every agent action that moves money, in the order they run. */
export const GUARDRAILS = ["ownership", "positive amount", "Rule on", "Buffer kept"] as const;
export type Guardrail = (typeof GUARDRAILS)[number];

/** One row of a Decision log entry's Why panel. */
export interface WhyRow {
  label: string;
  value: string;
}

/** One entry in the customer's Decision log: an action their agent took or tried to take. */
export interface Decision {
  id: number;
  at: Date;
  actor: "agent";
  trigger: {
    /** The ledger event the agent reacted to. */
    ledgerEventId: number | null;
    description: string;
  };
  rule: { id: number; version: number };
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
  /** When Home last showed this entry to the customer. Null until it has, which is what the toast reads. */
  seenAt: Date | null;
}

/** A new entry is always unseen, so `seenAt` is set by Home rather than by whoever records it. */
export type NewDecision = Omit<Decision, "id" | "at" | "seenAt">;

export function isGuardrail(name: string): name is Guardrail {
  return (GUARDRAILS as readonly string[]).includes(name);
}
