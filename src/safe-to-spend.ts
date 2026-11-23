import { addDays, type LocalDate } from "./calendar";
import type { Account, Customer, CustomerData } from "./customer-data";
import { cents, type Cents } from "./money";
import { billsDue, nextPayday, totalOf } from "./schedules";

export interface BillBeforePayday {
  billId: number;
  payee: string;
  amount: Cents;
  dueDate: LocalDate;
}

/** The customer's Scheduled bills due after today and on or before the day before the next payday. */
export interface BillsBeforePayday {
  /** Null when no payroll pays the customer, in which case no bills are listed. */
  nextPayday: LocalDate | null;
  /** In due-date order. */
  bills: BillBeforePayday[];
  total: Cents;
}

/** Safe to spend: the checking balance minus the Buffer minus Scheduled bills due before the next payday. */
export interface SafeToSpend {
  /** Below zero when checking won't cover the Buffer and the bills. */
  amount: Cents;
  checking: Cents;
  buffer: Cents;
  billsBeforePayday: Cents;
}

export function billsBeforePayday(customerData: CustomerData, customer: Customer, today: LocalDate): BillsBeforePayday {
  const payday = nextPayday(customerData.listPayrolls(customer), today);
  if (payday === null) return { nextPayday: null, bills: [], total: cents(0) };
  const due = billsDue(customerData.listScheduledBills(customer), today, addDays(payday, -1));
  return {
    nextPayday: payday,
    bills: due.map(({ bill, dueDate }) => ({ billId: bill.id, payee: bill.payee, amount: bill.amount, dueDate })),
    total: totalOf(due),
  };
}

/** Safe to spend from a checking account. Home shows it, and the Sweep moves it, rounded down to whole dollars. */
export function safeToSpend(checking: Account, buffer: Cents, bills: BillsBeforePayday): SafeToSpend {
  return {
    amount: cents(checking.balance - buffer - bills.total),
    checking: checking.balance,
    buffer,
    billsBeforePayday: bills.total,
  };
}
