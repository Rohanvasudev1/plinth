import { addDays, daysBetween, daysInMonth, type LocalDate } from "./calendar";
import type { Payroll, ScheduledBill } from "./customer-data";
import { cents, type Cents } from "./money";

/** One Scheduled bill falling due on one date. */
export interface DueBill {
  bill: ScheduledBill;
  dueDate: LocalDate;
}

export function isPayday(payroll: Payroll, date: LocalDate): boolean {
  const days = daysBetween(payroll.firstPayDate, date);
  return days >= 0 && days % payroll.intervalDays === 0;
}

/** The first date after `today` on which any of the payrolls pays, or null if there are no payrolls. */
export function nextPayday(payrolls: Payroll[], today: LocalDate): LocalDate | null {
  let next: LocalDate | null = null;
  for (const payroll of payrolls) {
    const days = daysBetween(payroll.firstPayDate, today);
    const candidate =
      days < 0
        ? payroll.firstPayDate
        : addDays(payroll.firstPayDate, (Math.floor(days / payroll.intervalDays) + 1) * payroll.intervalDays);
    if (next === null || candidate < next) next = candidate;
  }
  return next;
}

/** Whether the bill falls due on `date`: its day of the month, or the month's last day in a shorter month. */
export function isBillDue(bill: ScheduledBill, date: LocalDate): boolean {
  const day = Number(date.slice(8, 10));
  return day === Math.min(bill.dayOfMonth, daysInMonth(date));
}

/** The bills falling due after `after` and on or before `through`, in date order, then in the order given. */
export function billsDue(bills: ScheduledBill[], after: LocalDate, through: LocalDate): DueBill[] {
  const due: DueBill[] = [];
  for (let date = addDays(after, 1); date <= through; date = addDays(date, 1)) {
    for (const bill of bills) {
      if (isBillDue(bill, date)) due.push({ bill, dueDate: date });
    }
  }
  return due;
}

export function totalOf(due: DueBill[]): Cents {
  return cents(due.reduce((sum, { bill }) => sum + bill.amount, 0));
}
