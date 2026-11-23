import { addDays, daysBetween, localDateOf, type LocalDate } from "./calendar";
import type { SettableClock } from "./clock";
import type { Customer, CustomerData } from "./customer-data";
import { cents, type Cents } from "./money";
import type { Payroll, SystemAccount, SystemData } from "./system-data";

/** The simulated employers that run payrolls, and the clearing account each pays through. */
export const EMPLOYERS: Record<string, { name: string; clearingAccount: SystemAccount }> = {
  "acme-corp": { name: "Acme Corp", clearingAccount: "acmePayroll" },
};

export interface PostedPaycheck {
  customerId: number;
  accountId: number;
  employerName: string;
  payDate: LocalDate;
  amount: Cents;
  ledgerTransactionId: number;
  /** False when this paycheck had already posted, in which case nothing changed. */
  created: boolean;
}

export interface CardPurchase {
  accountId: number;
  amount: Cents;
  /** Unique per purchase attempt, so a resubmitted form changes nothing. */
  idempotencyKey: string;
}

export interface PostedCardPurchase {
  ledgerTransactionId: number;
  /** False when this purchase had already posted, in which case nothing changed. */
  created: boolean;
}

/** The simulated merchant refused a card purchase. Nothing moved. */
export class CardDeclinedError extends Error {
  override name = "CardDeclinedError";
}

export interface AdvancedClock {
  now: Date;
  /** The paychecks whose dates the clock passed, in the order they posted. */
  paychecks: PostedPaycheck[];
}

/** One day on the simulated clock. Across a daylight saving change the local time of day shifts by an hour. */
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

/** The outside institutions the bank talks to, simulated: employers paying in, and the clock they share. */
export interface Simulator {
  /** Posts every paycheck due today. Posting a paycheck that already posted changes nothing. */
  postPaycheck(): PostedPaycheck[];
  /** Moves the clock forward one day, then posts, in date order, every paycheck whose date it passed. */
  advanceClock(): AdvancedClock;
  /**
   * Spends from one of the customer's accounts at a simulated merchant, through the Merchant clearing account.
   * Throws CardDeclinedError if the account isn't the customer's, the amount isn't above zero, or the account
   * holds less than the amount.
   */
  cardPurchase(customer: Customer, purchase: CardPurchase): PostedCardPurchase;
}

export function createSimulator(deps: {
  clock: SettableClock;
  systemData: SystemData;
  customerData: CustomerData;
}): Simulator {
  const { clock, systemData, customerData } = deps;

  function isPayday(payroll: Payroll, date: LocalDate): boolean {
    const days = daysBetween(payroll.firstPayDate, date);
    return days >= 0 && days % payroll.intervalDays === 0;
  }

  function customerFor(payroll: Payroll): Customer {
    const customer = systemData.findCustomer(payroll.customerId);
    if (!customer) throw new Error(`Payroll ${payroll.id} pays a customer that doesn't exist`);
    return customer;
  }

  /** Paychecks due after `after` and on or before `through`, in date order, then in payroll order. */
  function paychecksDue(after: LocalDate, through: LocalDate): { payroll: Payroll; payDate: LocalDate }[] {
    const due = [];
    for (let date = addDays(after, 1); date <= through; date = addDays(date, 1)) {
      for (const payroll of systemData.listPayrolls()) {
        if (isPayday(payroll, date)) due.push({ payroll, payDate: date });
      }
    }
    return due;
  }

  function postPaychecks(due: { payroll: Payroll; payDate: LocalDate }[]): PostedPaycheck[] {
    return due.map(({ payroll, payDate }) => {
      const employer = EMPLOYERS[payroll.employer];
      if (!employer) throw new Error(`Payroll ${payroll.id} names an unknown employer ${payroll.employer}`);
      const clearing = systemData.ensureSystemAccount(employer.clearingAccount);
      const posted = customerData.postLedgerTransaction(customerFor(payroll), {
        idempotencyKey: `payroll:${payroll.employer}:${payDate}`,
        description: `Paycheck from ${employer.name}`,
        entries: [
          { accountId: clearing, amount: cents(-payroll.amount) },
          { accountId: payroll.accountId, amount: payroll.amount },
        ],
      });
      return {
        customerId: payroll.customerId,
        accountId: payroll.accountId,
        employerName: employer.name,
        payDate,
        amount: payroll.amount,
        ledgerTransactionId: posted.ledgerTransactionId,
        created: posted.created,
      };
    });
  }

  return {
    postPaycheck() {
      const today = localDateOf(clock.now());
      return postPaychecks(paychecksDue(addDays(today, -1), today));
    },
    advanceClock() {
      const before = clock.now();
      const now = new Date(before.getTime() + ONE_DAY_MS);
      clock.setTo(now);
      return { now, paychecks: postPaychecks(paychecksDue(localDateOf(before), localDateOf(now))) };
    },
    cardPurchase(customer, { accountId, amount, idempotencyKey }) {
      const already = customerData.findLedgerTransaction(customer, idempotencyKey);
      if (already) return { ledgerTransactionId: already.id, created: false };

      const account = customerData.getAccount(customer, accountId);
      if (!account) throw new CardDeclinedError("That account isn't yours");
      if (amount <= 0) throw new CardDeclinedError("A purchase must be more than $0.00");
      if (account.balance < amount) throw new CardDeclinedError(`${account.name} doesn't hold enough`);

      const posted = customerData.postLedgerTransaction(customer, {
        idempotencyKey,
        description: "Card purchase",
        entries: [
          { accountId: account.id, amount: cents(-amount) },
          { accountId: systemData.ensureSystemAccount("merchant"), amount },
        ],
      });
      return { ledgerTransactionId: posted.ledgerTransactionId, created: posted.created };
    },
  };
}
