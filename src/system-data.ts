import { and, asc, eq, isNull } from "drizzle-orm";
import { localDate, type LocalDate } from "./calendar";
import type { Customer } from "./customer-data";
import type { Database } from "./db/database";
import { accountsTable, customersTable, payrollsTable } from "./db/schema";
import { cents, type Cents } from "./money";

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

/**
 * A simulated employer's instruction to pay one customer. It belongs to the employer, the outside
 * institution, so it lives with the system rows; the money it moves still posts through CustomerData.
 */
export interface Payroll {
  id: number;
  customerId: number;
  accountId: number;
  employer: string;
  amount: Cents;
  firstPayDate: LocalDate;
  intervalDays: number;
}

export type NewPayroll = Omit<Payroll, "id">;

/** Rows that belong to no customer: the customer list itself and the system accounts. */
export interface SystemData {
  listCustomers(): Customer[];
  findCustomer(customerId: number): Customer | undefined;
  createCustomer(name: string): Customer;
  /** Creates the system account if it doesn't exist yet, and returns its id. */
  ensureSystemAccount(account: SystemAccount): number;
  addPayroll(payroll: NewPayroll): Payroll;
  /** Every simulated employer's payrolls, in the order they were added. */
  listPayrolls(): Payroll[];
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
    addPayroll(payroll) {
      const row = db
        .insert(payrollsTable)
        .values({
          customerId: payroll.customerId,
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
    listPayrolls() {
      return db
        .select()
        .from(payrollsTable)
        .orderBy(asc(payrollsTable.id))
        .all()
        .map((row) => ({
          id: row.id,
          customerId: row.customerId,
          accountId: row.accountId,
          employer: row.employer,
          amount: cents(row.amountCents),
          firstPayDate: localDate(row.firstPayDate),
          intervalDays: row.intervalDays,
        }));
    },
  };
}
