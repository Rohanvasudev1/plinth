import { formatLocalDate, type LocalDate } from "./calendar";
import type { WhyRow } from "./decisions";
import type { Finding } from "./findings";
import { formatDollars, type Cents } from "./money";

// Text a Finding stores when it is written: its title and the Source of each fact (see CODING_STANDARDS.md).

/** A sweep Finding's title: the fact it reports, how much is above the Buffer, without leaning to an Option. */
export function sweepFindingTitle(amount: Cents, checkingName: string): string {
  return `${formatDollars(amount)} above your Buffer in ${checkingName}`;
}

/** The Sources of a sweep Finding's facts. */
export const SWEEP_SOURCES = {
  paycheck: "From your paycheck deposit",
  bills: "From your Scheduled bills",
  rule: "From your Rules",
  amount: "Worked out from your balance, Buffer and bills",
  why: "From your settings and Rules",
} as const;

/** The Decision log action for a pick on a Finding that moves no money. */
export function pickedOptionAction(label: string, title: string): string {
  return `${label}: “${title}”`;
}

/** The Decision log action when a snoozed Finding opens again on its date. */
export function reopenedFindingAction(title: string): string {
  return `Showed you “${title}” again`;
}

/** The trigger of the Decision log entry written when a snoozed Finding opens again. */
export const REMINDER_TRIGGER = "Your reminder date came";

/** The Decision log action for picking Leave it on a sweep Finding. */
export function leftMoneyAction(accountName: string): string {
  return `Left the money in ${accountName}`;
}

/** What a pick that moves no money changes, for its Why panel. */
export const PICK_CHANGES = {
  leave: "Nothing moves",
  readReport: "Nothing. This stays open",
  close: "Nothing. This closes",
  snooze: (date: LocalDate) => `Shows again on ${formatLocalDate(date)}`,
} as const;

/** The Why rows of a Decision log entry about one Finding: what triggered it, the Finding, and what changes. */
export function findingWhyRows(trigger: string, finding: Pick<Finding, "title">, whatChanges: string): WhyRow[] {
  return [
    { label: "Trigger", value: trigger },
    { label: "Finding", value: finding.title },
    { label: "What changes", value: whatChanges },
  ];
}

/** The Why rows of the Decision log entry written when a snoozed Finding opens again. */
export function reopenedFindingWhy(finding: Pick<Finding, "title">, date: LocalDate): WhyRow[] {
  return findingWhyRows(
    `You asked to be reminded on ${formatLocalDate(date)}`,
    finding,
    "It is open again. Nothing else changes",
  );
}

/** Why a Finding expired, for its card and for a pick refused because of it. */
export function expiredReason(finding: Pick<Finding, "kind">): string {
  return finding.kind === "sweep" ? "A newer paycheck changed the numbers" : "Newer facts or your settings closed it";
}

/** The Source of every fact in a Subscription price rise Finding, in the spec's words. */
export const CARD_PURCHASES_SOURCE = "From your card charges";

/** What a Subscription price rise Finding can't know, stated as one of its facts. */
export const PAY_NOT_USE = "Plinth can see what you pay, not whether you use it";

/** A Card purchase for a Subscription price rise Finding's facts, such as "$18.00 on Thu 15 Oct". */
export function purchaseText(amount: Cents, date: LocalDate): string {
  return `${formatDollars(amount)} on ${formatLocalDate(date)}`;
}

/** A Subscription price rise Finding's title when the price went up. */
export function priceRiseTitle(merchant: string, before: Cents, now: Cents): string {
  return `${merchant} went up from ${formatDollars(before)} to ${formatDollars(now)}`;
}

/** A Subscription price rise Finding's title when a free trial turned paid. */
export function trialTurnedPaidTitle(merchant: string, price: Cents): string {
  return `Your ${merchant} free trial turned paid at ${formatDollars(price)}`;
}

/** Why a Mission Move is refused when no buffer Rule covers the account it moves from. */
export function noBufferRuleReason(accountName: string): string {
  return `no buffer Rule lets your agent move money from ${accountName}`;
}
