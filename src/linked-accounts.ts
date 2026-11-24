// No database imports here: the data layer reads these types.
import { sameDayNextYear, type LocalDate } from "./calendar";
import type { Cents } from "./money";
import type { InstitutionAccountKey, LinkedAccountType } from "./open-banking";

/** The customer's permission for Plinth to see one Linked account, from its start date to its end date. */
export interface Consent {
  start: LocalDate;
  end: LocalDate;
}

/**
 * An account the customer holds at an Institution, which Plinth can see but not move money in or out of, with the
 * copy of its balance from the last Sync and its Consent. It has no ledger entries.
 */
export interface LinkedAccount {
  id: number;
  /** The open banking adapter's account it copies. */
  institutionAccount: InstitutionAccountKey;
  institution: string;
  type: LinkedAccountType;
  /** Below zero when owed. */
  balance: Cents;
  /** When its balance was last read from its Institution. */
  syncedAt: Date;
  consent: Consent;
}

export type NewLinkedAccount = Omit<LinkedAccount, "id" | "syncedAt">;

export class LinkedAccountError extends Error {
  override name = "LinkedAccountError";
}

/** A Consent given on `today`: 12 months, to the same date next year, or 28 Feb for one given on 29 Feb. */
export function consentFrom(today: LocalDate): Consent {
  return { start: today, end: sameDayNextYear(today) };
}

/** Whether the Consent has ended: today is on or after its end date. */
export function hasConsentEnded(consent: Consent, today: LocalDate): boolean {
  return today >= consent.end;
}
