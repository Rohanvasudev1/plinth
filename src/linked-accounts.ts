// No database imports here: the data layer reads these types.
import { sameDayNextYear, type LocalDate } from "./calendar";
import type { Cents } from "./money";
import type { InstitutionAccountKey, LinkedAccountType } from "./open-banking";

/** What the customer allows Plinth to see of one Linked account: its balance, from the start date to the end date. */
export interface Consent {
  start: LocalDate;
  end: LocalDate;
}

declare const linkedAccountIdBrand: unique symbol;

/** A Linked account's id, kept apart from Plinth account ids so the two can't be swapped. */
export type LinkedAccountId = number & { readonly [linkedAccountIdBrand]: true };

/** Returns `id` as a LinkedAccountId, or throws RangeError if it isn't a positive whole number. */
export function asLinkedAccountId(id: number): LinkedAccountId {
  if (!Number.isSafeInteger(id) || id <= 0) throw new RangeError(`Not a Linked account id: ${id}`);
  return id as LinkedAccountId;
}

/**
 * An account the customer holds at an Institution, which Plinth can see but not move money in or out of, with the
 * copy of its balance from the last Sync and its Consent. It has no ledger entries.
 */
export interface LinkedAccount {
  id: LinkedAccountId;
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

/** Why a Linked account was unlinked: the customer pressed Unlink, or used Close and delete. */
export type UnlinkReason = "unlink" | "close";

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
