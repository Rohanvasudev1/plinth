import { addDays, datesAfterThrough, localDateOf, type LocalDate } from "./calendar";
import type { Customer, CustomerData } from "./customer-data";
import { cents, type Cents } from "./money";
import { bufferRuleFor } from "./rules";
import { billsBeforePayday, safeToSpend } from "./safe-to-spend";
import { isBillDue, isPayday } from "./schedules";
import { checkSweepGuardrails, chooseSweepRoute, sweepAmount } from "./sweep";

/** How many days the Forecast runs for, after today. */
export const FORECAST_DAYS = 30;

/** How many days before today the daily allowance averages Card purchases over. */
const ALLOWANCE_DAYS = 90;

/** The checking balance expected at the end of one date. */
export interface ForecastDay {
  date: LocalDate;
  balance: Cents;
}

/**
 * The Forecast: the expected checking balance at the end of each of the 30 days after today, worked out from the
 * ledger when read.
 */
export interface Forecast {
  /** Today and today's checking balance, which the Forecast starts from. */
  start: ForecastDay;
  /** The 30 days after today, in date order. */
  days: ForecastDay[];
  /** The Buffer of the checking account's buffer Rule, or null without one. */
  buffer: Cents | null;
  /** The day with the lowest balance, the earliest if several tie. */
  lowest: ForecastDay;
  /** The usual day-to-day spending taken off each day: Card purchases over the 90 days before today, a day. */
  dailyAllowance: Cents;
}

/**
 * The customer's Forecast for their checking account, or null if they have none. Each day adds the paychecks paid
 * into checking, then subtracts the sweep the buffer Rule would make after each one, then the Scheduled bills due
 * from checking, then the daily allowance. A sweep counts only when the agent would make it alone: the Autonomy
 * level lets it act alone for that amount and the guardrails pass, as they do for the real Sweep.
 */
export function readForecast(
  deps: { customerData: CustomerData; merchantClearingAccountId: number },
  customer: Customer,
  now: Date,
): Forecast | null {
  const { customerData } = deps;
  const checking = customerData.listAccounts(customer).find((account) => account.kind === "checking");
  if (!checking) return null;
  const today = localDateOf(now);
  const payrolls = customerData.listPayrolls(customer).filter((payroll) => payroll.accountId === checking.id);
  const bills = customerData.listScheduledBills(customer).filter((bill) => bill.accountId === checking.id);
  const rules = customerData.listRules(customer);
  const rule = bufferRuleFor(rules, checking.id);
  const settings = customerData.getSettings(customer);
  const dailyAllowance = averageDailyCardPurchases(deps, customer, today);

  /** What the agent would sweep after a paycheck on `date` leaves `balance` in checking, or zero. */
  const sweepAfterPaycheck = (date: LocalDate, balance: Cents): Cents => {
    // Like the buffer agent: no settings record means setup isn't finished, and a Rule needs a sweep target.
    if (!settings || !rule?.on || rule.parameters.savingsAccountId === null) return cents(0);
    const savings = customerData.getAccount(customer, rule.parameters.savingsAccountId);
    const billsBefore = billsBeforePayday(customerData, customer, date);
    const projected = { ...checking, balance };
    const amount = sweepAmount(safeToSpend(projected, rule.parameters.buffer, billsBefore));
    const route = chooseSweepRoute(settings.autonomyLevel, rules, amount);
    if (route.route !== "act") return cents(0);
    const check = checkSweepGuardrails(customerData, {
      customer,
      rule,
      checking: projected,
      savings,
      amount,
      bills: billsBefore,
      approval: route.approval,
    });
    return check.refusal ? cents(0) : amount;
  };

  let balance = checking.balance;
  const days: ForecastDay[] = [];
  for (const date of datesAfterThrough(today, addDays(today, FORECAST_DAYS))) {
    for (const payroll of payrolls.filter((candidate) => isPayday(candidate, date))) {
      balance = cents(balance + payroll.amount);
      balance = cents(balance - sweepAfterPaycheck(date, balance));
    }
    for (const bill of bills.filter((candidate) => isBillDue(candidate, date))) balance = cents(balance - bill.amount);
    balance = cents(balance - dailyAllowance);
    days.push({ date, balance });
  }
  const lowest = days.reduce((low, day) => (day.balance < low.balance ? day : low));
  return {
    start: { date: today, balance: checking.balance },
    days,
    buffer: rule ? rule.parameters.buffer : null,
    lowest,
    dailyAllowance,
  };
}

/** Card purchases from any of the customer's accounts in the 90 days before today, averaged per day, to the cent. */
function averageDailyCardPurchases(
  deps: { customerData: CustomerData; merchantClearingAccountId: number },
  customer: Customer,
  today: LocalDate,
): Cents {
  const from = addDays(today, -ALLOWANCE_DAYS);
  const total = deps.customerData
    .listLedgerTransactions(customer)
    .filter((transaction) => {
      const date = localDateOf(transaction.postedAt);
      return date >= from && date < today;
    })
    .flatMap((transaction) => transaction.entries)
    .filter((entry) => entry.accountId === deps.merchantClearingAccountId)
    .reduce((sum, entry) => sum + entry.amount, 0);
  return cents(Math.round(total / ALLOWANCE_DAYS));
}
