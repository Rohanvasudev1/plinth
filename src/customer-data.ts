import { and, asc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import type { Clock } from "./clock";
import type { Database } from "./db/database";
import {
  accountsTable,
  ledgerEntriesTable,
  ledgerEventsTable,
  ledgerTransactionsTable,
} from "./db/schema";
import type { LedgerEvent, LedgerEventDispatcher } from "./ledger-events";
import { cents, type Cents } from "./money";

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
  /** The Goal's target amount, if this is a savings account with a Goal. */
  goal: Cents | null;
}

export interface NewAccount {
  kind: CustomerAccountKind;
  name: string;
  goal?: Cents;
}

export interface LedgerEntryInput {
  accountId: number;
  amount: Cents;
}

export interface LedgerTransactionInput {
  idempotencyKey: string;
  description: string;
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
  entries: LedgerEntryInput[];
}

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
   * Posts entries that sum to zero, plus a ledger event, in one database transaction, then hands
   * the event to subscribers. Each entry must be on the customer's own account or a system account.
   * Reusing an idempotency key returns the existing ledger transaction and changes nothing.
   */
  postLedgerTransaction(customer: Customer, transaction: LedgerTransactionInput): PostedLedgerTransaction;
  /** Ledger transactions posted for the customer, oldest first, with every entry including the outside side. */
  listLedgerTransactions(customer: Customer): LedgerTransaction[];
}

export class LedgerError extends Error {
  override name = "LedgerError";
}

export function createCustomerData(deps: {
  db: Database;
  clock: Clock;
  ledgerEvents: LedgerEventDispatcher;
}): CustomerData {
  const { db, clock, ledgerEvents } = deps;

  const balanceCents = sql<number>`coalesce(sum(${ledgerEntriesTable.amountCents}), 0)`;

  function selectAccounts(customer: Customer, accountId?: number): Account[] {
    const rows = db
      .select({
        id: accountsTable.id,
        kind: accountsTable.kind,
        name: accountsTable.name,
        goalCents: accountsTable.goalCents,
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
        goal: row.goalCents === null ? null : cents(row.goalCents),
      };
    });
  }

  function getAccount(customer: Customer, accountId: number): Account | undefined {
    return selectAccounts(customer, accountId)[0];
  }

  function validate(customer: Customer, transaction: LedgerTransactionInput): void {
    const { idempotencyKey, entries } = transaction;
    if (idempotencyKey.trim() === "") throw new LedgerError("A ledger transaction needs an idempotency key");
    if (entries.length < 2) throw new LedgerError("A ledger transaction needs at least two entries");
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
            customerId: ledgerTransactionsTable.customerId,
            ledgerEventId: ledgerEventsTable.id,
          })
          .from(ledgerTransactionsTable)
          .innerJoin(ledgerEventsTable, eq(ledgerEventsTable.ledgerTransactionId, ledgerTransactionsTable.id))
          .where(eq(ledgerTransactionsTable.idempotencyKey, transaction.idempotencyKey))
          .get();
        if (existing) {
          if (existing.customerId !== customer.id) {
            throw new LedgerError("That idempotency key belongs to another customer's ledger transaction");
          }
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
    if (result.event) ledgerEvents.dispatch(result.event);
    return result.posted;
  }

  return {
    listAccounts: (customer) => selectAccounts(customer),
    getAccount,
    openAccount(customer, account) {
      const row = db
        .insert(accountsTable)
        .values({ customerId: customer.id, kind: account.kind, name: account.name, goalCents: account.goal ?? null })
        .returning({ id: accountsTable.id })
        .get();
      const opened = getAccount(customer, row.id);
      if (!opened) throw new Error(`Account ${row.id} vanished after it was opened`);
      return opened;
    },
    postLedgerTransaction,
    listLedgerTransactions(customer) {
      const transactions = db
        .select()
        .from(ledgerTransactionsTable)
        .where(eq(ledgerTransactionsTable.customerId, customer.id))
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
        entries: entries
          .filter((entry) => entry.ledgerTransactionId === transaction.id)
          .map((entry) => ({ accountId: entry.accountId, amount: cents(entry.amountCents) })),
      }));
    },
  };
}
