import type { LocalDate } from "./calendar";
import { formatLocalDate } from "./calendar";
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

/** The Why row saying when a snoozed Finding opens again. */
export function snoozedUntilText(date: LocalDate): string {
  return `Shows again on ${formatLocalDate(date)}`;
}
