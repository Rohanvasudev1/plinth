import { sql } from "drizzle-orm";
import { CATEGORIES } from "../categories";
import { DECISION_RESULTS } from "../decisions";
import { FINDING_KINDS, FINDING_STATES, STANDING_SEARCHES } from "../findings";
import { ACCESS_READERS } from "../access-log";
import { MISSION_STATES } from "../missions";
import { LINKED_ACCOUNT_TYPES } from "../open-banking";
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
    /** Who the money moved to or from: a Merchant, payee or employer, or the customer's own account. Null on opening balances. */
    counterparty: text("counterparty"),
    /** The transaction's Category. Null on opening balances. */
    category: text("category", { enum: CATEGORIES }),
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
    /** The Category each payment of the bill is posted under. */
    category: text("category", { enum: CATEGORIES }),
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
 * their settings record. A customer change that isn't to a Rule, such as a settings or Goal target change, has no Rule.
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
    result: text("result", { enum: DECISION_RESULTS }).notNull(),
    /** The guardrail that refused the action, on a Refused entry. */
    refusedBy: text("refused_by"),
    why: text("why", { mode: "json" }).notNull(),
    /** The ledger transaction that moved the money, on a Done or Reversed entry. */
    ledgerTransactionId: integer("ledger_transaction_id").references(() => ledgerTransactionsTable.id),
    /** On a Reversed entry, the entry it reverses. Unique, so each action is undone at most once. */
    reversesDecisionId: integer("reverses_decision_id").references((): AnySQLiteColumn => decisionsTable.id),
    /** When the customer was first shown this agent action in a toast. Null until then. */
    seenAtMs: integer("seen_at_ms"),
    /** The Mission an entry reports on: the agent acted because the customer asked, so it names no Rule. */
    missionId: integer("mission_id").references((): AnySQLiteColumn => missionsTable.id),
    /** The Finding a Reported entry links to. */
    findingId: integer("finding_id").references((): AnySQLiteColumn => findingsTable.id),
  },
  (table) => [
    index("decisions_customer_id").on(table.customerId),
    index("decisions_trigger_ledger_event_id").on(table.triggerLedgerEventId),
    uniqueIndex("decisions_reverses_decision_id").on(table.reversesDecisionId),
    check("decisions_refused_by", sql`(${table.result} = 'Refused') = (${table.refusedBy} IS NOT NULL)`),
    check("decisions_rule_version", sql`(${table.ruleId} IS NULL) = (${table.ruleVersion} IS NULL)`),
    check(
      "decisions_agent_uses_rule",
      sql`${table.actor} = 'customer' OR ${table.ruleId} IS NOT NULL OR ${table.missionId} IS NOT NULL`,
    ),
  ],
);

/**
 * One version of a customer's settings record (ADR 0007): the Autonomy level, the Advice setting, the raw risk
 * answers, the data choices, the ordered goal preferences and the Standing search switches. Rows are never updated: a change writes the next
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
    /** The Subscription price rises Standing search's switch. On unless the customer switched it off. */
    subscriptionPriceRises: integer("subscription_price_rises", { mode: "boolean" }).notNull().default(true),
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
 * one. `facts` is a JSON array of label, value and Source triples, and `options` a JSON array of typed Options whose
 * details are fixed when the Finding is made. `state` moves from open to chosen or expired, never back, or to
 * snoozed until `snoozed_until`, when it opens again. A refused pick leaves it open and records the guardrail and
 * reason, so the customer can see why nothing moved. A sweep Finding names the paycheck and Rule behind it; a
 * Mission Finding names neither, and holds the Mission's full report.
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
    title: text("title").notNull(),
    /** The ledger event that caused the Finding, such as the paycheck behind a sweep Finding. */
    ledgerEventId: integer("ledger_event_id").references(() => ledgerEventsTable.id),
    ruleId: integer("rule_id").references(() => rulesTable.id),
    ruleVersion: integer("rule_version"),
    facts: text("facts", { mode: "json" }).notNull(),
    options: text("options", { mode: "json" }).notNull(),
    /** The Option the agent would pick, and why, shown only as far as the Advice setting allows. */
    agentsView: text("agents_view"),
    /** A Mission's full report. */
    report: text("report"),
    /** The Mission that made the Finding. */
    missionId: integer("mission_id").references((): AnySQLiteColumn => missionsTable.id),
    /** The Standing search that made the Finding. */
    standingSearch: text("standing_search", { enum: STANDING_SEARCHES }),
    /** The Merchant a Subscription price rise Finding is about, as the Card purchase names it. */
    subscriptionMerchant: text("subscription_merchant"),
    /** The new price, in cents, a Subscription price rise Finding is about. One Finding per customer, Merchant and price. */
    subscriptionPriceCents: integer("subscription_price_cents"),
    state: text("state", { enum: FINDING_STATES }).notNull(),
    /** The YYYY-MM-DD date a snoozed Finding opens again. */
    snoozedUntil: text("snoozed_until"),
    /** The key of the Option the customer picked, once the Finding is chosen. */
    chosenOption: text("chosen_option"),
    /** The guardrail that refused the customer's last pick, while the Finding is still open. */
    refusedBy: text("refused_by"),
    refusalReason: text("refusal_reason"),
  },
  (table) => [
    index("findings_customer_id").on(table.customerId),
    uniqueIndex("findings_customer_event_kind").on(table.customerId, table.ledgerEventId, table.kind),
    uniqueIndex("findings_mission_id").on(table.missionId),
    uniqueIndex("findings_customer_subscription_price").on(
      table.customerId,
      table.subscriptionMerchant,
      table.subscriptionPriceCents,
    ),
    check("findings_chosen_option", sql`(${table.state} = 'chosen') = (${table.chosenOption} IS NOT NULL)`),
    check("findings_refusal", sql`(${table.refusedBy} IS NULL) = (${table.refusalReason} IS NULL)`),
    check("findings_snoozed_until", sql`(${table.state} = 'snoozed') = (${table.snoozedUntil} IS NOT NULL)`),
    check("findings_rule_version", sql`(${table.ruleId} IS NULL) = (${table.ruleVersion} IS NULL)`),
    check(
      "findings_sweep_names_paycheck_and_rule",
      sql`${table.kind} <> 'sweep' OR (${table.ledgerEventId} IS NOT NULL AND ${table.ruleId} IS NOT NULL)`,
    ),
    check("findings_report_on_mission", sql`${table.report} IS NULL OR ${table.kind} = 'mission'`),
    check("findings_mission_link", sql`${table.missionId} IS NULL OR ${table.kind} = 'mission'`),
    check(
      "findings_standing_search_link",
      sql`(${table.standingSearch} IS NOT NULL) = (${table.kind} = 'subscription_price_rise')`,
    ),
    check(
      "findings_subscription_price",
      sql`(${table.subscriptionMerchant} IS NOT NULL AND ${table.subscriptionPriceCents} IS NOT NULL) = (${table.kind} = 'subscription_price_rise')`,
    ),
  ],
);

/**
 * A Mission: a question the customer sent their agent, which reads only their data and reports back with one
 * Finding. `read_list` is a JSON array of the tool name and period or item each tool call read. `progress_label` is
 * what the Mission is doing now, from a fixed list. Its Finding names it through `findings.mission_id`.
 */
export const missionsTable = sqliteTable(
  "missions",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    customerId: integer("customer_id")
      .notNull()
      .references(() => customersTable.id),
    question: text("question").notNull(),
    state: text("state", { enum: MISSION_STATES }).notNull(),
    progressLabel: text("progress_label").notNull(),
    readList: text("read_list", { mode: "json" }).notNull(),
    startedAtMs: integer("started_at_ms").notNull(),
    endedAtMs: integer("ended_at_ms"),
  },
  (table) => [
    index("missions_customer_id").on(table.customerId),
    check("missions_ended", sql`(${table.state} = 'running') = (${table.endedAtMs} IS NULL)`),
  ],
);

/**
 * The access log: one row per read of a customer's data by anything other than their own page views (ADR 0010).
 * `who` is the reader, and `what` and `why` are the text the customer is shown, stored when written. Rows are never
 * updated or deleted: database triggers refuse both.
 */
export const accessLogTable = sqliteTable(
  "access_log",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    customerId: integer("customer_id")
      .notNull()
      .references(() => customersTable.id),
    createdAtMs: integer("created_at_ms").notNull(),
    who: text("who", { enum: ACCESS_READERS }).notNull(),
    what: text("what").notNull(),
    why: text("why").notNull(),
  },
  (table) => [index("access_log_customer_id").on(table.customerId)],
);


/**
 * A Linked account: an account the customer holds at an Institution, which Plinth can see but not move money in or
 * out of. It holds a copy of the balance from the last Sync and the customer's Consent, from `consent_start` to
 * `consent_end` (YYYY-MM-DD dates in the bank's time zone). It has no ledger entries. Unlinking deletes the row.
 * `institution_account` names the open banking adapter's account, at most one Linked account each per customer.
 */
export const linkedAccountsTable = sqliteTable(
  "linked_accounts",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    customerId: integer("customer_id")
      .notNull()
      .references(() => customersTable.id),
    institutionAccount: text("institution_account").notNull(),
    institution: text("institution").notNull(),
    type: text("type", { enum: LINKED_ACCOUNT_TYPES }).notNull(),
    /** Below zero when owed. */
    balanceCents: integer("balance_cents").notNull(),
    syncedAtMs: integer("synced_at_ms").notNull(),
    consentStart: text("consent_start").notNull(),
    consentEnd: text("consent_end").notNull(),
  },
  (table) => [
    uniqueIndex("linked_accounts_customer_institution_account").on(table.customerId, table.institutionAccount),
    check("linked_accounts_consent_order", sql`${table.consentStart} < ${table.consentEnd}`),
  ],
);
