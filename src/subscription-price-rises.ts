import { localDateOf, sameDayNextMonth } from "./calendar";
import type { Clock } from "./clock";
import type { Customer, CustomerData, LedgerTransaction } from "./customer-data";
import {
  CARD_CHARGES_SOURCE,
  chargeText,
  PAY_NOT_USE,
  priceRiseTitle,
  trialTurnedPaidTitle,
} from "./finding-text";
import type { FindingFact, NewFinding } from "./findings";
import type { LedgerEventDispatcher } from "./ledger-events";
import { cents, type Cents } from "./money";
import { isFreeTrialMerchant } from "./simulator";
import type { SystemData } from "./system-data";

interface SearchDeps {
  clock: Clock;
  customerData: CustomerData;
  systemData: SystemData;
}

/** A Card purchase at a Merchant in the Subscriptions Category. */
interface SubscriptionCharge {
  transaction: LedgerTransaction;
  merchant: string;
  amount: Cents;
}

/**
 * Runs the Subscription price rises Standing search: plain code, no language model. When a Card purchase posts at a
 * Merchant in the Subscriptions Category, it compares the charge with that Merchant's previous charge to the same
 * customer, and makes a Finding when the price went up, or when a free-trial Merchant charged for the first time.
 * A customer has at most one Finding per Merchant and price, so posting the same price again finds nothing.
 *
 * The seed posts history without ledger events reaching any agent, so it also checks every customer's existing card
 * charges now. Returns a function that stops it.
 */
export function startSubscriptionPriceRises(deps: SearchDeps & { ledgerEvents: LedgerEventDispatcher }): () => void {
  const { customerData, systemData, ledgerEvents } = deps;
  for (const customer of systemData.listCustomers()) searchExistingCharges(deps, customer);
  return ledgerEvents.subscribe((event) => {
    const customer = systemData.findCustomer(event.customerId);
    if (!customer) return;
    customerData.inOneTransaction(() => {
      const charges = subscriptionCharges(deps, customer);
      const index = charges.findIndex((charge) => charge.transaction.id === event.ledgerTransactionId);
      const charge = charges[index];
      if (charge) checkCharge(deps, customer, charge, charges.slice(0, index));
    });
  });
}

/**
 * Checks each of the customer's existing card charges in the order they posted, making any Finding not already made.
 * Safe to repeat. Does nothing while the customer's switch is off, or before they finish setup.
 */
export function searchExistingCharges(deps: SearchDeps, customer: Customer): void {
  deps.customerData.inOneTransaction(() => {
    const charges = subscriptionCharges(deps, customer);
    charges.forEach((charge, index) => checkCharge(deps, customer, charge, charges.slice(0, index)));
  });
}

function checkCharge(deps: SearchDeps, customer: Customer, charge: SubscriptionCharge, earlier: SubscriptionCharge[]): void {
  const { clock, customerData } = deps;
  if (!customerData.getSettings(customer)?.standingSearches.subscription_price_rises) return;
  const previous = earlier.filter((candidate) => candidate.merchant === charge.merchant).at(-1);
  const found = previous
    ? charge.amount > previous.amount && priceRise(previous, charge)
    : isFreeTrialMerchant(charge.merchant) && trialTurnedPaid(charge);
  if (!found) return;
  const already = customerData
    .listFindings(customer)
    .some(
      (finding) =>
        finding.subscriptionPrice?.merchant === charge.merchant && finding.subscriptionPrice.price === charge.amount,
    );
  if (already) return;
  customerData.createFinding(customer, {
    ...found,
    kind: "subscription_price_rise",
    standingSearch: "subscription_price_rises",
    subscriptionPrice: { merchant: charge.merchant, price: charge.amount },
    ledgerEventId: charge.transaction.ledgerEventId,
    options: [{ key: "keep_paying" }, { key: "remind_me", date: sameDayNextMonth(localDateOf(clock.now())) }],
  });
}

function priceRise(previous: SubscriptionCharge, charge: SubscriptionCharge): Pick<NewFinding, "title" | "facts"> {
  return {
    title: priceRiseTitle(charge.merchant, previous.amount, charge.amount),
    facts: [
      fact("Before", chargeText(previous.amount, localDateOf(previous.transaction.postedAt))),
      fact("Now", chargeText(charge.amount, localDateOf(charge.transaction.postedAt))),
      fact("What Plinth can see", PAY_NOT_USE),
    ],
  };
}

function trialTurnedPaid(charge: SubscriptionCharge): Pick<NewFinding, "title" | "facts"> {
  return {
    title: trialTurnedPaidTitle(charge.merchant, charge.amount),
    facts: [
      fact("Free trial turned paid", chargeText(charge.amount, localDateOf(charge.transaction.postedAt))),
      fact("What Plinth can see", PAY_NOT_USE),
    ],
  };
}

function fact(label: string, value: string): FindingFact {
  return { label, value, source: CARD_CHARGES_SOURCE };
}

/** The customer's Card purchases at Subscriptions Merchants, in the order they posted. */
function subscriptionCharges(deps: SearchDeps, customer: Customer): SubscriptionCharge[] {
  const merchantClearing = deps.systemData.ensureSystemAccount("merchant");
  return deps.customerData.listLedgerTransactions(customer).flatMap((transaction) => {
    const paid = transaction.entries.find((entry) => entry.accountId === merchantClearing && entry.amount > 0);
    if (!paid || transaction.category !== "Subscriptions" || transaction.counterparty === null) return [];
    return [{ transaction, merchant: transaction.counterparty, amount: cents(paid.amount) }];
  });
}
