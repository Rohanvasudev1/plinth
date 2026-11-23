import { startBufferAgent } from "./buffer-agent";
import { localDateOf } from "./calendar";
import type { SettableClock } from "./clock";
import { createCustomerData, type Account, type Customer, type CustomerData } from "./customer-data";
import type { Database } from "./db/database";
import type { Decision } from "./decisions";
import { createLedgerEventDispatcher, type LedgerEventDispatcher } from "./ledger-events";
import { cents, type Cents } from "./money";
import {
  billsBeforePayday as billsBeforePaydayOf,
  bufferRuleFor,
  safeToSpend,
  type BillsBeforePayday,
  type SafeToSpend,
} from "./safe-to-spend";
import { seedDemoData } from "./seed";
import { createSimulator, type Simulator } from "./simulator";
import { createSystemData, type SystemData } from "./system-data";

export type { BillBeforePayday, BillsBeforePayday, SafeToSpend } from "./safe-to-spend";

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
  billsBeforePayday: BillsBeforePayday;
  /** Null when the customer has no checking account. */
  safeToSpend: SafeToSpend | null;
}

export class UnknownCustomerError extends Error {
  override name = "UnknownCustomerError";
}

/** The server-side domain API the pages call. */
export interface Bank extends Simulator {
  clock: SettableClock;
  customerData: CustomerData;
  systemData: SystemData;
  ledgerEvents: LedgerEventDispatcher;
  listCustomers(): Customer[];
  /** The customer with this id, or undefined if there is none. */
  findCustomer(customerId: number): Customer | undefined;
  /** The customer to sign in as, or throws UnknownCustomerError. */
  signIn(customerId: number): Customer;
  readHome(customer: Customer): HomeView;
  billsBeforePayday(customer: Customer): BillsBeforePayday;
  /** Every action the customer's agent took or tried to take, newest first. */
  readDecisionLog(customer: Customer): Decision[];
}

/**
 * Wires the bank to a migrated database and a clock, seeds the demo customers if there are none, and starts
 * the customers' agents.
 */
export function createBank(deps: { db: Database; clock: SettableClock }): Bank {
  const { db, clock } = deps;
  const ledgerEvents = createLedgerEventDispatcher();
  const customerData = createCustomerData({ db, clock, ledgerEvents });
  const systemData = createSystemData(db);
  seedDemoData(systemData, customerData);
  const simulator = createSimulator({ clock, systemData, customerData });
  startBufferAgent({ clock, customerData, systemData, ledgerEvents });

  function billsBeforePayday(customer: Customer): BillsBeforePayday {
    return billsBeforePaydayOf(customerData, customer, localDateOf(clock.now()));
  }

  return {
    ...simulator,
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
    billsBeforePayday,
    readDecisionLog: (customer) => customerData.listDecisions(customer),
    readHome(customer) {
      const accounts = customerData.listAccounts(customer);
      const checking = accounts.find((account) => account.kind === "checking");
      const bills = billsBeforePayday(customer);
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
        billsBeforePayday: bills,
        safeToSpend: checking
          ? safeToSpend(checking, bufferRuleFor(customerData, customer, checking.id)?.parameters.buffer ?? cents(0), bills)
          : null,
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
