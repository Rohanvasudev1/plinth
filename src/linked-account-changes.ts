import { syncAccess, unlinkAccess } from "./access-log-text";
import { localDateOf, type LocalDate } from "./calendar";
import type { Clock } from "./clock";
import type { Customer, CustomerData } from "./customer-data";
import type { SystemData } from "./system-data";
import { customerChangeDecision } from "./decisions";
import { institutionAccountName, linkDecisionText, renewDecisionText, unlinkDecisionText } from "./linked-account-text";
import { consentFrom, hasConsentEnded, LinkedAccountError, type Consent, type LinkedAccount, type LinkedAccountId } from "./linked-accounts";
import { openBankingAdapter, type InstitutionAccount, type InstitutionAccountKey } from "./open-banking";

// Linking, renewing, unlinking and syncing Linked accounts. Link, renew and unlink are customer changes, so they work
// while the agent is paused, and each writes a Decision log entry with the customer as actor. Every Sync and every
// unlink writes an access log entry with Plinth as reader (ADR 0010).

/** What linking, renewing, unlinking and syncing need: the clock for today's date, and the customer data layer. */
interface Deps {
  clock: Clock;
  customerData: CustomerData;
}

/** An Institution account the customer can link, with the date the Consent would end if they linked it today. */
export interface LinkableAccount extends InstitutionAccount {
  consentEnd: LocalDate;
}

/** The customer's Institution accounts that aren't linked yet, in the adapter's order. */
export function listLinkableAccounts({ clock, customerData }: Deps, customer: Customer): LinkableAccount[] {
  const linked = new Set(customerData.listLinkedAccounts(customer).map((account) => account.institutionAccount));
  const { end } = consentFrom(localDateOf(clock.now()));
  return openBankingAdapter
    .listAccounts(customer)
    .filter((account) => !linked.has(account.key))
    .map((account) => ({ ...account, consentEnd: end }));
}

/** Reads the account's balance from its Institution for today. */
function readBalance({ clock }: Deps, customer: Customer, key: InstitutionAccountKey) {
  return openBankingAdapter.balanceOn(customer, key, localDateOf(clock.now()));
}

/**
 * Stores one of the customer's Institution accounts as a Linked account with this Consent, synced now, and writes the
 * Sync's access log entry. Writes no Decision log entry: `linkAccount` does that, and the seed's Linked accounts have
 * none. Throws LinkedAccountError if they don't hold it or already linked it.
 */
export function storeLinkedAccount(
  deps: Deps,
  customer: Customer,
  key: InstitutionAccountKey,
  consent: Consent,
): LinkedAccount {
  const { customerData } = deps;
  const account = openBankingAdapter.listAccounts(customer).find((candidate) => candidate.key === key);
  if (!account) throw new LinkedAccountError("You hold no such account at an Institution");
  const linked = customerData.createLinkedAccount(customer, {
    institutionAccount: key,
    institution: account.institution,
    type: account.type,
    balance: readBalance(deps, customer, key),
    consent,
  });
  customerData.recordAccess(customer, syncAccess(institutionAccountName(linked)));
  return linked;
}

/**
 * Links one of the customer's Institution accounts with a 12-month Consent from today, syncs it and writes a Decision
 * log entry, in one transaction. Throws LinkedAccountError, saving nothing, if they don't hold it or already linked it.
 */
export function linkAccount(deps: Deps, customer: Customer, key: InstitutionAccountKey): LinkedAccount {
  const { clock, customerData } = deps;
  return customerData.inOneTransaction(() => {
    const linked = storeLinkedAccount(deps, customer, key, consentFrom(localDateOf(clock.now())));
    customerData.recordDecision(customer, customerChangeDecision({ ...linkDecisionText(linked), rule: null }));
    return linked;
  });
}

/** Reads the Linked account's balance from its Institution for today, stores it, and writes the Sync's access log entry. */
function sync(deps: Deps, customer: Customer, linked: LinkedAccount): LinkedAccount {
  const synced = deps.customerData.saveLinkedAccountSync(customer, linked.id, readBalance(deps, customer, linked.institutionAccount));
  deps.customerData.recordAccess(customer, syncAccess(institutionAccountName(synced)));
  return synced;
}

/**
 * Syncs every customer's Linked accounts whose Consent has not ended today, once each. The Simulator runs it when
 * it advances the clock, in the same transaction. Pause doesn't stop it: a Sync is a read, not an agent action.
 */
export function syncLinkedAccounts(deps: Deps & { systemData: SystemData }): void {
  const today = localDateOf(deps.clock.now());
  deps.customerData.inOneTransaction(() => {
    for (const customer of deps.systemData.listCustomers()) {
      for (const linked of deps.customerData.listLinkedAccounts(customer)) {
        if (!hasConsentEnded(linked.consent, today)) sync(deps, customer, linked);
      }
    }
  });
}

/**
 * Gives the customer's Linked account whose Consent has ended a new 12-month Consent from today, syncs it, and writes
 * a Decision log entry, in one transaction. Throws LinkedAccountError, saving nothing, if it isn't theirs or its
 * Consent hasn't ended.
 */
export function renewConsent(deps: Deps, customer: Customer, linkedAccountId: LinkedAccountId): LinkedAccount {
  const { clock, customerData } = deps;
  return customerData.inOneTransaction(() => {
    const today = localDateOf(clock.now());
    const linked = customerData.getLinkedAccount(customer, linkedAccountId);
    if (!linked) throw new LinkedAccountError("That Linked account isn't yours");
    if (!hasConsentEnded(linked.consent, today)) throw new LinkedAccountError("Its Consent hasn't ended, so there is nothing to renew");
    const renewed = sync(deps, customer, customerData.saveConsent(customer, linked.id, consentFrom(today)));
    customerData.recordDecision(customer, customerChangeDecision({ ...renewDecisionText(renewed), rule: null }));
    return renewed;
  });
}

/**
 * Deletes the customer's Linked account and its Consent at once, whether or not the Consent has ended, and writes a
 * Decision log entry and an access log entry, in one transaction. Throws LinkedAccountError, saving nothing, if it
 * isn't theirs. They can link it again later with a new Consent.
 */
export function unlinkAccount({ customerData }: Deps, customer: Customer, linkedAccountId: LinkedAccountId): LinkedAccount {
  return customerData.inOneTransaction(() => {
    const unlinked = customerData.deleteLinkedAccount(customer, linkedAccountId);
    const name = institutionAccountName(unlinked);
    customerData.recordDecision(customer, customerChangeDecision({ ...unlinkDecisionText(unlinked), rule: null }));
    customerData.recordAccess(customer, unlinkAccess(name));
    return unlinked;
  });
}
