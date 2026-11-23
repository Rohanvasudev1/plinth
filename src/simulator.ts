import { addDays, localDateOf, sameTimeNextDay, type LocalDate } from "./calendar";
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

type DuePaycheck = { kind: "paycheck"; customer: Customer; payroll: Payroll; date: LocalDate };
type DueBill = { kind: "bill"; customer: Customer; bill: ScheduledBill; date: LocalDate };
type DuePosting = DuePaycheck | DueBill;

export function createSimulator(deps: {
  clock: SettableClock;
  systemData: SystemData;
  customerData: CustomerData;
}): Simulator {
  const { clock, systemData, customerData } = deps;

  /**
   * Paychecks and bills due after `after` and on or before `through`. In date order; on each date,
   * paychecks before bills, then in customer order and the order each was set up.
   */
  function postingsDue(after: LocalDate, through: LocalDate, kinds: DuePosting["kind"][]): DuePosting[] {
    const customers = systemData.listCustomers();
    const payrolls = kinds.includes("paycheck")
      ? customers.flatMap((customer) => customerData.listPayrolls(customer).map((payroll) => ({ customer, payroll })))
      : [];
    const bills = kinds.includes("bill")
      ? customers.flatMap((customer) => customerData.listScheduledBills(customer).map((bill) => ({ customer, bill })))
      : [];
    const due: DuePosting[] = [];
    for (let date = addDays(after, 1); date <= through; date = addDays(date, 1)) {
      for (const { customer, payroll } of payrolls) {
        if (isPayday(payroll, date)) due.push({ kind: "paycheck", customer, payroll, date });
      }
      for (const { customer, bill } of bills) {
        if (isBillDue(bill, date)) due.push({ kind: "bill", customer, bill, date });
      }
    }
    return due;
  }

  function postPaycheckDue({ customer, payroll, date }: DuePaycheck): PostedPaycheck {
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

  function postBillDue({ customer, bill, date }: DueBill): PostedBill {
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

  function post(due: DuePosting): Posting {
    return due.kind === "paycheck" ? postPaycheckDue(due) : postBillDue(due);
  }

  return {
    postPaycheck() {
      const today = localDateOf(clock.now());
      return postingsDue(addDays(today, -1), today, ["paycheck"])
        .filter((due): due is DuePaycheck => due.kind === "paycheck")
        .map(postPaycheckDue);
    },
    advanceClock() {
      const before = clock.now();
      const now = sameTimeNextDay(before);
      const due = postingsDue(localDateOf(before), localDateOf(now), ["paycheck", "bill"]);
      // The postings read the new time, so the clock moves inside the same transaction. A clock kept
      // outside the database doesn't roll back with it, so it is put back by hand on failure.
      return customerData.inOneTransaction(() => {
        clock.setTo(now);
        try {
          return { now, postings: due.map(post) };
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
