import { addDays, localDateOf, type LocalDate } from "./calendar";
import type { SettableClock } from "./clock";
import { createCustomerData, type Account, type Customer, type CustomerData } from "./customer-data";
import type { Database } from "./db/database";
import { createLedgerEventDispatcher, type LedgerEventDispatcher } from "./ledger-events";
import { cents, type Cents } from "./money";
import { billsDue, nextPayday, totalOf } from "./schedules";
import { seedDemoData, seededBuffer } from "./seed";
import { createSimulator, type Simulator } from "./simulator";
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

/** Safe to spend: the checking balance minus the Buffer minus Scheduled bills due before the next payday. */
export interface SafeToSpend {
  /** Below zero when checking won't cover the Buffer and the bills. */
  amount: Cents;
  checking: Cents;
  buffer: Cents;
  billsBeforePayday: Cents;
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

export interface BillBeforePayday {
  billId: number;
  payee: string;
  amount: Cents;
  dueDate: LocalDate;
}

/** The customer's Scheduled bills due after today and on or before the day before the next payday. */
export interface BillsBeforePayday {
  /** Null when no payroll pays the customer, in which case no bills are listed. */
  nextPayday: LocalDate | null;
  /** In due-date order. */
  bills: BillBeforePayday[];
  total: Cents;
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
}

/** Wires the bank to a migrated database and a clock, and seeds the demo customers if there are none. */
export function createBank(deps: { db: Database; clock: SettableClock }): Bank {
  const { db, clock } = deps;
  const ledgerEvents = createLedgerEventDispatcher();
  const customerData = createCustomerData({ db, clock, ledgerEvents });
  const systemData = createSystemData(db);
  seedDemoData(systemData, customerData);
  const simulator = createSimulator({ clock, systemData, customerData });

  function billsBeforePayday(customer: Customer): BillsBeforePayday {
    const today = localDateOf(clock.now());
    const payday = nextPayday(customerData.listPayrolls(customer), today);
    if (payday === null) return { nextPayday: null, bills: [], total: cents(0) };
    const due = billsDue(customerData.listScheduledBills(customer), today, addDays(payday, -1));
    return {
      nextPayday: payday,
      bills: due.map(({ bill, dueDate }) => ({ billId: bill.id, payee: bill.payee, amount: bill.amount, dueDate })),
      total: totalOf(due),
    };
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
        safeToSpend: checking ? safeToSpend(checking.balance, seededBuffer(customer), bills.total) : null,
      };
    },
  };
}

function homeAccount(account: Account): HomeAccount {
  return { id: account.id, name: account.name, balance: account.balance };
}

function safeToSpend(checking: Cents, buffer: Cents, billsBeforePayday: Cents): SafeToSpend {
  return { amount: cents(checking - buffer - billsBeforePayday), checking, buffer, billsBeforePayday };
}

function goalProgress(balance: Cents, target: Cents): GoalProgress {
  const percent = Math.floor((balance * 100) / target);
  return { target, percentReached: Math.min(100, Math.max(0, percent)) };
}
