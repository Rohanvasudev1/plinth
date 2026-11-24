import { and, asc, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import { localDate, type LocalDate } from "./calendar";
import type { Clock } from "./clock";
import type { Database } from "./db/database";
import {
  accountsTable,
  decisionsTable,
  findingsTable,
  ledgerEntriesTable,
  ledgerEventsTable,
  ledgerTransactionsTable,
  missionsTable,
  payrollsTable,
  rulesTable,
  ruleVersionsTable,
  scheduledBillsTable,
  pauseChangesTable,
  settingsVersionsTable,
} from "./db/schema";
import { isGuardrail, type Decision, type NewDecision, type WhyRow } from "./decisions";
import {
  FindingError,
  isFindingOptionKey,
  type Finding,
  type FindingFact,
  type FindingKind,
  type FindingOption,
  type FindingOptionKey,
  type NewFinding,
} from "./findings";
import type { LedgerEvent, LedgerEventDispatcher } from "./ledger-events";
import {
  isMissionProgressLabel,
  MissionError,
  type Mission,
  type MissionProgressLabel,
  type MissionRead,
  type MissionState,
} from "./missions";
import { checkGoalTarget, GoalError } from "./goals";
import type { Category } from "./categories";
import { cents, type Cents } from "./money";
import { isRuleKind, parseRuleContent, type NewRule, type Rule } from "./rules";
import { parseSettingsChoices, SettingsError, type SavingsGoal, type Settings, type SettingsChoices } from "./settings";
import { isEmployer, type Employer } from "./system-data";

/** A seeded customer. Every customer-scoped read and write takes one as its first argument. */
export interface Customer {
  id: number;
  name: string;
}

export type CustomerAccountKind = "checking" | "savings";

export interface Account {
  id: number;
  kind: CustomerAccountKind;
  name: string;
  /** The sum of every ledger entry on the account. */
  balance: Cents;
  /** The Goal's target amount, if this is a savings account with a Goal that has one. */
  goalTarget: Cents | null;
  /** The savings goal this Goal account is for, or null for an account that isn't one. */
  goal: SavingsGoal | null;
}

export interface NewAccount {
  kind: CustomerAccountKind;
  name: string;
  goalTarget?: Cents;
  /** Only on a savings account. A customer has at most one account per savings goal. */
  goal?: SavingsGoal;
}

export interface LedgerEntryInput {
  accountId: number;
  amount: Cents;
}

export interface LedgerTransactionInput {
  idempotencyKey: string;
  description: string;
  /** Who the money moved to or from: a Merchant, payee or employer, or, for a move between the customer's own accounts, the account it went to. */
  counterparty?: string;
  category?: Category;
  entries: LedgerEntryInput[];
}

export interface PostedLedgerTransaction {
  ledgerTransactionId: number;
  ledgerEventId: number;
  /** False when the idempotency key was already used, in which case nothing changed. */
  created: boolean;
}

export interface LedgerTransaction {
  id: number;
  idempotencyKey: string;
  description: string;
  postedAt: Date;
  /** Null on a transaction posted without one, such as an opening balance. */
  counterparty: string | null;
  category: Category | null;
  entries: LedgerEntryInput[];
}

/** A simulated employer paying the customer a fixed amount into one of their accounts every `intervalDays` days. */
export interface Payroll {
  id: number;
  accountId: number;
  employer: Employer;
  amount: Cents;
  firstPayDate: LocalDate;
  intervalDays: number;
}

export type NewPayroll = Omit<Payroll, "id">;

/** A Scheduled bill: the customer pays `payee` `amount` from one of their accounts on `dayOfMonth` every month. */
export interface ScheduledBill {
  id: number;
  accountId: number;
  payee: string;
  amount: Cents;
  /** 1 to 31. In a shorter month the bill falls due on the month's last day. */
  dayOfMonth: number;
  /** The Category each payment is posted under. Null only for a bill set up before Categories existed and not backfilled. */
  category: Category | null;
}

export type NewScheduledBill = Omit<ScheduledBill, "id" | "category"> & { category: Category };

/**
 * The one data-access layer for customer-owned rows (ADR 0004). Every method takes the customer
 * first, and no other module reads or writes customer accounts or the ledger.
 */
export interface CustomerData {
  listAccounts(customer: Customer): Account[];
  /** The customer's account with this id, or undefined if it doesn't exist or isn't theirs. */
  getAccount(customer: Customer, accountId: number): Account | undefined;
  openAccount(customer: Customer, account: NewAccount): Account;
  /**
   * Sets the Goal's target on one of the customer's savings accounts. Throws GoalError, saving nothing, if the
   * account isn't one of their savings accounts or the target is out of range. Writes no Decision log entry.
   */
  setGoalTarget(customer: Customer, accountId: number, target: Cents): Account;
  /**
   * Posts a pair of entries that sum to zero, plus a ledger event, in one database transaction, then hands
   * the event to subscribers. Each entry must be on the customer's own account or a system account.
   * Idempotency keys are unique per customer: reusing one of the customer's keys returns the existing
   * ledger transaction and changes nothing, while another customer may use the same key.
   */
  postLedgerTransaction(customer: Customer, transaction: LedgerTransactionInput): PostedLedgerTransaction;
  /**
   * Runs `work` in one database transaction: if it throws, nothing it wrote is kept. Ledger events from
   * ledger transactions posted inside go to subscribers only after the whole block commits.
   */
  inOneTransaction<T>(work: () => T): T;
  /** The customer's ledger transaction posted under this idempotency key, if there is one. */
  findLedgerTransaction(customer: Customer, idempotencyKey: string): LedgerTransaction | undefined;
  /** Sets up a payroll into one of the customer's own accounts. */
  addPayroll(customer: Customer, payroll: NewPayroll): Payroll;
  /** The customer's payrolls, in the order they were set up. */
  listPayrolls(customer: Customer): Payroll[];
  /** Sets up a Scheduled bill paid from one of the customer's own accounts. */
  addScheduledBill(customer: Customer, bill: NewScheduledBill): ScheduledBill;
  /** The customer's Scheduled bills, in the order they were set up. */
  listScheduledBills(customer: Customer): ScheduledBill[];
  /** Ledger transactions posted for the customer, oldest first, with every entry including the outside side. */
  listLedgerTransactions(customer: Customer): LedgerTransaction[];
  /** The customer's ledger transaction with this id, or undefined if it doesn't exist or isn't theirs. */
  getLedgerTransaction(customer: Customer, ledgerTransactionId: number): LedgerTransaction | undefined;
  /**
   * Creates a Rule at version 1. Throws RuleParametersError if the parameters don't match the kind's schema.
   * The accounts it names are not checked here: guardrails check ownership before every agent action.
   */
  createRule(customer: Customer, rule: NewRule): Rule;
  /** The latest version of each of the customer's Rules, in the order they were created. */
  listRules(customer: Customer): Rule[];
  /** The customer's Rule at `version`, or its latest version when `version` is left out. */
  getRule(customer: Customer, ruleId: number, version?: number): Rule | undefined;
  /**
   * The only way to change a Rule (ADR 0007): writes its next version with the change applied and, in the same
   * database transaction, the Decision log entry `describe` builds from the versions before and after.
   * Throws RuleNotFoundError if the Rule isn't theirs, and RuleParametersError if new parameters don't match the
   * kind's schema. Either way nothing is written. `describe` may throw to refuse the change, also writing nothing.
   */
  reviseRule(
    customer: Customer,
    ruleId: number,
    change: (current: Rule) => RuleRevision,
    describe: (before: Rule, after: Rule) => NewDecision,
  ): Rule;
  /** The customer's settings record at `version`, or its latest version, or undefined if they have none. */
  getSettings(customer: Customer, version?: number): Settings | undefined;
  /**
   * Writes the next version of the customer's settings record, or version 1 if they have none. Throws
   * SettingsError if the choices don't match the settings record's schema. Writes no Decision log entry.
   */
  saveSettings(customer: Customer, choices: SettingsChoices): Settings;
  /** Whether the customer's agent is paused. A customer who has never paused isn't. */
  isAgentPaused(customer: Customer): boolean;
  /** Records the customer pausing or unpausing their agent. Writes no Decision log entry. */
  savePause(customer: Customer, paused: boolean): void;
  /**
   * Writes a Decision log entry, timed by the clock. A Reversed entry must name an agent action of the
   * customer's that no other entry reverses yet.
   */
  recordDecision(customer: Customer, decision: NewDecision): Decision;
  /** The customer's Decision log, newest first. */
  listDecisions(customer: Customer): Decision[];
  /** The customer's Decision log entry with this id, or undefined if it doesn't exist or isn't theirs. */
  getDecision(customer: Customer, decisionId: number): Decision | undefined;
  /** The customer's agent actions they haven't been shown yet, newest first. */
  listUnseenAgentActions(customer: Customer): Decision[];
  /** Marks these agent actions of the customer's as seen now. Ids that aren't theirs are ignored. */
  markAgentActionsSeen(customer: Customer, decisionIds: number[]): void;
  /**
   * Makes an open Finding, timed by the clock. Its Rule and the accounts its Options name must be the customer's,
   * and Read the full report needs a report. Throws FindingError if the customer already has a Finding of this kind
   * for this ledger event.
   */
  createFinding(customer: Customer, finding: NewFinding): Finding;
  /** The customer's Findings, open ones first, each group newest first. */
  listFindings(customer: Customer): Finding[];
  /** The customer's Finding with this id, or undefined if it doesn't exist or isn't theirs. */
  getFinding(customer: Customer, findingId: number): Finding | undefined;
  /** Expires every open Finding of this kind of the customer's. Returns how many it expired. */
  expireOpenFindings(customer: Customer, kind: FindingKind): number;
  /** Snoozes the customer's open Finding until `until`, clearing any earlier refusal. Throws FindingError if it isn't open. */
  snoozeFinding(customer: Customer, findingId: number, until: LocalDate): Finding;
  /** The customer's snoozed Findings whose date is `today` or earlier. */
  listSnoozedFindingsDue(customer: Customer, today: LocalDate): Finding[];
  /** Opens the customer's snoozed Finding again. Throws FindingError if it isn't snoozed. */
  reopenSnoozedFinding(customer: Customer, findingId: number): Finding;
  /**
   * Marks the customer's open Finding chosen with this Option, clearing any earlier refusal. Throws
   * FindingError if it isn't theirs, isn't open, or has no such Option.
   */
  markFindingChosen(customer: Customer, findingId: number, option: FindingOptionKey): Finding;
  /** Records why the customer's pick on their open Finding was refused. The Finding stays open. */
  recordFindingRefusal(customer: Customer, findingId: number, refusal: NonNullable<Finding["refusal"]>): Finding;
  /** Starts a running Mission for the customer, timed by the clock, with nothing read yet. */
  createMission(customer: Customer, question: string, progressLabel: MissionProgressLabel): Mission;
  /** The customer's Mission with this id, or undefined if it doesn't exist or isn't theirs. */
  getMission(customer: Customer, missionId: number): Mission | undefined;
  /** The customer's Missions, newest first. */
  listMissions(customer: Customer): Mission[];
  /**
   * Records what the customer's running Mission is doing now and adds what it read to its read list. Throws
   * MissionError if it isn't running.
   */
  recordMissionProgress(customer: Customer, missionId: number, progressLabel: MissionProgressLabel, read?: MissionRead): Mission;
  /** Ends the customer's running Mission, timed by the clock. Throws MissionError if it isn't running. */
  endMission(customer: Customer, missionId: number, state: Exclude<MissionState, "running">): Mission;
}

/** A change to a Rule: its switch, its parameters, or both. Whatever is left out stays as it is. */
export interface RuleRevision {
  on?: boolean;
  /** Checked against the Rule kind's schema. */
  parameters?: unknown;
}

export class LedgerError extends Error {
  override name = "LedgerError";
}

export class RuleNotFoundError extends Error {
  override name = "RuleNotFoundError";
}

export function createCustomerData(deps: {
  db: Database;
  clock: Clock;
  ledgerEvents: LedgerEventDispatcher;
}): CustomerData {
  const { db, clock, ledgerEvents } = deps;

  /** Events posted inside an open `inOneTransaction` block, waiting for it to commit. Null outside one. */
  let heldEvents: LedgerEvent[] | null = null;

  function dispatchAfterCommit(event: LedgerEvent): void {
    if (heldEvents) heldEvents.push(event);
    else ledgerEvents.dispatch(event);
  }

  function inOneTransaction<T>(work: () => T): T {
    if (heldEvents) return work();
    heldEvents = [];
    let result: T;
    let events: LedgerEvent[];
    try {
      result = db.transaction(() => work(), { behavior: "immediate" });
    } finally {
      events = heldEvents;
      heldEvents = null;
    }
    for (const event of events) ledgerEvents.dispatch(event);
    return result;
  }

  const balanceCents = sql<number>`coalesce(sum(${ledgerEntriesTable.amountCents}), 0)`;

  function selectAccounts(customer: Customer, accountId?: number): Account[] {
    const rows = db
      .select({
        id: accountsTable.id,
        kind: accountsTable.kind,
        name: accountsTable.name,
        goalCents: accountsTable.goalCents,
        goal: accountsTable.goal,
        balanceCents,
      })
      .from(accountsTable)
      .leftJoin(ledgerEntriesTable, eq(ledgerEntriesTable.accountId, accountsTable.id))
      .where(
        and(
          eq(accountsTable.customerId, customer.id),
          accountId === undefined ? undefined : eq(accountsTable.id, accountId),
        ),
      )
      .groupBy(accountsTable.id)
      .orderBy(asc(accountsTable.id))
      .all();
    return rows.map((row) => {
      if (row.kind === "system") throw new Error(`Account ${row.id} is a system account with an owner`);
      return {
        id: row.id,
        kind: row.kind,
        name: row.name,
        balance: cents(row.balanceCents),
        goalTarget: row.goalCents === null ? null : cents(row.goalCents),
        goal: row.goal,
      };
    });
  }

  function getAccount(customer: Customer, accountId: number): Account | undefined {
    return selectAccounts(customer, accountId)[0];
  }

  function validate(customer: Customer, transaction: LedgerTransactionInput): void {
    const { idempotencyKey, entries } = transaction;
    if (idempotencyKey.trim() === "") throw new LedgerError("A ledger transaction needs an idempotency key");
    if (entries.length !== 2) throw new LedgerError("A ledger transaction is a pair of entries");
    let sum = 0;
    for (const entry of entries) {
      cents(entry.amount);
      if (entry.amount === 0) throw new LedgerError("A ledger entry can't be zero");
      sum += entry.amount;
    }
    if (sum !== 0) throw new LedgerError(`Ledger entries must sum to zero, got ${sum} cents`);

    const accountIds = [...new Set(entries.map((entry) => entry.accountId))];
    const allowed = db
      .select({ id: accountsTable.id })
      .from(accountsTable)
      .where(
        and(
          inArray(accountsTable.id, accountIds),
          or(eq(accountsTable.customerId, customer.id), isNull(accountsTable.customerId)),
        ),
      )
      .all();
    if (allowed.length !== accountIds.length) {
      throw new LedgerError("Every entry must be on the customer's own account or a system account");
    }
  }

  function postLedgerTransaction(
    customer: Customer,
    transaction: LedgerTransactionInput,
  ): PostedLedgerTransaction {
    const result = db.transaction(
      (tx): { posted: PostedLedgerTransaction; event?: LedgerEvent } => {
        const existing = tx
          .select({
            ledgerTransactionId: ledgerTransactionsTable.id,
            ledgerEventId: ledgerEventsTable.id,
          })
          .from(ledgerTransactionsTable)
          .innerJoin(ledgerEventsTable, eq(ledgerEventsTable.ledgerTransactionId, ledgerTransactionsTable.id))
          .where(
            and(
              eq(ledgerTransactionsTable.customerId, customer.id),
              eq(ledgerTransactionsTable.idempotencyKey, transaction.idempotencyKey),
            ),
          )
          .get();
        if (existing) {
          return {
            posted: {
              ledgerTransactionId: existing.ledgerTransactionId,
              ledgerEventId: existing.ledgerEventId,
              created: false,
            },
          };
        }

        validate(customer, transaction);
        const now = clock.now();
        const inserted = tx
          .insert(ledgerTransactionsTable)
          .values({
            customerId: customer.id,
            idempotencyKey: transaction.idempotencyKey,
            description: transaction.description,
            postedAtMs: now.getTime(),
            counterparty: transaction.counterparty ?? null,
            category: transaction.category ?? null,
          })
          .returning({ id: ledgerTransactionsTable.id })
          .get();
        tx.insert(ledgerEntriesTable)
          .values(
            transaction.entries.map((entry) => ({
              ledgerTransactionId: inserted.id,
              accountId: entry.accountId,
              amountCents: entry.amount,
            })),
          )
          .run();
        const event = tx
          .insert(ledgerEventsTable)
          .values({ customerId: customer.id, ledgerTransactionId: inserted.id, createdAtMs: now.getTime() })
          .returning({ id: ledgerEventsTable.id })
          .get();
        return {
          posted: { ledgerTransactionId: inserted.id, ledgerEventId: event.id, created: true },
          event: { id: event.id, customerId: customer.id, ledgerTransactionId: inserted.id, createdAt: now },
        };
      },
      { behavior: "immediate" },
    );
    if (result.event) dispatchAfterCommit(result.event);
    return result.posted;
  }

  function selectLedgerTransactions(
    customer: Customer,
    only: { idempotencyKey?: string; id?: number } = {},
  ): LedgerTransaction[] {
    const { idempotencyKey, id } = only;
    const transactions = db
      .select()
      .from(ledgerTransactionsTable)
      .where(
        and(
          eq(ledgerTransactionsTable.customerId, customer.id),
          idempotencyKey === undefined ? undefined : eq(ledgerTransactionsTable.idempotencyKey, idempotencyKey),
          id === undefined ? undefined : eq(ledgerTransactionsTable.id, id),
        ),
      )
      .orderBy(asc(ledgerTransactionsTable.id))
      .all();
    if (transactions.length === 0) return [];
    const entries = db
      .select()
      .from(ledgerEntriesTable)
      .where(
        inArray(
          ledgerEntriesTable.ledgerTransactionId,
          transactions.map((transaction) => transaction.id),
        ),
      )
      .orderBy(asc(ledgerEntriesTable.id))
      .all();
    return transactions.map((transaction) => ({
      id: transaction.id,
      idempotencyKey: transaction.idempotencyKey,
      description: transaction.description,
      postedAt: new Date(transaction.postedAtMs),
      counterparty: transaction.counterparty,
      category: transaction.category,
      entries: entries
        .filter((entry) => entry.ledgerTransactionId === transaction.id)
        .map((entry) => ({ accountId: entry.accountId, amount: cents(entry.amountCents) })),
    }));
  }

  /** The customer's Rules at `version`, or at their latest version when `version` is left out. */
  function selectRules(customer: Customer, ruleId?: number, version?: number): Rule[] {
    const rows = db
      .select({
        id: rulesTable.id,
        kind: rulesTable.kind,
        version: ruleVersionsTable.version,
        on: ruleVersionsTable.on,
        parameters: ruleVersionsTable.parameters,
        createdAtMs: ruleVersionsTable.createdAtMs,
      })
      .from(rulesTable)
      .innerJoin(ruleVersionsTable, eq(ruleVersionsTable.ruleId, rulesTable.id))
      .where(
        and(
          eq(rulesTable.customerId, customer.id),
          ruleId === undefined ? undefined : eq(rulesTable.id, ruleId),
          version === undefined ? undefined : eq(ruleVersionsTable.version, version),
        ),
      )
      .orderBy(asc(rulesTable.id), desc(ruleVersionsTable.version))
      .all()
      // Rows come newest version first, so the first row of each Rule is its latest.
      .filter((row, index, all) => index === 0 || all[index - 1]?.id !== row.id);
    return rows.map((row) => {
      if (!isRuleKind(row.kind)) throw new Error(`Rule ${row.id} has an unknown kind ${row.kind}`);
      return {
        ...parseRuleContent(row.kind, row.parameters),
        id: row.id,
        version: row.version,
        on: row.on,
        createdAt: new Date(row.createdAtMs),
      };
    });
  }

  function getRule(customer: Customer, ruleId: number, version?: number): Rule | undefined {
    return selectRules(customer, ruleId, version)[0];
  }

  function createRule(customer: Customer, rule: NewRule): Rule {
    const { parameters } = parseRuleContent(rule.kind, rule.parameters);
    const ruleId = db.transaction((tx) => {
      const inserted = tx
        .insert(rulesTable)
        .values({ customerId: customer.id, kind: rule.kind })
        .returning({ id: rulesTable.id })
        .get();
      tx.insert(ruleVersionsTable)
        .values({ ruleId: inserted.id, version: 1, parameters, on: rule.on, createdAtMs: clock.now().getTime() })
        .run();
      return inserted.id;
    });
    const created = getRule(customer, ruleId);
    if (!created) throw new Error(`Rule ${ruleId} vanished after it was created`);
    return created;
  }

  function reviseRule(
    customer: Customer,
    ruleId: number,
    change: (current: Rule) => RuleRevision,
    describe: (before: Rule, after: Rule) => NewDecision,
  ): Rule {
    return inOneTransaction(() => {
      const current = getRule(customer, ruleId);
      if (!current) throw new RuleNotFoundError(`No Rule ${ruleId} for this customer`);
      const revision = change(current);
      const { parameters } =
        revision.parameters === undefined ? current : parseRuleContent(current.kind, revision.parameters);
      db.insert(ruleVersionsTable)
        .values({
          ruleId,
          version: current.version + 1,
          parameters,
          on: revision.on ?? current.on,
          createdAtMs: clock.now().getTime(),
        })
        .run();
      const revised = getRule(customer, ruleId);
      if (!revised) throw new Error(`Rule ${ruleId} vanished after it was revised`);
      const decision = describe(current, revised);
      if (decision.rule?.id !== revised.id || decision.rule.version !== revised.version) {
        throw new RuleNotFoundError("A Rule change's Decision log entry must name the version it wrote");
      }
      recordDecision(customer, decision);
      return revised;
    });
  }

  function getSettings(customer: Customer, version?: number): Settings | undefined {
    const row = db
      .select()
      .from(settingsVersionsTable)
      .where(
        and(
          eq(settingsVersionsTable.customerId, customer.id),
          version === undefined ? undefined : eq(settingsVersionsTable.version, version),
        ),
      )
      .orderBy(desc(settingsVersionsTable.version))
      .limit(1)
      .get();
    if (!row) return undefined;
    const choices = parseSettingsChoices({
      autonomyLevel: row.autonomyLevel,
      adviceSetting: row.adviceSetting,
      riskAnswers: { marketDrop: row.riskMarketDrop, timeHorizon: row.riskTimeHorizon },
      dataChoices: {
        trainModels: row.trainModels,
        shareWithPartners: row.shareWithPartners,
        keepChatHistory: row.keepChatHistory,
      },
      goalPreferences: row.goalPreferences,
    });
    return { version: row.version, ...choices, createdAt: new Date(row.createdAtMs) };
  }

  function saveSettings(customer: Customer, choices: SettingsChoices): Settings {
    const parsed = parseSettingsChoices(choices);
    const version = db.transaction(
      (tx) => {
        const next = (getSettings(customer)?.version ?? 0) + 1;
        tx.insert(settingsVersionsTable)
          .values({
            customerId: customer.id,
            version: next,
            autonomyLevel: parsed.autonomyLevel,
            adviceSetting: parsed.adviceSetting,
            riskMarketDrop: parsed.riskAnswers.marketDrop,
            riskTimeHorizon: parsed.riskAnswers.timeHorizon,
            trainModels: parsed.dataChoices.trainModels,
            shareWithPartners: parsed.dataChoices.shareWithPartners,
            keepChatHistory: parsed.dataChoices.keepChatHistory,
            goalPreferences: parsed.goalPreferences,
            createdAtMs: clock.now().getTime(),
          })
          .run();
        return next;
      },
      { behavior: "immediate" },
    );
    const saved = getSettings(customer, version);
    if (!saved) throw new SettingsError(`Settings version ${version} vanished after it was saved`);
    return saved;
  }

  function selectFindings(customer: Customer, findingId?: number): Finding[] {
    return db
      .select()
      .from(findingsTable)
      .where(
        and(
          eq(findingsTable.customerId, customer.id),
          findingId === undefined ? undefined : eq(findingsTable.id, findingId),
        ),
      )
      .orderBy(
        sql`case when ${findingsTable.state} = 'open' then 0 else 1 end`,
        desc(findingsTable.createdAtMs),
        desc(findingsTable.id),
      )
      .all()
      .map((row) => {
        if (row.refusedBy !== null && !isGuardrail(row.refusedBy)) {
          throw new Error(`Finding ${row.id} names an unknown guardrail ${row.refusedBy}`);
        }
        if (row.chosenOption !== null && !isFindingOptionKey(row.chosenOption)) {
          throw new Error(`Finding ${row.id} names an unknown Option ${row.chosenOption}`);
        }
        return {
          id: row.id,
          kind: row.kind,
          at: new Date(row.createdAtMs),
          state: row.state,
          title: row.title,
          ledgerEventId: row.ledgerEventId,
          rule: row.ruleId === null || row.ruleVersion === null ? null : { id: row.ruleId, version: row.ruleVersion },
          facts: row.facts as FindingFact[],
          options: (row.options as FindingOption[]).map((option): FindingOption => {
            if (option.key === "move") return { ...option, amount: cents(option.amount) };
            if (option.key === "remind_me") return { ...option, date: localDate(option.date) };
            return option;
          }),
          agentsView: row.agentsView,
          report: row.report,
          missionId: row.missionId,
          standingSearch: row.standingSearch,
          snoozedUntil: row.snoozedUntil === null ? null : localDate(row.snoozedUntil),
          chosenOption: row.chosenOption,
          refusal:
            row.refusedBy === null || row.refusalReason === null
              ? null
              : { guardrail: row.refusedBy, reason: row.refusalReason },
        };
      });
  }

  function getFinding(customer: Customer, findingId: number): Finding | undefined {
    return selectFindings(customer, findingId)[0];
  }

  function openFinding(customer: Customer, findingId: number): Finding {
    return findingInState(customer, findingId, "open");
  }

  function createFinding(customer: Customer, finding: NewFinding): Finding {
    const rule = finding.rule ?? null;
    const ledgerEventId = finding.ledgerEventId ?? null;
    if (rule && !getRule(customer, rule.id, rule.version)) {
      throw new RuleNotFoundError(`No Rule ${rule.id} version ${rule.version} for this customer`);
    }
    if (finding.missionId != null && !getMission(customer, finding.missionId)) {
      throw new FindingError(`No Mission ${finding.missionId} for this customer`);
    }
    for (const option of finding.options) {
      if (option.key === "move") cents(option.amount);
      if (option.key === "remind_me") localDate(option.date);
      if (option.key === "read_report" && !finding.report) {
        throw new FindingError("Read the full report needs a report to show");
      }
      const accountIds =
        option.key === "move" ? [option.fromAccountId, option.toAccountId] : option.key === "leave" ? [option.accountId] : [];
      if (accountIds.some((accountId) => !getAccount(customer, accountId))) {
        throw new FindingError("A Finding's Options can only name the customer's own accounts");
      }
    }
    if (ledgerEventId !== null) {
      const already = db
        .select({ id: findingsTable.id })
        .from(findingsTable)
        .where(
          and(
            eq(findingsTable.customerId, customer.id),
            eq(findingsTable.ledgerEventId, ledgerEventId),
            eq(findingsTable.kind, finding.kind),
          ),
        )
        .get();
      if (already) throw new FindingError(`This customer already has a ${finding.kind} Finding for that ledger event`);
    }
    const row = db
      .insert(findingsTable)
      .values({
        customerId: customer.id,
        kind: finding.kind,
        createdAtMs: clock.now().getTime(),
        title: finding.title,
        ledgerEventId,
        ruleId: rule?.id ?? null,
        ruleVersion: rule?.version ?? null,
        facts: finding.facts,
        options: finding.options,
        agentsView: finding.agentsView ?? null,
        report: finding.report ?? null,
        missionId: finding.missionId ?? null,
        standingSearch: finding.standingSearch ?? null,
        state: "open",
      })
      .returning({ id: findingsTable.id })
      .get();
    const created = getFinding(customer, row.id);
    if (!created) throw new Error(`Finding ${row.id} vanished after it was made`);
    return created;
  }

  function findingInState(customer: Customer, findingId: number, state: Finding["state"]): Finding {
    const finding = getFinding(customer, findingId);
    if (!finding) throw new FindingError(`No Finding ${findingId} for this customer`);
    if (finding.state !== state) throw new FindingError(`Finding ${findingId} is ${finding.state}, not ${state}`);
    return finding;
  }

  const reversals = alias(decisionsTable, "reversals");

  function selectDecisions(customer: Customer, only: { id?: number; unseenAgentActions?: boolean } = {}): Decision[] {
    return db
      .select({ decision: decisionsTable, reversedByDecisionId: reversals.id })
      .from(decisionsTable)
      .leftJoin(reversals, eq(reversals.reversesDecisionId, decisionsTable.id))
      .where(
        and(
          eq(decisionsTable.customerId, customer.id),
          only.id === undefined ? undefined : eq(decisionsTable.id, only.id),
          only.unseenAgentActions ? and(eq(decisionsTable.actor, "agent"), isNull(decisionsTable.seenAtMs)) : undefined,
        ),
      )
      .orderBy(desc(decisionsTable.createdAtMs), desc(decisionsTable.id))
      .all()
      .map(({ decision: row, reversedByDecisionId }) => {
        if (row.refusedBy !== null && !isGuardrail(row.refusedBy)) {
          throw new Error(`Decision ${row.id} names an unknown guardrail ${row.refusedBy}`);
        }
        return {
          id: row.id,
          at: new Date(row.createdAtMs),
          actor: row.actor,
          trigger: { ledgerEventId: row.triggerLedgerEventId, description: row.triggerDescription },
          rule: row.ruleId === null || row.ruleVersion === null ? null : { id: row.ruleId, version: row.ruleVersion },
          action: row.action,
          fromAccountId: row.fromAccountId,
          toAccountId: row.toAccountId,
          amount: cents(row.amountCents),
          result: row.result,
          refusedBy: row.refusedBy,
          why: row.why as WhyRow[],
          ledgerTransactionId: row.ledgerTransactionId,
          reversesDecisionId: row.reversesDecisionId,
          reversedByDecisionId,
          missionId: row.missionId,
          findingId: row.findingId,
        };
      });
  }

  function selectMissions(customer: Customer, missionId?: number): Mission[] {
    return db
      .select({ mission: missionsTable, findingId: findingsTable.id })
      .from(missionsTable)
      .leftJoin(findingsTable, eq(findingsTable.missionId, missionsTable.id))
      .where(
        and(
          eq(missionsTable.customerId, customer.id),
          missionId === undefined ? undefined : eq(missionsTable.id, missionId),
        ),
      )
      .orderBy(desc(missionsTable.startedAtMs), desc(missionsTable.id))
      .all()
      .map(({ mission: row, findingId }) => {
        if (!isMissionProgressLabel(row.progressLabel)) {
          throw new Error(`Mission ${row.id} has an unknown progress label ${row.progressLabel}`);
        }
        return {
          id: row.id,
          question: row.question,
          state: row.state,
          progressLabel: row.progressLabel,
          readList: row.readList as MissionRead[],
          findingId,
          startedAt: new Date(row.startedAtMs),
          endedAt: row.endedAtMs === null ? null : new Date(row.endedAtMs),
        };
      });
  }

  function getMission(customer: Customer, missionId: number): Mission | undefined {
    return selectMissions(customer, missionId)[0];
  }

  function runningMission(customer: Customer, missionId: number): Mission {
    const mission = getMission(customer, missionId);
    if (!mission) throw new MissionError(`No Mission ${missionId} for this customer`);
    if (mission.state !== "running") throw new MissionError(`Mission ${missionId} is ${mission.state}, not running`);
    return mission;
  }

  function recordDecision(customer: Customer, decision: NewDecision): Decision {
    if (decision.rule === null) {
      if (decision.actor === "agent" && decision.missionId === null) {
        throw new RuleNotFoundError("Every agent action uses one of the customer's Rules, or reports on their Mission");
      }
    } else if (!getRule(customer, decision.rule.id, decision.rule.version)) {
      throw new RuleNotFoundError(`No Rule ${decision.rule.id} version ${decision.rule.version} for this customer`);
    }
    if (decision.missionId !== null && !getMission(customer, decision.missionId)) {
      throw new MissionError(`No Mission ${decision.missionId} for this customer`);
    }
    if (decision.findingId !== null && !getFinding(customer, decision.findingId)) {
      throw new FindingError(`No Finding ${decision.findingId} for this customer`);
    }
    for (const accountId of [decision.fromAccountId, decision.toAccountId]) {
      if (accountId !== null && !getAccount(customer, accountId)) {
        throw new LedgerError("A Decision log entry can only name the customer's own accounts");
      }
    }
    if (decision.reversesDecisionId !== null) {
      const reversed = selectDecisions(customer, { id: decision.reversesDecisionId })[0];
      if (decision.result !== "Reversed" || reversed?.actor !== "agent" || reversed.result !== "Done") {
        throw new LedgerError("Only a Reversed entry can reverse, and only an agent action that moved money");
      }
    }
    const row = db
      .insert(decisionsTable)
      .values({
        customerId: customer.id,
        createdAtMs: clock.now().getTime(),
        actor: decision.actor,
        triggerLedgerEventId: decision.trigger.ledgerEventId,
        triggerDescription: decision.trigger.description,
        ruleId: decision.rule?.id ?? null,
        ruleVersion: decision.rule?.version ?? null,
        action: decision.action,
        fromAccountId: decision.fromAccountId,
        toAccountId: decision.toAccountId,
        amountCents: decision.amount,
        result: decision.result,
        refusedBy: decision.refusedBy,
        why: decision.why,
        ledgerTransactionId: decision.ledgerTransactionId,
        reversesDecisionId: decision.reversesDecisionId,
        missionId: decision.missionId,
        findingId: decision.findingId,
      })
      .returning({ id: decisionsTable.id })
      .get();
    const recorded = selectDecisions(customer, { id: row.id })[0];
    if (!recorded) throw new Error(`Decision ${row.id} vanished after it was recorded`);
    return recorded;
  }

  return {
    listAccounts: (customer) => selectAccounts(customer),
    getAccount,
    openAccount(customer, account) {
      const row = db
        .insert(accountsTable)
        .values({
          customerId: customer.id,
          kind: account.kind,
          name: account.name,
          goalCents: account.goalTarget ?? null,
          goal: account.goal ?? null,
        })
        .returning({ id: accountsTable.id })
        .get();
      const opened = getAccount(customer, row.id);
      if (!opened) throw new Error(`Account ${row.id} vanished after it was opened`);
      return opened;
    },
    setGoalTarget(customer, accountId, target) {
      const checked = checkGoalTarget(target);
      if (getAccount(customer, accountId)?.kind !== "savings") {
        throw new GoalError("A Goal's target can only be set on one of your own savings accounts");
      }
      db.update(accountsTable)
        .set({ goalCents: checked })
        .where(and(eq(accountsTable.id, accountId), eq(accountsTable.customerId, customer.id)))
        .run();
      const updated = getAccount(customer, accountId);
      if (!updated) throw new Error(`Account ${accountId} vanished after its Goal target was set`);
      return updated;
    },
    postLedgerTransaction,
    inOneTransaction,
    findLedgerTransaction(customer, idempotencyKey) {
      return selectLedgerTransactions(customer, { idempotencyKey })[0];
    },
    listLedgerTransactions: (customer) => selectLedgerTransactions(customer),
    getLedgerTransaction(customer, ledgerTransactionId) {
      return selectLedgerTransactions(customer, { id: ledgerTransactionId })[0];
    },
    createRule,
    listRules: (customer) => selectRules(customer),
    getRule,
    reviseRule,
    getSettings,
    saveSettings,
    isAgentPaused(customer) {
      const latest = db
        .select({ paused: pauseChangesTable.paused })
        .from(pauseChangesTable)
        .where(eq(pauseChangesTable.customerId, customer.id))
        .orderBy(desc(pauseChangesTable.id))
        .limit(1)
        .get();
      return latest?.paused ?? false;
    },
    savePause(customer, paused) {
      db.insert(pauseChangesTable).values({ customerId: customer.id, paused, createdAtMs: clock.now().getTime() }).run();
    },
    recordDecision,
    listDecisions: (customer) => selectDecisions(customer),
    getDecision: (customer, decisionId) => selectDecisions(customer, { id: decisionId })[0],
    listUnseenAgentActions: (customer) => selectDecisions(customer, { unseenAgentActions: true }),
    markAgentActionsSeen(customer, decisionIds) {
      if (decisionIds.length === 0) return;
      db.update(decisionsTable)
        .set({ seenAtMs: clock.now().getTime() })
        .where(
          and(
            eq(decisionsTable.customerId, customer.id),
            eq(decisionsTable.actor, "agent"),
            isNull(decisionsTable.seenAtMs),
            inArray(decisionsTable.id, decisionIds),
          ),
        )
        .run();
    },
    createFinding,
    listFindings: (customer) => selectFindings(customer),
    getFinding,
    expireOpenFindings(customer, kind) {
      return db
        .update(findingsTable)
        .set({ state: "expired", refusedBy: null, refusalReason: null })
        .where(
          and(eq(findingsTable.customerId, customer.id), eq(findingsTable.kind, kind), eq(findingsTable.state, "open")),
        )
        .run().changes;
    },
    markFindingChosen(customer, findingId, option) {
      const finding = openFinding(customer, findingId);
      if (!finding.options.some((candidate) => candidate.key === option)) {
        throw new FindingError(`Finding ${findingId} has no ${option} Option`);
      }
      db.update(findingsTable)
        .set({ state: "chosen", chosenOption: option, refusedBy: null, refusalReason: null })
        .where(and(eq(findingsTable.customerId, customer.id), eq(findingsTable.id, findingId)))
        .run();
      return getFinding(customer, findingId) ?? finding;
    },
    snoozeFinding(customer, findingId, until) {
      const finding = openFinding(customer, findingId);
      db.update(findingsTable)
        .set({ state: "snoozed", snoozedUntil: until, refusedBy: null, refusalReason: null })
        .where(and(eq(findingsTable.customerId, customer.id), eq(findingsTable.id, findingId)))
        .run();
      return getFinding(customer, findingId) ?? finding;
    },
    listSnoozedFindingsDue(customer, today) {
      return selectFindings(customer).filter(
        (finding) => finding.state === "snoozed" && finding.snoozedUntil !== null && finding.snoozedUntil <= today,
      );
    },
    reopenSnoozedFinding(customer, findingId) {
      const finding = findingInState(customer, findingId, "snoozed");
      db.update(findingsTable)
        .set({ state: "open", snoozedUntil: null })
        .where(and(eq(findingsTable.customerId, customer.id), eq(findingsTable.id, findingId)))
        .run();
      return getFinding(customer, findingId) ?? finding;
    },
    recordFindingRefusal(customer, findingId, refusal) {
      const finding = openFinding(customer, findingId);
      db.update(findingsTable)
        .set({ refusedBy: refusal.guardrail, refusalReason: refusal.reason })
        .where(and(eq(findingsTable.customerId, customer.id), eq(findingsTable.id, findingId)))
        .run();
      return getFinding(customer, findingId) ?? finding;
    },
    createMission(customer, question, progressLabel) {
      const row = db
        .insert(missionsTable)
        .values({
          customerId: customer.id,
          question,
          state: "running",
          progressLabel,
          readList: [],
          startedAtMs: clock.now().getTime(),
        })
        .returning({ id: missionsTable.id })
        .get();
      const created = getMission(customer, row.id);
      if (!created) throw new Error(`Mission ${row.id} vanished after it was started`);
      return created;
    },
    getMission,
    listMissions: (customer) => selectMissions(customer),
    recordMissionProgress(customer, missionId, progressLabel, read) {
      const mission = runningMission(customer, missionId);
      db.update(missionsTable)
        .set({ progressLabel, readList: read ? [...mission.readList, read] : mission.readList })
        .where(and(eq(missionsTable.customerId, customer.id), eq(missionsTable.id, missionId)))
        .run();
      return getMission(customer, missionId) ?? mission;
    },
    endMission(customer, missionId, state) {
      const mission = runningMission(customer, missionId);
      db.update(missionsTable)
        .set({ state, endedAtMs: clock.now().getTime() })
        .where(and(eq(missionsTable.customerId, customer.id), eq(missionsTable.id, missionId)))
        .run();
      return getMission(customer, missionId) ?? mission;
    },
    addPayroll(customer, payroll) {
      if (!getAccount(customer, payroll.accountId)) {
        throw new LedgerError("A payroll must pay into the customer's own account");
      }
      if (payroll.amount <= 0 || payroll.intervalDays <= 0) {
        throw new LedgerError("A payroll needs an amount and an interval above zero");
      }
      const row = db
        .insert(payrollsTable)
        .values({
          customerId: customer.id,
          accountId: payroll.accountId,
          employer: payroll.employer,
          amountCents: payroll.amount,
          firstPayDate: payroll.firstPayDate,
          intervalDays: payroll.intervalDays,
        })
        .returning({ id: payrollsTable.id })
        .get();
      return { id: row.id, ...payroll };
    },
    listPayrolls(customer) {
      return db
        .select()
        .from(payrollsTable)
        .where(eq(payrollsTable.customerId, customer.id))
        .orderBy(asc(payrollsTable.id))
        .all()
        .map((row) => {
          if (!isEmployer(row.employer)) throw new Error(`Payroll ${row.id} names an unknown employer ${row.employer}`);
          return {
            id: row.id,
            accountId: row.accountId,
            employer: row.employer,
            amount: cents(row.amountCents),
            firstPayDate: localDate(row.firstPayDate),
            intervalDays: row.intervalDays,
          };
        });
    },
    addScheduledBill(customer, bill) {
      if (!getAccount(customer, bill.accountId)) {
        throw new LedgerError("A Scheduled bill must be paid from the customer's own account");
      }
      if (bill.amount <= 0 || !Number.isInteger(bill.dayOfMonth) || bill.dayOfMonth < 1 || bill.dayOfMonth > 31) {
        throw new LedgerError("A Scheduled bill needs an amount above zero and a day of the month from 1 to 31");
      }
      const row = db
        .insert(scheduledBillsTable)
        .values({
          customerId: customer.id,
          accountId: bill.accountId,
          payee: bill.payee,
          amountCents: bill.amount,
          dayOfMonth: bill.dayOfMonth,
          category: bill.category,
        })
        .returning({ id: scheduledBillsTable.id })
        .get();
      return { id: row.id, ...bill };
    },
    listScheduledBills(customer) {
      return db
        .select()
        .from(scheduledBillsTable)
        .where(eq(scheduledBillsTable.customerId, customer.id))
        .orderBy(asc(scheduledBillsTable.id))
        .all()
        .map((row) => ({
          id: row.id,
          accountId: row.accountId,
          payee: row.payee,
          amount: cents(row.amountCents),
          dayOfMonth: row.dayOfMonth,
          category: row.category,
        }));
    },
  };
}
