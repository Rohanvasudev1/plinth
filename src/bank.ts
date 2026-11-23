import { startBufferAgent } from "./buffer-agent";
import { localDateOf } from "./calendar";
import type { SettableClock } from "./clock";
import { createCustomerData, type Account, type Customer, type CustomerData } from "./customer-data";
import type { Database } from "./db/database";
import type { Decision, DecisionResult, WhyRow } from "./decisions";
import { createLedgerEventDispatcher, type LedgerEventDispatcher } from "./ledger-events";
import { cents, type Cents } from "./money";
import {
  billsBeforePayday as billsBeforePaydayOf,
  safeToSpend,
  type BillsBeforePayday,
  type SafeToSpend,
} from "./safe-to-spend";
import { bufferRuleFor } from "./rules";
import { seedDemoData } from "./seed";
import { createSimulator, type Simulator } from "./simulator";
import { createSystemData, type SystemData } from "./system-data";
import { undoAgentAction, type UndoResult } from "./undo";

export type { BillBeforePayday, BillsBeforePayday, SafeToSpend } from "./safe-to-spend";
export type { UndoDone, UndoRefused, UndoResult } from "./undo";

/** One agent action as "What your agent did" shows it on Home. */
export interface AgentAction {
  /** The Decision log entry this action is, which Undo names. */
  decisionId: number;
  at: Date;
  /** What the agent did or tried to do, such as "Moved $340 to House fund". */
  action: string;
  /** Done, Refused, or Reversed once the customer has undone it. */
  state: DecisionResult;
  amount: Cents;
  /** The rows of the action's Why panel. */
  why: WhyRow[];
  /** True while the customer can still press Undo: a Done action they haven't undone. */
  canUndo: boolean;
}

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
  /** "What your agent did", newest first. */
  agentActions: AgentAction[];
  /** The actions the customer hasn't been shown yet, which Home toasts once. Newest first. */
  unseenActions: AgentAction[];
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
  /** "What your agent did": the customer's agent actions with their state, newest first. */
  readAgentActions(customer: Customer): AgentAction[];
  /** Puts the money back from one of the customer's agent actions, or says why it can't (ADR 0002). */
  undo(customer: Customer, decisionId: number): UndoResult;
  /** Records that the customer has been shown their agent's actions, so the toast shows once. */
  markAgentActionsSeen(customer: Customer): void;
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

  /**
   * "What your agent did", newest first, and the actions the customer hasn't been shown yet. A Reversed
   * entry is the customer's Undo rather than an action their agent took, so it isn't listed on its own:
   * it turns the action it reverses to Reversed.
   */
  function agentActivity(customer: Customer): { actions: AgentAction[]; unseen: AgentAction[] } {
    const decisions = customerData.listDecisions(customer);
    const undone = new Set(decisions.map((decision) => decision.reversesDecisionId));
    const actions: AgentAction[] = [];
    const unseen: AgentAction[] = [];
    for (const decision of decisions) {
      if (decision.reversesDecisionId !== null) continue;
      const action: AgentAction = {
        decisionId: decision.id,
        at: decision.at,
        action: decision.action,
        state: undone.has(decision.id) ? "Reversed" : decision.result,
        amount: decision.amount,
        why: decision.why,
        canUndo: decision.result === "Done" && !undone.has(decision.id),
      };
      actions.push(action);
      if (decision.seenAt === null) unseen.push(action);
    }
    return { actions, unseen };
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
    readAgentActions: (customer) => agentActivity(customer).actions,
    undo: (customer, decisionId) => undoAgentAction({ customerData }, customer, decisionId),
    markAgentActionsSeen: (customer) => customerData.markDecisionsSeen(customer),
    readHome(customer) {
      const accounts = customerData.listAccounts(customer);
      const checking = accounts.find((account) => account.kind === "checking");
      const bills = billsBeforePayday(customer);
      const activity = agentActivity(customer);
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
          ? safeToSpend(checking, bufferRuleFor(customerData.listRules(customer), checking.id)?.parameters.buffer ?? cents(0), bills)
          : null,
        agentActions: activity.actions,
        unseenActions: activity.unseen,
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
