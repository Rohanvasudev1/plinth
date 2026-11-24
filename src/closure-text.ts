import { formatDollars, type Cents } from "./money";

/** What Close and delete keeps as records, as the confirmation page lists them. */
export const CLOSURE_KEEPS = ["The Ledger", "The Decision log", "The access log"] as const;

/** What Close and delete deletes, as the confirmation page lists them. The Decision log entry says the same in a sentence. */
export const CLOSURE_DELETES = ["Missions", "Findings", "Settings", "Goal targets", "Linked accounts"] as const;

/** The payout's ledger transaction description. */
export const PAYOUT_DESCRIPTION = "Payout on Close and delete";

/** The payout line on the confirmation page and in the Decision log entry. */
export function payoutText(payout: Cents): string {
  return payout > 0 ? `${formatDollars(payout)} paid out to you` : "Nothing to pay out: every balance is $0.00";
}

/** The Decision log entry's text for the customer closing their Plinth account. */
export function closedDecisionText(payout: Cents) {
  return {
    trigger: "You closed your Plinth account",
    action: "Closed your Plinth account",
    why: [
      { label: "Trigger", value: "You confirmed Close and delete on Privacy" },
      { label: "Payout", value: payoutText(payout) },
      { label: "Kept as records", value: "The Ledger, the Decision log and the access log" },
      { label: "Deleted", value: "Missions, Findings, settings, Goal targets and Linked accounts" },
    ],
  };
}
