import { addDays, daysBetween, localDateOf, sameTimeNextDay, type LocalDate } from "./calendar";
import type { SettableClock } from "./clock";
import type { Customer, CustomerData, Payroll } from "./customer-data";
import { cents, type Cents } from "./money";
import { EMPLOYERS, type SystemData } from "./system-data";

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

/** The outside institutions the bank talks to, simulated: employers paying in, merchants, and the clock they share. */
export interface Simulator {
  /** Posts every customer's paycheck due today. Posting a paycheck that already posted changes nothing. */
  postPaycheck(): PostedPaycheck[];
  /**
   * Moves the clock to the same time of day on the next date, then posts, in date order, every
   * paycheck whose date it passed.
   */
  advanceClock(): AdvancedClock;
  /**
   * Spends from one of the customer's accounts at a simulated merchant, through the Merchant clearing account.
   * Throws CardDeclinedError if the account isn't the customer's, the amount isn't above zero, or the account
   * holds less than the amount.
   */
  cardPurchase(customer: Customer, purchase: CardPurchase): PostedCardPurchase;
}

interface DuePaycheck {
  customer: Customer;
  payroll: Payroll;
  payDate: LocalDate;
}

function isPayday(payroll: Payroll, date: LocalDate): boolean {
  const days = daysBetween(payroll.firstPayDate, date);
  return days >= 0 && days % payroll.intervalDays === 0;
}

export function createSimulator(deps: {
  clock: SettableClock;
  systemData: SystemData;
  customerData: CustomerData;
}): Simulator {
  const { clock, systemData, customerData } = deps;

  /** Paychecks due after `after` and on or before `through`, in date order, then customer and payroll order. */
  function paychecksDue(after: LocalDate, through: LocalDate): DuePaycheck[] {
    const payrolls = systemData
      .listCustomers()
      .flatMap((customer) => customerData.listPayrolls(customer).map((payroll) => ({ customer, payroll })));
    const due: DuePaycheck[] = [];
    for (let payDate = addDays(after, 1); payDate <= through; payDate = addDays(payDate, 1)) {
      for (const { customer, payroll } of payrolls) {
        if (isPayday(payroll, payDate)) due.push({ customer, payroll, payDate });
      }
    }
    return due;
  }

  function postPaychecks(due: DuePaycheck[]): PostedPaycheck[] {
    return due.map(({ customer, payroll, payDate }) => {
      const employer = EMPLOYERS[payroll.employer];
      const posted = customerData.postLedgerTransaction(customer, {
        idempotencyKey: `payroll:${payroll.employer}:${payDate}`,
        description: `Paycheck from ${employer.name}`,
        entries: [
          { accountId: systemData.ensureSystemAccount(employer.clearingAccount), amount: cents(-payroll.amount) },
          { accountId: payroll.accountId, amount: payroll.amount },
        ],
      });
      return {
        customerId: customer.id,
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
      const now = sameTimeNextDay(before);
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
