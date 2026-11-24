import { addDays, localDate, localDateOf, type LocalDate } from "./calendar";
import type { Clock } from "./clock";
import type { Account, Customer, CustomerData } from "./customer-data";
import { readForecast } from "./forecast";
import { readForecastPage } from "./forecast-page";
import { MISSION_PROGRESS, MISSION_READ_ITEMS, missionToolSource, type MissionProgressLabel } from "./mission-text";
import { MissionError, type MissionRead } from "./missions";
import { projectionLines } from "./projection";

// The tools a Mission's language model reads the customer's data with (ADR 0009). Each one only reads, and only the
// asking customer's data, through the customer data layer (ADR 0004). Results name accounts by their Plinth account
// name and carry no customer name or account id. Money is in whole cents, in fields ending `Cents`.

/** The longest period one read_transactions call may cover. */
const MAX_TRANSACTION_DAYS = 366;

/** What the Mission tools read through: the clock for today, the customer data layer, and the merchant clearing account the Forecast needs. */
export interface MissionToolDeps {
  clock: Clock;
  customerData: CustomerData;
  merchantClearingAccountId: number;
}

export const MISSION_TOOL_NAMES = [
  "read_transactions",
  "read_usual_month",
  "read_forecast",
  "read_projection",
  "read_goals",
  "read_scheduled_bills",
] as const;
export type MissionToolName = (typeof MISSION_TOOL_NAMES)[number];

/** A tool as the language model is told about it: its name, what it reads, and a JSON schema for its input. */
export interface MissionToolDefinition {
  name: MissionToolName;
  description: string;
  inputSchema: { type: "object"; properties: Record<string, unknown>; required: string[]; additionalProperties: false };
}

const NO_INPUT: MissionToolDefinition["inputSchema"] = {
  type: "object",
  properties: {},
  required: [],
  additionalProperties: false,
};

const TOOLS: Record<
  MissionToolName,
  { description: string; inputSchema: MissionToolDefinition["inputSchema"]; progress: MissionProgressLabel }
> = {
  read_transactions: {
    description:
      "The customer's posted transactions from `from` to `to` (YYYY-MM-DD, inclusive, at most a year), oldest first. " +
      "amountCents is negative for money out of the account and positive for money in.",
    inputSchema: {
      type: "object",
      properties: { from: { type: "string", format: "date" }, to: { type: "string", format: "date" } },
      required: ["from", "to"],
      additionalProperties: false,
    },
    progress: MISSION_PROGRESS.transactions,
  },
  read_usual_month: {
    description:
      "The Usual month of income and spending, averaged over up to six full calendar months, this month's spending " +
      "On pace, and Left to save, with spending by Category. Says not_enough_history when there is no full month.",
    inputSchema: NO_INPUT,
    progress: MISSION_PROGRESS.usualMonth,
  },
  read_forecast: {
    description: "The 30-day Forecast of the checking balance: today's balance, the lowest day, the Buffer and the daily allowance.",
    inputSchema: NO_INPUT,
    progress: MISSION_PROGRESS.forecastAndGoals,
  },
  read_projection: {
    description:
      "The 3-year Projection of the sweep target Goal account: its balance today, the monthly saving at the Usual " +
      "month and On pace, and the balance after 12 and 36 months at each.",
    inputSchema: NO_INPUT,
    progress: MISSION_PROGRESS.forecastAndGoals,
  },
  read_goals: {
    description: "The customer's Goal accounts: each one's name, savings goal, balance and target.",
    inputSchema: NO_INPUT,
    progress: MISSION_PROGRESS.forecastAndGoals,
  },
  read_scheduled_bills: {
    description: "The customer's Scheduled bills: payee, amount, day of the month, Category and the account they're paid from.",
    inputSchema: NO_INPUT,
    progress: MISSION_PROGRESS.forecastAndGoals,
  },
};

export const MISSION_TOOL_DEFINITIONS: MissionToolDefinition[] = MISSION_TOOL_NAMES.map((name) => ({
  name,
  description: TOOLS[name].description,
  inputSchema: TOOLS[name].inputSchema,
}));

export function isMissionToolName(name: string): name is MissionToolName {
  return (MISSION_TOOL_NAMES as readonly string[]).includes(name);
}

/**
 * One tool call's outcome: its result for the model, what it read, the Source of any fact citing it, and the
 * progress label the Mission shows while it uses the tool.
 */
export interface MissionToolOutcome {
  result: unknown;
  read: MissionRead;
  source: string;
  progress: MissionProgressLabel;
}

/**
 * Runs one Mission tool for the customer. Throws MissionError for an unknown tool or input it can't read, such as a
 * period longer than a year.
 */
export function runMissionTool(
  deps: MissionToolDeps,
  customer: Customer,
  tool: string,
  input: unknown,
): MissionToolOutcome {
  if (!isMissionToolName(tool)) throw new MissionError(`No Mission tool ${tool}`);
  const { result, read } = readWith(deps, customer, tool, input);
  return { result, read, source: missionToolSource(tool, read.item), progress: TOOLS[tool].progress };
}

function readWith(
  deps: MissionToolDeps,
  customer: Customer,
  tool: MissionToolName,
  input: unknown,
): Pick<MissionToolOutcome, "result" | "read"> {
  const { clock, customerData } = deps;
  const today = localDateOf(clock.now());
  const accounts = customerData.listAccounts(customer);
  const accountName = (accountId: number) => accounts.find((account) => account.id === accountId)?.name;

  switch (tool) {
    case "read_transactions": {
      const { from, to } = period(input, today);
      const item = MISSION_READ_ITEMS.transactions(from, to);
      const transactions = customerData.listLedgerTransactions(customer).flatMap((transaction) => {
        const date = localDateOf(transaction.postedAt);
        // Opening balances have no Category: they are how the seed funds an account, not something the customer did.
        if (date < from || date > to || transaction.category === null) return [];
        return transaction.entries.flatMap((entry) => {
          const account = accountName(entry.accountId);
          if (account === undefined) return [];
          return [
            {
              date,
              description: transaction.description,
              counterparty: transaction.counterparty,
              category: transaction.category,
              account,
              amountCents: entry.amount,
            },
          ];
        });
      });
      return { result: { from, to, transactions }, read: { tool, item } };
    }
    case "read_usual_month": {
      const page = readForecastPage(customerData, customer, today);
      const read = { tool, item: MISSION_READ_ITEMS.usualMonth };
      if (page.kind === "not_enough_history") return { result: { kind: "not_enough_history" }, read };
      return {
        result: {
          kind: "figures",
          month: page.month,
          fullMonths: page.fullMonths,
          usualMonth: { incomeCents: page.usualMonth.income, spendingCents: page.usualMonth.spending },
          onPace: { spendingCents: page.onPace.spending },
          leftToSave: { usualMonthCents: page.leftToSave.usualMonth, onPaceCents: page.leftToSave.onPace },
          categories: page.categories.map((figures) => ({
            category: figures.category,
            usualMonthCents: figures.usualMonth,
            onPaceCents: figures.onPace,
          })),
        },
        read,
      };
    }
    case "read_forecast": {
      const forecast = readForecast(deps, customer, clock.now());
      const read = { tool, item: MISSION_READ_ITEMS.forecast(today) };
      if (!forecast) return { result: { kind: "no_checking_account" }, read };
      return {
        result: {
          kind: "forecast",
          account: accountName(accounts.find((account) => account.kind === "checking")?.id ?? -1) ?? "Checking",
          today: { date: forecast.start.date, balanceCents: forecast.start.balance },
          lowest: { date: forecast.lowest.date, balanceCents: forecast.lowest.balance },
          last: { date: forecast.days.at(-1)?.date, balanceCents: forecast.days.at(-1)?.balance },
          bufferCents: forecast.buffer,
          dailyAllowanceCents: forecast.dailyAllowance,
        },
        read,
      };
    }
    case "read_projection": {
      const page = readForecastPage(customerData, customer, today);
      const read = { tool, item: MISSION_READ_ITEMS.projection };
      if (page.kind === "not_enough_history") return { result: { kind: "not_enough_history" }, read };
      if (page.projection.kind !== "projection") return { result: { kind: "no_sweep_target" }, read };
      const lines = projectionLines(page.projection, 0);
      const line = (pace: typeof lines.usualMonth) => ({
        monthlySavingCents: pace.monthlySaving,
        after12MonthsCents: pace.balances[11],
        after36MonthsCents: pace.balances[35],
      });
      return {
        result: {
          kind: "projection",
          account: page.projection.goalAccountName,
          balanceCents: page.projection.balance,
          usualMonth: line(lines.usualMonth),
          onPace: line(lines.onPace),
        },
        read,
      };
    }
    case "read_goals":
      return {
        result: {
          goals: accounts.filter(isGoalAccount).map((account) => ({
            account: account.name,
            goal: account.goal,
            balanceCents: account.balance,
            targetCents: account.goalTarget,
          })),
        },
        read: { tool, item: MISSION_READ_ITEMS.goals },
      };
    case "read_scheduled_bills":
      return {
        result: {
          bills: customerData.listScheduledBills(customer).map((bill) => ({
            payee: bill.payee,
            amountCents: bill.amount,
            dayOfMonth: bill.dayOfMonth,
            category: bill.category,
            account: accountName(bill.accountId),
          })),
        },
        read: { tool, item: MISSION_READ_ITEMS.scheduledBills },
      };
  }
}

function isGoalAccount(account: Account): boolean {
  return account.kind === "savings" && (account.goal !== null || account.goalTarget !== null);
}

/** The period a read_transactions call asks for, checked: real dates, `from` first, at most a year, none after today. */
function period(input: unknown, today: LocalDate): { from: LocalDate; to: LocalDate } {
  const { from, to } = (input ?? {}) as { from?: unknown; to?: unknown };
  if (typeof from !== "string" || typeof to !== "string") {
    throw new MissionError("read_transactions needs a from and a to date");
  }
  const start = localDate(from);
  const end = localDate(to) > today ? today : localDate(to);
  if (start > end || addDays(start, MAX_TRANSACTION_DAYS) < end) {
    throw new MissionError("read_transactions reads a period of at most a year, ending no later than today");
  }
  return { from: start, to: end };
}
