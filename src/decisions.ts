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
  fromAccountId: number;
  toAccountId: number;
  amount: Cents;
  result: DecisionResult;
  /** The guardrail that stopped a Refused action. Null otherwise. */
  refusedBy: Guardrail | null;
  why: WhyRow[];
  /** The ledger transaction that moved the money. Null on a Refused entry. */
  ledgerTransactionId: number | null;
  /** On a Reversed entry, the entry it reverses. */
  reversesDecisionId: number | null;
}

export type NewDecision = Omit<Decision, "id" | "at">;

export function isGuardrail(name: string): name is Guardrail {
  return (GUARDRAILS as readonly string[]).includes(name);
}
