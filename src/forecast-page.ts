import {
  addDays,
  dayOfMonth,
  daysInMonth,
  firstOfMonth,
  firstOfNextMonth,
  firstOfPreviousMonth,
  localDateOf,
  type LocalDate,
} from "./calendar";
import { CATEGORIES, type Category } from "./categories";
import type { Customer, CustomerData, LedgerTransaction } from "./customer-data";
import { cents, divideCents, type Cents } from "./money";
import { billsDue } from "./schedules";
import { isBillPayment } from "./simulator";

/** A Category that counts as spending: every Category except Income and Savings. */
type SpendingCategory = Exclude<Category, "Income" | "Savings">;

const SPENDING_CATEGORIES = CATEGORIES.filter(
  (category): category is SpendingCategory => category !== "Income" && category !== "Savings",
);

/** How many full calendar months the Usual month averages over, at most. */
const USUAL_MONTH_SPAN = 6;

/** One Category's spending in the Usual month and this month On pace. */
export interface CategoryFigures {
  category: SpendingCategory;
  usualMonth: Cents;
  onPace: Cents;
}

/** The figures on the Forecast page. */
export interface ForecastFigures {
  kind: "figures";
  /** The first day of this month, the month On pace is for. */
  month: LocalDate;
  /** How many full calendar months the Usual month averages over, from 1 to 6. */
  fullMonths: number;
  usualMonth: { income: Cents; spending: Cents };
  onPace: { spending: Cents };
  /** Usual month income minus spending, for the Usual month and On pace. Below zero when spending is higher. */
  leftToSave: { usualMonth: Cents; onPace: Cents };
  /** Every spending Category with spending in the Usual month or this month, in Category order. */
  categories: CategoryFigures[];
}

/** What the Forecast page shows: its figures, or that there isn't enough history to work them out. */
export type ForecastPage = ForecastFigures | { kind: "not_enough_history" };

/** A paycheck or a piece of spending, as the amount that reached or left the customer's own accounts. */
interface CountedTransaction {
  date: LocalDate;
  category: "Income" | SpendingCategory;
  /** Always positive: money in for income, money out for spending. */
  amount: Cents;
  /** True for a Scheduled bill payment, which On pace counts at the bill's full amount rather than scaling. */
  bill: boolean;
}

/**
 * The Forecast page for the customer on `today`.
 *
 * The Usual month averages the last six full calendar months before this one, or fewer when the customer's history
 * is shorter. History starts on the day of the customer's first paycheck, Card purchase or Scheduled bill, and a month
 * is full when it starts on or after that day. Income is Category Income. Spending is
 * every other Category except Savings, so moves between the customer's own accounts and opening balances, which
 * have no Category, count as neither.
 *
 * On pace is this month's Card purchases through today × the days in the month ÷ the days elapsed, counting today,
 * since today's purchases are in the total, plus the full amount of every Scheduled bill due this month, paid yet or
 * not. Scaling a bill would make Rent paid on the 1st look like thirty Rents.
 */
export function readForecastPage(customerData: CustomerData, customer: Customer, today: LocalDate): ForecastPage {
  const ownAccountIds = new Set(customerData.listAccounts(customer).map((account) => account.id));
  const counted = customerData.listLedgerTransactions(customer).flatMap((transaction) => countedTransaction(transaction, ownAccountIds));
  const months = fullMonths(counted, today);
  if (months.length === 0) return { kind: "not_enough_history" };

  const month = firstOfMonth(today);
  const inUsualMonths = counted.filter((transaction) => months.includes(firstOfMonth(transaction.date)));
  const purchasesSoFar = counted.filter(
    (transaction) => !transaction.bill && transaction.date >= month && transaction.date <= today,
  );
  const billsThisMonth: CountedTransaction[] = billsDue(
    customerData.listScheduledBills(customer),
    addDays(month, -1),
    addDays(firstOfNextMonth(month), -1),
  ).flatMap(({ bill, dueDate }) =>
    bill.category === null || bill.category === "Income" || bill.category === "Savings"
      ? []
      : [{ date: dueDate, category: bill.category, amount: bill.amount, bill: true }],
  );
  const usual = (transactions: CountedTransaction[]) => divideCents(totalOf(transactions), months.length);
  const onPace = (purchases: CountedTransaction[], bills: CountedTransaction[]) =>
    cents(divideCents(totalOf(purchases) * daysInMonth(today), dayOfMonth(today)) + totalOf(bills));
  const spending = (transactions: CountedTransaction[], category?: SpendingCategory) =>
    transactions.filter((transaction) =>
      category === undefined ? transaction.category !== "Income" : transaction.category === category,
    );

  const income = usual(inUsualMonths.filter((transaction) => transaction.category === "Income"));
  const usualSpending = usual(spending(inUsualMonths));
  const onPaceSpending = onPace(spending(purchasesSoFar), billsThisMonth);
  return {
    kind: "figures",
    month,
    fullMonths: months.length,
    usualMonth: { income, spending: usualSpending },
    onPace: { spending: onPaceSpending },
    leftToSave: { usualMonth: cents(income - usualSpending), onPace: cents(income - onPaceSpending) },
    categories: SPENDING_CATEGORIES.map((category) => ({
      category,
      usualMonth: usual(spending(inUsualMonths, category)),
      onPace: onPace(spending(purchasesSoFar, category), spending(billsThisMonth, category)),
    })).filter((row) => row.usualMonth !== 0 || row.onPace !== 0),
  };
}

/** The first day of each full calendar month the Usual month averages over, newest first. */
function fullMonths(counted: CountedTransaction[], today: LocalDate): LocalDate[] {
  const historyStarts = earliest(counted.map((transaction) => transaction.date));
  if (historyStarts === null) return [];
  const start = historyStarts === firstOfMonth(historyStarts) ? historyStarts : firstOfNextMonth(historyStarts);
  const months: LocalDate[] = [];
  for (let month = firstOfPreviousMonth(today); month >= start && months.length < USUAL_MONTH_SPAN; month = firstOfPreviousMonth(month)) {
    months.push(month);
  }
  return months;
}

function countedTransaction(transaction: LedgerTransaction, ownAccountIds: Set<number>): CountedTransaction[] {
  const { category } = transaction;
  if (category === null || category === "Savings") return [];
  const net = transaction.entries
    .filter((entry) => ownAccountIds.has(entry.accountId))
    .reduce((sum, entry) => sum + entry.amount, 0);
  return [
    {
      date: localDateOf(transaction.postedAt),
      category,
      amount: cents(category === "Income" ? net : -net),
      bill: isBillPayment(transaction),
    },
  ];
}

function earliest(dates: LocalDate[]): LocalDate | null {
  return dates.reduce<LocalDate | null>((first, date) => (first === null || date < first ? date : first), null);
}

function totalOf(transactions: CountedTransaction[]): Cents {
  return cents(transactions.reduce((sum, transaction) => sum + transaction.amount, 0));
}
