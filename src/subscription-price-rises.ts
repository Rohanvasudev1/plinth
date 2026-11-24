import { subscriptionPurchaseAccess, subscriptionScanAccess } from "./access-log-text";
import { localDateOf, sameDayNextMonth } from "./calendar";
import type { Clock } from "./clock";
import type { Customer, CustomerData, LedgerTransaction } from "./customer-data";
import {
  CARD_PURCHASES_SOURCE,
  purchaseText,
  PAY_NOT_USE,
  priceRiseTitle,
  trialTurnedPaidTitle,
} from "./finding-text";
import type { FindingFact, NewFinding } from "./findings";
import type { LedgerEventDispatcher } from "./ledger-events";
import { cents, type Cents } from "./money";
import { isFreeTrialMerchant } from "./simulator";
import type { SystemData } from "./system-data";

export interface SearchDeps {
  clock: Clock;
  customerData: CustomerData;
  systemData: SystemData;
}

/** A Card purchase at a Merchant in the Subscriptions Category. */
interface SubscriptionPurchase {
  transaction: LedgerTransaction;
  merchant: string;
  amount: Cents;
}

/**
 * Runs the Subscription price rises Standing search: plain code, no language model. When a Card purchase posts at a
 * Merchant in the Subscriptions Category, it compares the purchase with that Merchant's previous purchase to the same
 * customer, and makes a Finding when the price went up, or when a Free-trial Merchant took its first Card purchase.
 * A customer has at most one Finding per Merchant and price, so posting the same price again finds nothing.
 *
 * Each Card purchase it checks, and each scan of existing purchases, writes one access log entry in the same
 * transaction (ADR 0010), but only while the switch is on and the customer has finished setup.
 *
 * The seed posts history without ledger events reaching any agent, so it also checks every customer's existing card
 * purchases now. Returns a function that stops it.
 */
export function startSubscriptionPriceRises(deps: SearchDeps & { ledgerEvents: LedgerEventDispatcher }): () => void {
  const { customerData, systemData, ledgerEvents } = deps;
  for (const customer of systemData.listCustomers()) searchExistingPurchases(deps, customer);
  return ledgerEvents.subscribe((event) => {
    const customer = systemData.findCustomer(event.customerId);
    if (!customer) return;
    customerData.inOneTransaction(() => {
      const purchases = subscriptionPurchases(deps, customer);
      const index = purchases.findIndex((purchase) => purchase.transaction.id === event.ledgerTransactionId);
      const purchase = purchases[index];
      if (!purchase || !searchIsOn(deps, customer)) return;
      customerData.recordAccess(customer, subscriptionPurchaseAccess(purchase.merchant));
      checkPurchase(deps, customer, purchase, purchases.slice(0, index));
    });
  });
}

/**
 * Checks each of the customer's existing card purchases in the order they posted, making any Finding not already made.
 * Safe to repeat. Does nothing while the customer's switch is off, or before they finish setup.
 */
export function searchExistingPurchases(deps: SearchDeps, customer: Customer): void {
  deps.customerData.inOneTransaction(() => {
    if (!searchIsOn(deps, customer)) return;
    deps.customerData.recordAccess(customer, subscriptionScanAccess());
    const purchases = subscriptionPurchases(deps, customer);
    purchases.forEach((purchase, index) => checkPurchase(deps, customer, purchase, purchases.slice(0, index)));
  });
}

function checkPurchase(deps: SearchDeps, customer: Customer, purchase: SubscriptionPurchase, earlier: SubscriptionPurchase[]): void {
  const { clock, customerData } = deps;
  const previous = earlier.filter((candidate) => candidate.merchant === purchase.merchant).at(-1);
  const found = previous
    ? purchase.amount > previous.amount && priceRise(previous, purchase)
    : isFreeTrialMerchant(purchase.merchant) && trialTurnedPaid(purchase);
  if (!found) return;
  const already = customerData
    .listFindings(customer)
    .some(
      (finding) =>
        finding.subscriptionPrice?.merchant === purchase.merchant && finding.subscriptionPrice.price === purchase.amount,
    );
  if (already) return;
  customerData.createFinding(customer, {
    ...found,
    kind: "subscription_price_rise",
    standingSearch: "subscription_price_rises",
    subscriptionPrice: { merchant: purchase.merchant, price: purchase.amount },
    ledgerEventId: purchase.transaction.ledgerEventId,
    options: [{ key: "keep_paying" }, { key: "remind_me", date: sameDayNextMonth(localDateOf(clock.now())) }],
  });
}

/** Whether the customer has finished setup and has the search switched on. It reads nothing until both are true. */
function searchIsOn(deps: SearchDeps, customer: Customer): boolean {
  return deps.customerData.getSettings(customer)?.standingSearches.subscription_price_rises ?? false;
}

function priceRise(previous: SubscriptionPurchase, purchase: SubscriptionPurchase): Pick<NewFinding, "title" | "facts"> {
  return {
    title: priceRiseTitle(purchase.merchant, previous.amount, purchase.amount),
    facts: [
      fact("Before", purchaseText(previous.amount, localDateOf(previous.transaction.postedAt))),
      fact("Now", purchaseText(purchase.amount, localDateOf(purchase.transaction.postedAt))),
      fact("What Plinth can see", PAY_NOT_USE),
    ],
  };
}

function trialTurnedPaid(purchase: SubscriptionPurchase): Pick<NewFinding, "title" | "facts"> {
  return {
    title: trialTurnedPaidTitle(purchase.merchant, purchase.amount),
    facts: [
      fact("Free trial turned paid", purchaseText(purchase.amount, localDateOf(purchase.transaction.postedAt))),
      fact("What Plinth can see", PAY_NOT_USE),
    ],
  };
}

function fact(label: string, value: string): FindingFact {
  return { label, value, source: CARD_PURCHASES_SOURCE };
}

/** The customer's Card purchases at Subscriptions Merchants, in the order they posted. */
function subscriptionPurchases(deps: SearchDeps, customer: Customer): SubscriptionPurchase[] {
  const merchantClearing = deps.systemData.ensureSystemAccount("merchant");
  return deps.customerData.listLedgerTransactions(customer).flatMap((transaction) => {
    const paid = transaction.entries.find((entry) => entry.accountId === merchantClearing && entry.amount > 0);
    if (!paid || transaction.category !== "Subscriptions" || transaction.counterparty === null) return [];
    return [{ transaction, merchant: transaction.counterparty, amount: cents(paid.amount) }];
  });
}
