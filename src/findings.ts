import { formatLocalDate, type LocalDate } from "./calendar";
import type { Guardrail, WhyRow } from "./decisions";
import { formatDollarsBriefly, type Cents } from "./money";

export const FINDING_STATES = ["open", "chosen", "expired", "snoozed"] as const;
/**
 * Open until the customer picks an Option (chosen), newer facts replace it (expired), or they ask to be reminded
 * (snoozed). A snoozed Finding opens again once the simulated clock reaches its date.
 */
export type FindingState = (typeof FINDING_STATES)[number];

/** What made a Finding: a paycheck sweep, a Mission, or the Subscription price rises Standing search. */
export const FINDING_KINDS = ["sweep", "mission", "subscription_price_rise"] as const;
export type FindingKind = (typeof FINDING_KINDS)[number];

/** The Standing searches the agent runs by itself as new data arrives. */
export const STANDING_SEARCHES = ["subscription_price_rises"] as const;
export type StandingSearch = (typeof STANDING_SEARCHES)[number];

export function isStandingSearch(search: string): search is StandingSearch {
  return (STANDING_SEARCHES as readonly string[]).includes(search);
}

/** One fact in a Finding, with its Source: where it came from, such as "From your card charges". */
export interface FindingFact extends WhyRow {
  source: string;
}

/** "Move": move a fixed amount between two of the customer's own accounts. */
export interface MoveOption {
  key: "move";
  amount: Cents;
  fromAccountId: number;
  toAccountId: number;
}

/** "Leave it": leave the money in checking. */
export interface LeaveOption {
  key: "leave";
  /** The checking account the money stays in. */
  accountId: number;
}

/** "Read the full report": shows the Finding's stored report and leaves the Finding open. */
export interface ReadReportOption {
  key: "read_report";
}

/** "Remind me on a date": snoozes the Finding until `date`, when it opens again. */
export interface RemindMeOption {
  key: "remind_me";
  date: LocalDate;
}

/** "Not now": closes the Finding as chosen, changing nothing. */
export interface NotNowOption {
  key: "not_now";
}

/** "Keep paying": closes a subscription Finding as chosen, changing nothing. */
export interface KeepPayingOption {
  key: "keep_paying";
}

/** One choice in a Finding, from the closed list in ADR 0009, with every detail fixed when the Finding was made. */
export type FindingOption =
  | MoveOption
  | LeaveOption
  | ReadReportOption
  | RemindMeOption
  | NotNowOption
  | KeepPayingOption;
export const FINDING_OPTION_KEYS = [
  "move",
  "leave",
  "read_report",
  "remind_me",
  "not_now",
  "keep_paying",
] as const satisfies readonly FindingOption["key"][];
export type FindingOptionKey = (typeof FINDING_OPTION_KEYS)[number];

/** A Finding: facts the agent reports to the customer with Options. Nothing happens until the customer picks one. */
export interface Finding {
  id: number;
  kind: FindingKind;
  at: Date;
  state: FindingState;
  /** The Finding's heading, written when it was made. */
  title: string;
  /** The ledger event that caused the Finding, such as the paycheck behind a sweep Finding. Null on a Mission Finding. */
  ledgerEventId: number | null;
  /** The Rule version the agent worked the Finding out under. Null when no Rule was used, as on a Mission Finding. */
  rule: { id: number; version: number } | null;
  facts: FindingFact[];
  options: FindingOption[];
  /** The Option the agent would pick, and why. Shown only as far as the customer's Advice setting allows. */
  agentsView: string | null;
  /** A Mission's full report. Null on every other kind. */
  report: string | null;
  /** The Mission that made the Finding, on a Mission Finding. */
  missionId: number | null;
  /** The Standing search that made the Finding, on a Standing search Finding. */
  standingSearch: StandingSearch | null;
  /**
   * The Merchant and new price a Subscription price rise Finding is about. A customer has at most one Finding per
   * Merchant and price. Null on every other kind.
   */
  subscriptionPrice: { merchant: string; price: Cents } | null;
  /** The date a snoozed Finding opens again. Null unless the Finding is snoozed. */
  snoozedUntil: LocalDate | null;
  /** The Option the customer picked. Null unless the Finding is chosen. */
  chosenOption: FindingOptionKey | null;
  /** Why the customer's last pick was refused, while the Finding is still open. Null otherwise. */
  refusal: { guardrail: Guardrail; reason: string } | null;
}

export type NewFinding = Pick<Finding, "kind" | "title" | "facts" | "options"> &
  Partial<
    Pick<Finding, "ledgerEventId" | "rule" | "agentsView" | "report" | "missionId" | "standingSearch" | "subscriptionPrice">
  >;

/** The Finding isn't the customer's, or can't take the Option asked for. */
export class FindingError extends Error {
  override name = "FindingError";
}

/** An Option's label and the line under it saying what it does. */
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
    case "read_report":
      return { label: "Read the full report", detail: "Shows all the working. This stays open" };
    case "remind_me":
      return {
        label: `Remind me on ${formatLocalDate(option.date)}`,
        detail: `Snoozes this until ${formatLocalDate(option.date)}, then shows it again`,
      };
    case "not_now":
      return { label: "Not now", detail: "Closes this. Nothing changes" };
    case "keep_paying":
      return { label: "Keep paying", detail: "Closes this. Nothing changes" };
  }
}

export function isFindingOptionKey(key: string): key is FindingOptionKey {
  return (FINDING_OPTION_KEYS as readonly string[]).includes(key);
}

/** A Finding's state in page copy. */
export function findingStateLabel(state: FindingState): string {
  switch (state) {
    case "open":
      return "Open";
    case "chosen":
      return "Chosen";
    case "expired":
      return "Expired";
    case "snoozed":
      return "Snoozed";
  }
}
