import { datesAfterThrough, localDateOf, sameTimeNextDay, type LocalDate } from "./calendar";
import type { SettableClock } from "./clock";
import type { Customer, CustomerData, Payroll, ScheduledBill } from "./customer-data";
import { cents, type Cents } from "./money";
import { isBillDue, isPayday } from "./schedules";
import { EMPLOYERS, type SystemData } from "./system-data";

interface PostedMoney {
  customerId: number;
  /** The customer's account the money went into or came out of. */
  accountId: number;
  /** The pay date or due date. */
  date: LocalDate;
  amount: Cents;
  ledgerTransactionId: number;
  /** False when this had already posted, in which case nothing changed. */
  created: boolean;
}

/** A simulated employer's paycheck into a customer's account. */
export interface PostedPaycheck extends PostedMoney {
  kind: "paycheck";
  employerName: string;
}

/** A Scheduled bill paid from a customer's account to the simulated Biller. */
export interface PostedBill extends PostedMoney {
  kind: "bill";
  billId: number;
  payee: string;
}

export type Posting = PostedPaycheck | PostedBill;

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
  /**
   * The paychecks and Scheduled bills whose dates the clock passed, in the order they posted: by date,
   * and on a date with both, paychecks before bills.
   */
  postings: Posting[];
}

/** The outside institutions the bank talks to, simulated: employers paying in, merchants, and the clock they share. */
export interface Simulator {
  /** Posts every customer's paycheck due today. Posting a paycheck that already posted changes nothing. */
  postPaycheck(): PostedPaycheck[];
  /**
   * Moves the clock to the same time of day on the next date and posts, in date order, every paycheck
   * and Scheduled bill whose date it passed, all in one database transaction. If a posting fails, the
   * clock stays where it was and nothing posts.
   */
  advanceClock(): AdvancedClock;
  /**
   * Spends from one of the customer's accounts at a simulated merchant, through the Merchant clearing account.
   * Throws CardDeclinedError if the account isn't the customer's, the amount isn't above zero, or the account
   * holds less than the amount.
   */
  cardPurchase(customer: Customer, purchase: CardPurchase): PostedCardPurchase;
}

interface PaycheckToPost {
  kind: "paycheck";
  customer: Customer;
  payroll: Payroll;
  date: LocalDate;
}

interface BillToPost {
  kind: "bill";
  customer: Customer;
  bill: ScheduledBill;
  date: LocalDate;
}

export function createSimulator(deps: {
  clock: SettableClock;
  systemData: SystemData;
  customerData: CustomerData;
}): Simulator {
  const { clock, systemData, customerData } = deps;

  /** Every customer's paychecks paid on `date`, in customer order and the order each payroll was set up. */
  function paychecksOn(date: LocalDate): PaycheckToPost[] {
    return systemData.listCustomers().flatMap((customer) =>
      customerData
        .listPayrolls(customer)
        .filter((payroll) => isPayday(payroll, date))
        .map((payroll) => ({ kind: "paycheck" as const, customer, payroll, date })),
    );
  }

  /** Every customer's Scheduled bills due on `date`, in customer order and the order each bill was set up. */
  function billsOn(date: LocalDate): BillToPost[] {
    return systemData.listCustomers().flatMap((customer) =>
      customerData
        .listScheduledBills(customer)
        .filter((bill) => isBillDue(bill, date))
        .map((bill) => ({ kind: "bill" as const, customer, bill, date })),
    );
  }

  function postPaycheckDue({ customer, payroll, date }: PaycheckToPost): PostedPaycheck {
    const employer = EMPLOYERS[payroll.employer];
    const posted = customerData.postLedgerTransaction(customer, {
      idempotencyKey: `payroll:${payroll.employer}:${date}`,
      description: `Paycheck from ${employer.name}`,
      entries: [
        { accountId: systemData.ensureSystemAccount(employer.clearingAccount), amount: cents(-payroll.amount) },
        { accountId: payroll.accountId, amount: payroll.amount },
      ],
    });
    return {
      kind: "paycheck",
      customerId: customer.id,
      accountId: payroll.accountId,
      employerName: employer.name,
      date,
      amount: payroll.amount,
      ledgerTransactionId: posted.ledgerTransactionId,
      created: posted.created,
    };
  }

  function postBillDue({ customer, bill, date }: BillToPost): PostedBill {
    const posted = customerData.postLedgerTransaction(customer, {
      idempotencyKey: `bill:${bill.id}:${date}`,
      description: `${bill.payee} bill`,
      entries: [
        { accountId: bill.accountId, amount: cents(-bill.amount) },
        { accountId: systemData.ensureSystemAccount("biller"), amount: bill.amount },
      ],
    });
    return {
      kind: "bill",
      customerId: customer.id,
      accountId: bill.accountId,
      billId: bill.id,
      payee: bill.payee,
      date,
      amount: bill.amount,
      ledgerTransactionId: posted.ledgerTransactionId,
      created: posted.created,
    };
  }

  return {
    postPaycheck() {
      const today = localDateOf(clock.now());
      return paychecksOn(today).map(postPaycheckDue);
    },
    advanceClock() {
      // The clock is read, moved and posted against in one transaction, so two advances can't both start
      // from the same day, and the postings read the new time. A clock kept outside the database doesn't
      // roll back with the transaction, so it is put back by hand on failure.
      return customerData.inOneTransaction(() => {
        const before = clock.now();
        const now = sameTimeNextDay(before);
        clock.setTo(now);
        try {
          // On each date, paychecks post before bills.
          const postings: Posting[] = [...datesAfterThrough(localDateOf(before), localDateOf(now))].flatMap((date) => [
            ...paychecksOn(date).map(postPaycheckDue),
            ...billsOn(date).map(postBillDue),
          ]);
          return { now, postings };
        } catch (error) {
          clock.setTo(before);
          throw error;
        }
      });
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
