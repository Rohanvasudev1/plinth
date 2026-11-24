import { formatLocalDateWithYear, type LocalDate } from "./calendar";
import type { Consent, LinkedAccount, UnlinkReason } from "./linked-accounts";
import type { InstitutionAccount, LinkedAccountType } from "./open-banking";

/** Each Linked account type in words, as All accounts, the Decision log and the access log show it. */
export const LINKED_ACCOUNT_TYPE_TEXT: Record<LinkedAccountType, string> = {
  checking: "checking",
  savings: "savings",
  credit_card: "credit card",
  loan: "loan",
  retirement: "retirement (401(k))",
};

/** An Institution account by name, such as "Summit Card credit card". */
export function institutionAccountName(account: Pick<InstitutionAccount, "institution" | "type">): string {
  return `${account.institution} ${LINKED_ACCOUNT_TYPE_TEXT[account.type]}`;
}

/** What the customer agrees to when they link an account, on the Link another bank page. */
export function seeOnlyText(consentEnd: LocalDate): string {
  return `See only: Plinth will see this account's balance until ${formatLocalDateWithYear(consentEnd)}`;
}

function consentText(consent: Consent): string {
  return `${formatLocalDateWithYear(consent.start)} to ${formatLocalDateWithYear(consent.end)}`;
}

/** The Decision log entry's text for the customer linking an account. */
export function linkDecisionText(linked: LinkedAccount) {
  const name = institutionAccountName(linked);
  return {
    trigger: "You linked an account",
    action: `Linked ${name}`,
    why: [
      { label: "Trigger", value: "You picked it on Link another bank" },
      { label: "Account", value: name },
      { label: "Consent", value: consentText(linked.consent) },
      { label: "What Plinth sees", value: "Its balance only, synced once a day. Plinth can't move money in or out" },
    ],
  };
}

/** The Decision log entry's text for the customer renewing an ended Consent. */
export function renewDecisionText(linked: LinkedAccount) {
  const name = institutionAccountName(linked);
  return {
    trigger: "You renewed a Consent",
    action: `Renewed your Consent for ${name}`,
    why: [
      { label: "Trigger", value: "You pressed Renew on All accounts" },
      { label: "Account", value: name },
      { label: "Consent", value: consentText(linked.consent) },
    ],
  };
}

const UNLINK_TRIGGER_TEXT: Record<UnlinkReason, string> = {
  unlink: "You pressed Unlink on All accounts",
  close: "You closed your Plinth account",
};

/** The Decision log entry's text for the customer unlinking an account. */
export function unlinkDecisionText(linked: LinkedAccount, reason: UnlinkReason) {
  const name = institutionAccountName(linked);
  return {
    trigger: "You unlinked an account",
    action: `Unlinked ${name}`,
    why: [
      { label: "Trigger", value: UNLINK_TRIGGER_TEXT[reason] },
      { label: "Account", value: name },
      { label: "What Plinth kept", value: "Nothing. Plinth deleted its copy of that data" },
    ],
  };
}
