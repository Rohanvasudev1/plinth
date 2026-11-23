import { sql } from "drizzle-orm";
import { check, index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

/** The app's simulated time. It holds at most one row, with id 1. */
export const simulatedClockTable = sqliteTable("simulated_clock", {
  id: integer("id").primaryKey(),
  nowMs: integer("now_ms").notNull(),
});

/** A seeded customer. Sign-in picks one of these. */
export const customersTable = sqliteTable("customers", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull().unique(),
});

/**
 * Customer accounts (checking, savings) and system accounts.
 * A system account has no customer and a unique `system_key`: one clearing account per simulated
 * outside institution, plus the opening-balances account that funds seeded balances.
 */
export const accountsTable = sqliteTable(
  "accounts",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    customerId: integer("customer_id").references(() => customersTable.id),
    kind: text("kind", { enum: ["checking", "savings", "system"] }).notNull(),
    name: text("name").notNull(),
    systemKey: text("system_key").unique(),
    /** The Goal's target amount, only on savings accounts that have one. */
    goalCents: integer("goal_cents"),
  },
  (table) => [
    index("accounts_customer_id").on(table.customerId),
    check(
      "accounts_owner",
      sql`(${table.kind} = 'system') = (${table.customerId} IS NULL AND ${table.systemKey} IS NOT NULL)`,
    ),
    check("accounts_goal_on_savings", sql`${table.goalCents} IS NULL OR (${table.kind} = 'savings' AND ${table.goalCents} > 0)`),
  ],
);

/** A group of entries that sum to zero, posted for one customer under an idempotency key unique to that customer. */
export const ledgerTransactionsTable = sqliteTable(
  "ledger_transactions",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    customerId: integer("customer_id")
      .notNull()
      .references(() => customersTable.id),
    idempotencyKey: text("idempotency_key").notNull(),
    description: text("description").notNull(),
    postedAtMs: integer("posted_at_ms").notNull(),
  },
  (table) => [uniqueIndex("ledger_transactions_customer_key").on(table.customerId, table.idempotencyKey)],
);

/**
 * One signed amount in cents on one account. Rows are never updated or deleted.
 * Entries carry no customer_id: the outside side sits on a system account, so an entry is scoped
 * through its ledger transaction, which does.
 */
export const ledgerEntriesTable = sqliteTable(
  "ledger_entries",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    ledgerTransactionId: integer("ledger_transaction_id")
      .notNull()
      .references(() => ledgerTransactionsTable.id),
    accountId: integer("account_id")
      .notNull()
      .references(() => accountsTable.id),
    amountCents: integer("amount_cents").notNull(),
  },
  (table) => [
    index("ledger_entries_account_id").on(table.accountId),
    index("ledger_entries_ledger_transaction_id").on(table.ledgerTransactionId),
  ],
);

/** The outbox: one row per posted ledger transaction, written in the same database transaction. */
export const ledgerEventsTable = sqliteTable("ledger_events", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  customerId: integer("customer_id")
    .notNull()
    .references(() => customersTable.id),
  ledgerTransactionId: integer("ledger_transaction_id")
    .notNull()
    .unique()
    .references(() => ledgerTransactionsTable.id),
  createdAtMs: integer("created_at_ms").notNull(),
});

/**
 * A simulated employer's standing order to pay one customer a fixed amount into one of their accounts,
 * every `interval_days` days from `first_pay_date` (a YYYY-MM-DD date in the bank's time zone).
 * `employer` names an entry in the payroll adapter's employer list.
 */
export const payrollsTable = sqliteTable(
  "payrolls",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    customerId: integer("customer_id")
      .notNull()
      .references(() => customersTable.id),
    accountId: integer("account_id")
      .notNull()
      .references(() => accountsTable.id),
    employer: text("employer").notNull(),
    amountCents: integer("amount_cents").notNull(),
    firstPayDate: text("first_pay_date").notNull(),
    intervalDays: integer("interval_days").notNull(),
  },
  (table) => [
    index("payrolls_customer_id").on(table.customerId),
    check("payrolls_amount_positive", sql`${table.amountCents} > 0`),
    check("payrolls_interval_positive", sql`${table.intervalDays} > 0`),
  ],
);

/**
 * A Scheduled bill: the customer pays `payee` a fixed amount from one of their accounts on the same day
 * every month. In a month shorter than `day_of_month`, the bill falls due on the month's last day.
 */
export const scheduledBillsTable = sqliteTable(
  "scheduled_bills",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    customerId: integer("customer_id")
      .notNull()
      .references(() => customersTable.id),
    accountId: integer("account_id")
      .notNull()
      .references(() => accountsTable.id),
    payee: text("payee").notNull(),
    amountCents: integer("amount_cents").notNull(),
    dayOfMonth: integer("day_of_month").notNull(),
  },
  (table) => [
    index("scheduled_bills_customer_id").on(table.customerId),
    check("scheduled_bills_amount_positive", sql`${table.amountCents} > 0`),
    check("scheduled_bills_day_of_month", sql`${table.dayOfMonth} BETWEEN 1 AND 31`),
  ],
);
