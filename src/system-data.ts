import { and, asc, eq, isNull } from "drizzle-orm";
import type { Customer } from "./customer-data";
import type { Database } from "./db/database";
import { accountsTable, customersTable } from "./db/schema";

/**
 * System accounts: one clearing account per simulated outside institution, which takes the
 * outside side of every deposit and payment, and the account that funds seeded opening balances.
 * They belong to no customer and never show in the app.
 */
export const SYSTEM_ACCOUNTS = {
  acmePayroll: { key: "clearing:acme-corp-payroll", name: "Acme Corp payroll" },
  biller: { key: "clearing:biller", name: "Biller" },
  merchant: { key: "clearing:merchant", name: "Merchant" },
  openingBalances: { key: "opening-balances", name: "Opening balances" },
} as const;

export type SystemAccount = keyof typeof SYSTEM_ACCOUNTS;

/** Rows that belong to no customer: the customer list itself and the system accounts. */
export interface SystemData {
  listCustomers(): Customer[];
  findCustomer(customerId: number): Customer | undefined;
  createCustomer(name: string): Customer;
  /** Creates the system account if it doesn't exist yet, and returns its id. */
  ensureSystemAccount(account: SystemAccount): number;
}

export function createSystemData(db: Database): SystemData {
  return {
    listCustomers() {
      return db.select().from(customersTable).orderBy(asc(customersTable.id)).all();
    },
    findCustomer(customerId) {
      return db.select().from(customersTable).where(eq(customersTable.id, customerId)).get();
    },
    createCustomer(name) {
      return db.insert(customersTable).values({ name }).returning().get();
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
