import { addDays, datesAfterThrough, dayOfMonth, daysBetween, daysInMonth, type LocalDate } from "./calendar";
import type { Payroll, ScheduledBill } from "./customer-data";
import { cents, type Cents } from "./money";

/** One Scheduled bill falling due on one date. */
export interface DueBill {
  bill: ScheduledBill;
  dueDate: LocalDate;
}

/** Whether `date` falls on the payroll's pay cycle, counting back from its first pay date as well as forward. */
export function isOnPayCycle(payroll: Payroll, date: LocalDate): boolean {
  return daysBetween(payroll.firstPayDate, date) % payroll.intervalDays === 0;
}

export function isPayday(payroll: Payroll, date: LocalDate): boolean {
  return date >= payroll.firstPayDate && isOnPayCycle(payroll, date);
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
  return dayOfMonth(date) === Math.min(bill.dayOfMonth, daysInMonth(date));
}

/** The bills falling due after `after` and on or before `through`, in date order, then in the order given. */
export function billsDue(bills: ScheduledBill[], after: LocalDate, through: LocalDate): DueBill[] {
  return [...datesAfterThrough(after, through)].flatMap((date) =>
    bills.filter((bill) => isBillDue(bill, date)).map((bill) => ({ bill, dueDate: date })),
  );
}

export function totalOf(due: DueBill[]): Cents {
  return cents(due.reduce((sum, { bill }) => sum + bill.amount, 0));
}
