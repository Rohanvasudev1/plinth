import { sql } from "drizzle-orm";
import { FINDING_KINDS, FINDING_STATES } from "../findings";
import { SAVINGS_GOALS } from "../settings";
import { check, index, integer, sqliteTable, text, uniqueIndex, type AnySQLiteColumn } from "drizzle-orm/sqlite-core";

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
    /** The savings goal this Goal account is for, such as `buy_home`. At most one account per goal per customer. */
    goal: text("goal", { enum: SAVINGS_GOALS }),
  },
  (table) => [
    index("accounts_customer_id").on(table.customerId),
    check(
      "accounts_owner",
      sql`(${table.kind} = 'system') = (${table.customerId} IS NULL AND ${table.systemKey} IS NOT NULL)`,
    ),
    check("accounts_goal_on_savings", sql`${table.goalCents} IS NULL OR (${table.kind} = 'savings' AND ${table.goalCents} > 0)`),
    check("accounts_savings_goal_on_savings", sql`${table.goal} IS NULL OR ${table.kind} = 'savings'`),
    uniqueIndex("accounts_customer_goal").on(table.customerId, table.goal),
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

/** A Rule's identity. Its content lives in `rule_versions`, one row per version (ADR 0003). */
export const rulesTable = sqliteTable(
  "rules",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    customerId: integer("customer_id")
      .notNull()
      .references(() => customersTable.id),
    kind: text("kind").notNull(),
  },
  (table) => [index("rules_customer_id").on(table.customerId)],
);

/**
 * One version of a Rule: its JSON parameters, checked against the kind's schema before they are written,
 * and its on/off switch. Rows are never updated: editing a Rule writes the next version.
 */
export const ruleVersionsTable = sqliteTable(
  "rule_versions",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    ruleId: integer("rule_id")
      .notNull()
      .references(() => rulesTable.id),
    version: integer("version").notNull(),
    parameters: text("parameters", { mode: "json" }).notNull(),
    on: integer("is_on", { mode: "boolean" }).notNull(),
    createdAtMs: integer("created_at_ms").notNull(),
  },
  (table) => [
    uniqueIndex("rule_versions_rule_version").on(table.ruleId, table.version),
    check("rule_versions_version_positive", sql`${table.version} > 0`),
  ],
);

/**
 * The Decision log: one row per agent action, with what triggered it, the Rule version it used, and its result,
 * plus one row, written by the customer, for each agent action they undo and each change they make to a Rule or
 * their settings record. Only a settings change has no Rule.
 * `why` is a JSON array of label and value pairs.
 */
export const decisionsTable = sqliteTable(
  "decisions",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    customerId: integer("customer_id")
      .notNull()
      .references(() => customersTable.id),
    createdAtMs: integer("created_at_ms").notNull(),
    actor: text("actor", { enum: ["agent", "customer"] }).notNull(),
    triggerLedgerEventId: integer("trigger_ledger_event_id").references(() => ledgerEventsTable.id),
    triggerDescription: text("trigger_description").notNull(),
    ruleId: integer("rule_id").references(() => rulesTable.id),
    ruleVersion: integer("rule_version"),
    action: text("action").notNull(),
    /** Only ever one of the customer's own accounts, or null. */
    fromAccountId: integer("from_account_id").references(() => accountsTable.id),
    toAccountId: integer("to_account_id").references(() => accountsTable.id),
    amountCents: integer("amount_cents").notNull(),
    result: text("result", { enum: ["Done", "Refused", "Reversed"] }).notNull(),
    /** The guardrail that refused the action, on a Refused entry. */
    refusedBy: text("refused_by"),
    why: text("why", { mode: "json" }).notNull(),
    /** The ledger transaction that moved the money, on a Done or Reversed entry. */
    ledgerTransactionId: integer("ledger_transaction_id").references(() => ledgerTransactionsTable.id),
    /** On a Reversed entry, the entry it reverses. Unique, so each action is undone at most once. */
    reversesDecisionId: integer("reverses_decision_id").references((): AnySQLiteColumn => decisionsTable.id),
    /** When the customer was first shown this agent action in a toast. Null until then. */
    seenAtMs: integer("seen_at_ms"),
  },
  (table) => [
    index("decisions_customer_id").on(table.customerId),
    index("decisions_trigger_ledger_event_id").on(table.triggerLedgerEventId),
    uniqueIndex("decisions_reverses_decision_id").on(table.reversesDecisionId),
    check("decisions_refused_by", sql`(${table.result} = 'Refused') = (${table.refusedBy} IS NOT NULL)`),
    check("decisions_rule_version", sql`(${table.ruleId} IS NULL) = (${table.ruleVersion} IS NULL)`),
    check("decisions_agent_uses_rule", sql`${table.actor} = 'customer' OR ${table.ruleId} IS NOT NULL`),
  ],
);

/**
 * One version of a customer's settings record (ADR 0007): the Autonomy level, the Advice setting, the raw risk
 * answers, the data choices and the ordered goal preferences. Rows are never updated: a change writes the next
 * version. A customer with no row has not finished setup.
 */
export const settingsVersionsTable = sqliteTable(
  "settings_versions",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    customerId: integer("customer_id")
      .notNull()
      .references(() => customersTable.id),
    version: integer("version").notNull(),
    autonomyLevel: text("autonomy_level", { enum: ["ask_first", "small_things", "within_rules"] }).notNull(),
    adviceSetting: text("advice_setting", { enum: ["never", "on_request", "always"] }).notNull(),
    riskMarketDrop: text("risk_market_drop", { enum: ["sell", "wait", "buy_more", "ask_me"] }).notNull(),
    riskTimeHorizon: text("risk_time_horizon", { enum: ["under_3_years", "3_to_10_years", "over_10_years"] }).notNull(),
    trainModels: integer("train_models", { mode: "boolean" }).notNull(),
    shareWithPartners: integer("share_with_partners", { mode: "boolean" }).notNull(),
    keepChatHistory: integer("keep_chat_history", { mode: "boolean" }).notNull(),
    /** A JSON array of goal keys, most important first. */
    goalPreferences: text("goal_preferences", { mode: "json" }).notNull(),
    createdAtMs: integer("created_at_ms").notNull(),
  },
  (table) => [
    uniqueIndex("settings_versions_customer_version").on(table.customerId, table.version),
    check("settings_versions_version_positive", sql`${table.version} > 0`),
  ],
);

/**
 * Each time a customer pauses or unpauses their agent. Rows are never updated: the latest row is the current
 * state, and a customer with no row has never paused.
 */
export const pauseChangesTable = sqliteTable(
  "pause_changes",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    customerId: integer("customer_id")
      .notNull()
      .references(() => customersTable.id),
    paused: integer("paused", { mode: "boolean" }).notNull(),
    createdAtMs: integer("created_at_ms").notNull(),
  },
  (table) => [index("pause_changes_customer_id").on(table.customerId)],
);

/**
 * A Finding: facts the agent reports to a customer with Options, where nothing happens until the customer picks
 * one. `facts` is a JSON array of label and value pairs, and `options` a JSON array of typed Options whose amounts
 * are fixed when the Finding is made. `state` moves from open to chosen or expired, never back. A refused pick
 * leaves it open and records the guardrail and reason, so the customer can see why nothing moved.
 */
export const findingsTable = sqliteTable(
  "findings",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    customerId: integer("customer_id")
      .notNull()
      .references(() => customersTable.id),
    kind: text("kind", { enum: FINDING_KINDS }).notNull(),
    createdAtMs: integer("created_at_ms").notNull(),
    /** The ledger event that caused the Finding, such as the paycheck behind a sweep Finding. */
    ledgerEventId: integer("ledger_event_id")
      .notNull()
      .references(() => ledgerEventsTable.id),
    ruleId: integer("rule_id")
      .notNull()
      .references(() => rulesTable.id),
    ruleVersion: integer("rule_version").notNull(),
    facts: text("facts", { mode: "json" }).notNull(),
    options: text("options", { mode: "json" }).notNull(),
    state: text("state", { enum: FINDING_STATES }).notNull(),
    /** The key of the Option the customer picked, once the Finding is chosen. */
    chosenOption: text("chosen_option"),
    /** The guardrail that refused the customer's last pick, while the Finding is still open. */
    refusedBy: text("refused_by"),
    refusalReason: text("refusal_reason"),
  },
  (table) => [
    index("findings_customer_id").on(table.customerId),
    uniqueIndex("findings_customer_event_kind").on(table.customerId, table.ledgerEventId, table.kind),
    check("findings_chosen_option", sql`(${table.state} = 'chosen') = (${table.chosenOption} IS NOT NULL)`),
    check("findings_refusal", sql`(${table.refusedBy} IS NULL) = (${table.refusalReason} IS NULL)`),
  ],
);
