import type { Guardrail, WhyRow } from "./decisions";
import { formatDollarsBriefly, type Cents } from "./money";

export const FINDING_STATES = ["open", "chosen", "expired"] as const;
/** Open until the customer picks an Option (chosen) or newer facts replace it (expired). */
export type FindingState = (typeof FINDING_STATES)[number];

export const FINDING_KINDS = ["sweep"] as const;
export type FindingKind = (typeof FINDING_KINDS)[number];

/** A sweep Finding's "Move" Option: move a fixed amount from checking to a savings account. */
export interface MoveOption {
  key: "move";
  amount: Cents;
  fromAccountId: number;
  toAccountId: number;
}

/** A sweep Finding's "Leave it" Option: leave the money in checking. */
export interface LeaveOption {
  key: "leave";
  /** The checking account the money stays in. */
  accountId: number;
}

/** One choice in a Finding, with every amount fixed when the Finding was made. */
export type FindingOption = MoveOption | LeaveOption;
export type FindingOptionKey = FindingOption["key"];

/** A Finding: facts the agent reports to the customer with Options. Nothing happens until the customer picks one. */
export interface Finding {
  id: number;
  kind: FindingKind;
  at: Date;
  state: FindingState;
  /** The ledger event that caused the Finding, such as the paycheck behind a sweep Finding. */
  ledgerEventId: number;
  /** The Rule version the agent worked the Finding out under. */
  rule: { id: number; version: number };
  facts: WhyRow[];
  options: FindingOption[];
  /** The Option the customer picked. Null unless the Finding is chosen. */
  chosenOption: FindingOptionKey | null;
  /** Why the customer's last pick was refused, while the Finding is still open. Null otherwise. */
  refusal: { guardrail: Guardrail; reason: string } | null;
}

export type NewFinding = Pick<Finding, "kind" | "ledgerEventId" | "rule" | "facts" | "options">;

/** The Finding isn't the customer's, or can't take the Option asked for. */
export class FindingError extends Error {
  override name = "FindingError";
}

/** An Option's label and the line under it saying what it does, for Home. */
export function describeOption(
  option: FindingOption,
  accountName: (accountId: number) => string,
): { label: string; detail: string } {
  switch (option.key) {
    case "move":
      return {
        label: `Move ${formatDollarsBriefly(option.amount)} to ${accountName(option.toAccountId)}`,
        detail: `Moves ${formatDollarsBriefly(option.amount)} from ${accountName(option.fromAccountId)} now`,
      };
    case "leave":
      return {
        label: `Leave it in ${accountName(option.accountId)}`,
        detail: "Nothing moves",
      };
  }
}

export function isFindingOptionKey(key: string): key is FindingOptionKey {
  return key === "move" || key === "leave";
}
