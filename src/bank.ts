import type { Clock } from "./clock";
import { createCustomerData, type Account, type Customer, type CustomerData } from "./customer-data";
import type { Database } from "./db/database";
import { createLedgerEventDispatcher, type LedgerEventDispatcher } from "./ledger-events";
import type { Cents } from "./money";
import { seedDemoData } from "./seed";
import { createSystemData, type SystemData } from "./system-data";

export interface GoalProgress {
  target: Cents;
  /** Whole percent of the target held, from 0 to 100. */
  percentReached: number;
}

export interface HomeAccount {
  id: number;
  name: string;
  balance: Cents;
}

export interface HomeView {
  customerName: string;
  today: Date;
  checking: HomeAccount | null;
  savings: (HomeAccount & { goal: GoalProgress | null })[];
}

export class UnknownCustomerError extends Error {
  override name = "UnknownCustomerError";
}

/** The server-side domain API the pages call. */
export interface Bank {
  clock: Clock;
  customerData: CustomerData;
  systemData: SystemData;
  ledgerEvents: LedgerEventDispatcher;
  listCustomers(): Customer[];
  /** The customer with this id, or undefined if there is none. */
  findCustomer(customerId: number): Customer | undefined;
  /** The customer to sign in as, or throws UnknownCustomerError. */
  signIn(customerId: number): Customer;
  readHome(customer: Customer): HomeView;
}

/** Wires the bank to a migrated database and a clock, and seeds the demo customers if there are none. */
export function createBank(deps: { db: Database; clock: Clock }): Bank {
  const { db, clock } = deps;
  const ledgerEvents = createLedgerEventDispatcher();
  const customerData = createCustomerData({ db, clock, ledgerEvents });
  const systemData = createSystemData(db);
  seedDemoData(systemData, customerData);

  return {
    clock,
    customerData,
    systemData,
    ledgerEvents,
    listCustomers: () => systemData.listCustomers(),
    findCustomer: (customerId) => systemData.findCustomer(customerId),
    signIn(customerId) {
      const customer = systemData.findCustomer(customerId);
      if (!customer) throw new UnknownCustomerError(`No customer with id ${customerId}`);
      return customer;
    },
    readHome(customer) {
      const accounts = customerData.listAccounts(customer);
      const checking = accounts.find((account) => account.kind === "checking");
      return {
        customerName: customer.name,
        today: clock.now(),
        checking: checking ? homeAccount(checking) : null,
        savings: accounts
          .filter((account) => account.kind === "savings")
          .map((account) => ({
            ...homeAccount(account),
            goal: account.goalTarget === null ? null : goalProgress(account.balance, account.goalTarget),
          })),
      };
    },
  };
}

function homeAccount(account: Account): HomeAccount {
  return { id: account.id, name: account.name, balance: account.balance };
}

function goalProgress(balance: Cents, target: Cents): GoalProgress {
  const percent = Math.floor((balance * 100) / target);
  return { target, percentReached: Math.min(100, Math.max(0, percent)) };
}
