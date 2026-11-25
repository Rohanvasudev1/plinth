import { and, asc, eq, isNull } from "drizzle-orm";
import type { Customer } from "./customer-data";
import type { Database } from "./db/database";
import { accountsTable, customersTable, outsideContactsTable } from "./db/schema";
import { asOutsideContactId, type OutsideContact } from "./split";

/**
 * System accounts: one clearing account per simulated outside institution, which takes the
 * outside side of every deposit and payment, and the account that funds seeded opening balances.
 * They belong to no customer and never show in the app.
 */
export const SYSTEM_ACCOUNTS = {
  acmePayroll: { key: "clearing:acme-corp-payroll", name: "Acme Corp payroll" },
  biller: { key: "clearing:biller", name: "Biller" },
  merchant: { key: "clearing:merchant", name: "Merchant" },
  /** Takes a Closed customer's Plinth balances when Close and delete pays them out. */
  accountClosure: { key: "clearing:account-closure", name: "Account closure" },
  openingBalances: { key: "opening-balances", name: "Opening balances" },
} as const;

export type SystemAccount = keyof typeof SYSTEM_ACCOUNTS;

/** The simulated employers that run payrolls, and the clearing account each pays through. */
export const EMPLOYERS = {
  "acme-corp": { name: "Acme Corp", clearingAccount: "acmePayroll" },
} as const satisfies Record<string, { name: string; clearingAccount: SystemAccount }>;

/** An employer's key, used in payroll idempotency keys such as `payroll:acme-corp:2026-11-20`. */
export type Employer = keyof typeof EMPLOYERS;

export function isEmployer(key: string): key is Employer {
  return Object.hasOwn(EMPLOYERS, key);
}

/** Rows that belong to no customer: the customer list itself, the system accounts and the Outside contacts. */
export interface SystemData {
  /** Every customer, Closed ones included, as Sign in as lists them. */
  listCustomers(): Customer[];
  /**
   * Every customer who isn't Closed. The Simulator, Sync and agents loop over these, so a Closed customer stays
   * still.
   */
  listOpenCustomers(): Customer[];
  findCustomer(customerId: number): Customer | undefined;
  /** The customer with this id unless they are Closed. Agents and Standing searches look customers up this way. */
  findOpenCustomer(customerId: number): Customer | undefined;
  createCustomer(name: string): Customer;
  /** Whether the customer used Close and delete. */
  isClosed(customer: Customer): boolean;
  /** Marks the customer Closed at `at`. Close and delete calls it last, in its transaction. */
  markClosed(customer: Customer, at: Date): void;
  /** Creates the system account if it doesn't exist yet, and returns its id. */
  ensureSystemAccount(account: SystemAccount): number;
  /** Adds an Outside contact, a person outside Plinth whom the Simulator plays as a Member. */
  createOutsideContact(name: string): OutsideContact;
  /** Every Outside contact, in the order they were added. */
  listOutsideContacts(): OutsideContact[];
}

const customerColumns = { id: customersTable.id, name: customersTable.name };

export function createSystemData(db: Database): SystemData {
  /** Customers in id order: one by id, only open ones, or both. */
  function selectCustomers(only: { id?: number; open?: boolean }): Customer[] {
    return db
      .select(customerColumns)
      .from(customersTable)
      .where(
        and(
          only.id === undefined ? undefined : eq(customersTable.id, only.id),
          only.open ? isNull(customersTable.closedAtMs) : undefined,
        ),
      )
      .orderBy(asc(customersTable.id))
      .all();
  }

  return {
    listCustomers: () => selectCustomers({}),
    listOpenCustomers: () => selectCustomers({ open: true }),
    findCustomer: (customerId) => selectCustomers({ id: customerId })[0],
    findOpenCustomer: (customerId) => selectCustomers({ id: customerId, open: true })[0],
    createCustomer(name) {
      return db.insert(customersTable).values({ name }).returning(customerColumns).get();
    },
    isClosed: (customer) => selectCustomers({ id: customer.id, open: true }).length === 0,
    markClosed(customer, at) {
      const changed = db
        .update(customersTable)
        .set({ closedAtMs: at.getTime() })
        .where(and(eq(customersTable.id, customer.id), isNull(customersTable.closedAtMs)))
        .run().changes;
      if (changed !== 1) throw new Error(`Customer ${customer.id} is already Closed or doesn't exist`);
    },
    createOutsideContact(name) {
      const row = db.insert(outsideContactsTable).values({ name }).returning().get();
      return { id: asOutsideContactId(row.id), name: row.name };
    },
    listOutsideContacts() {
      return db
        .select()
        .from(outsideContactsTable)
        .orderBy(asc(outsideContactsTable.id))
        .all()
        .map((row) => ({ id: asOutsideContactId(row.id), name: row.name }));
    },
    ensureSystemAccount(account) {
      const { key, name } = SYSTEM_ACCOUNTS[account];
      db.insert(accountsTable)
        .values({ kind: "system", name, systemKey: key })
        .onConflictDoNothing({ target: accountsTable.systemKey })
        .run();
      const row = db
        .select({ id: accountsTable.id })
        .from(accountsTable)
        .where(and(eq(accountsTable.systemKey, key), isNull(accountsTable.customerId)))
        .get();
      if (!row) throw new Error(`System account ${key} is missing`);
      return row.id;
    },
  };
}
