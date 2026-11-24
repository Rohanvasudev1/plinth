import type { AccessReader, NewAccessLogEntry } from "./access-log";
import type { MissionRead } from "./missions";
import { readListText } from "./mission-text";
import type { UnlinkReason } from "./linked-accounts";

/** Each reader's name in the access log. */
export const ACCESS_READER_TEXT: Record<AccessReader, string> = {
  agent: "Your agent",
  plinth: "Plinth",
  customer: "You",
};

/** The buffer agent's check of one paycheck, whatever came of it. `paycheck` reads like "$3,240.00 from Acme Corp". */
export function sweepCheckAccess(paycheck: string): NewAccessLogEntry {
  return {
    who: "agent",
    what: "Your checking and savings balances, bills before payday and buffer Rule",
    why: `To check whether to sweep money above your Buffer after your paycheck of ${paycheck}`,
  };
}

/** A Mission's ending, reported, stopped or failed, listing what it read. */
export function missionAccess(question: string, readList: MissionRead[]): NewAccessLogEntry {
  return {
    who: "agent",
    what: readListText(readList),
    why: `To answer your Mission: “${question}”`,
  };
}

/** The Subscription price rises Standing search's check of one new Card purchase at a Subscriptions Merchant. */
export function subscriptionPurchaseAccess(merchant: string): NewAccessLogEntry {
  return {
    who: "agent",
    what: `Your Card purchases at ${merchant}`,
    why: "Subscription price rises: to check whether a new Card purchase costs more than the last one",
  };
}

/** The Subscription price rises Standing search's scan of every existing Card purchase at Subscriptions Merchants. */
export function subscriptionScanAccess(): NewAccessLogEntry {
  return {
    who: "agent",
    what: "Your Card purchases at Subscriptions Merchants",
    why: "Subscription price rises: to check your existing Card purchases for price rises and free trials turned paid",
  };
}

/** A Sync of one Linked account: Plinth reading its balance from its Institution. `account` reads like "Summit Card credit card". */
export function syncAccess(account: string): NewAccessLogEntry {
  return {
    who: "plinth",
    what: `Your ${account} balance`,
    why: "Sync: to keep a copy of the balance of an account you linked, while your Consent lasts",
  };
}

const UNLINK_WHY_TEXT: Record<UnlinkReason, string> = {
  unlink: "You unlinked it, so Plinth deleted its copy of that data",
  close: "You closed your Plinth account, so Plinth deleted its copy of that data",
};

/** Unlinking one Linked account, which deletes Plinth's copy of it, because the customer unlinked it or closed. */
export function unlinkAccess(account: string, reason: UnlinkReason): NewAccessLogEntry {
  return { who: "plinth", what: `Your ${account} balance and Consent`, why: UNLINK_WHY_TEXT[reason] };
}
