import { startBufferAgent } from "./buffer-agent";
import { localDateOf } from "./calendar";
import type { SettableClock } from "./clock";
import { createCustomerData, type Account, type Customer, type CustomerData } from "./customer-data";
import type { Database } from "./db/database";
import type { Decision, DecisionResult } from "./decisions";
import { createLedgerEventDispatcher, type LedgerEventDispatcher } from "./ledger-events";
import { cents, type Cents } from "./money";
import {
  billsBeforePayday as billsBeforePaydayOf,
  safeToSpend,
  type BillsBeforePayday,
  type SafeToSpend,
} from "./safe-to-spend";
import { bufferRuleFor } from "./rules";
import { createRuleChanges, type RuleChanges } from "./rule-changes";
import { setAgentPaused } from "./pause";
import { seedDemoData } from "./seed";
import type { Settings } from "./settings";
import { changeSettings, type SettingsChange } from "./settings-changes";
import { createSimulator, type Simulator } from "./simulator";
import { createSystemData, type SystemData } from "./system-data";
import { undoAgentAction, type UndoOutcome } from "./undo";

export type { BillBeforePayday, BillsBeforePayday, SafeToSpend } from "./safe-to-spend";
export type { UndoOutcome } from "./undo";

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

/** One of the agent's actions on Home, with its state: Reversed once the customer has undone it. */
export interface AgentActionOnHome {
  decision: Decision;
  state: DecisionResult;
}

export interface HomeView {
  customerName: string;
  today: Date;
  /** True while the customer has paused their agent. */
  agentPaused: boolean;
  checking: HomeAccount | null;
  savings: (HomeAccount & { goal: GoalProgress | null })[];
  billsBeforePayday: BillsBeforePayday;
  /** Null when the customer has no checking account. */
  safeToSpend: SafeToSpend | null;
  /** "What your agent did": every action the customer's agent took or tried to take, newest first. */
  agentActions: AgentActionOnHome[];
  /** Agent actions the customer hasn't been shown yet, newest first, for the toast. */
  unseenAgentActions: Decision[];
}

export class UnknownCustomerError extends Error {
  override name = "UnknownCustomerError";
}

/** The server-side domain API the pages call. */
export interface Bank extends Simulator, RuleChanges {
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
  /** Every action the customer's agent took or tried to take, and every Undo, newest first. */
  readDecisionLog(customer: Customer): Decision[];
  /** Undoes one of the customer's agent actions by posting a reversing ledger transaction (ADR 0002). */
  undo(customer: Customer, decisionId: number): UndoOutcome;
  /** The latest version of the customer's settings record, or undefined if they haven't finished setup. */
  readSettings(customer: Customer): Settings | undefined;
  /**
   * Writes the next version of the customer's settings record and a Decision log entry with them as actor.
   * Throws SettingsError, saving nothing, if they have no settings record or the change doesn't fit its schema.
   */
  changeSettings(customer: Customer, change: SettingsChange): Settings;
  /** Whether the customer's agent is paused. */
  isAgentPaused(customer: Customer): boolean;
  /**
   * Pauses or unpauses the customer's agent, writing a Decision log entry with them as actor. Asking for the
   * state it is already in changes nothing. Returns whether the agent is now paused.
   */
  setAgentPaused(customer: Customer, paused: boolean): boolean;
  /** Marks agent actions as shown to the customer, so the toast shows them only once. */
  markAgentActionsSeen(customer: Customer, decisionIds: number[]): void;
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
    ...createRuleChanges(customerData),
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
    readSettings: (customer) => customerData.getSettings(customer),
    changeSettings: (customer, change) => changeSettings(customerData, customer, change),
    isAgentPaused: (customer) => customerData.isAgentPaused(customer),
    setAgentPaused: (customer, paused) => setAgentPaused(customerData, customer, paused),
    readDecisionLog: (customer) => customerData.listDecisions(customer),
    undo: (customer, decisionId) => undoAgentAction(customerData, customer, decisionId),
    markAgentActionsSeen: (customer, decisionIds) => customerData.markAgentActionsSeen(customer, decisionIds),
    readHome(customer) {
      const accounts = customerData.listAccounts(customer);
      const checking = accounts.find((account) => account.kind === "checking");
      const bills = billsBeforePayday(customer);
      return {
        customerName: customer.name,
        today: clock.now(),
        agentPaused: customerData.isAgentPaused(customer),
        checking: checking ? homeAccount(checking) : null,
        savings: accounts
          .filter((account) => account.kind === "savings")
          .map((account) => ({
            ...homeAccount(account),
            goal: account.goalTarget === null ? null : goalProgress(account.balance, account.goalTarget),
          })),
        billsBeforePayday: bills,
        safeToSpend: checking
          ? safeToSpend(checking, bufferRuleFor(customerData.listRules(customer), checking.id)?.parameters.buffer ?? cents(0), bills)
          : null,
        agentActions: customerData
          .listDecisions(customer)
          .filter((decision) => decision.actor === "agent")
          .map((decision) => ({ decision, state: decision.reversedByDecisionId === null ? decision.result : "Reversed" })),
        unseenAgentActions: customerData.listUnseenAgentActions(customer),
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
