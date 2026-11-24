import { readActivity, type ActivityRow } from "./activity";
import { readForecastPage, type ForecastPage } from "./forecast-page";
import { startBufferAgent } from "./buffer-agent";
import { localDateOf } from "./calendar";
import type { SettableClock } from "./clock";
import { createCustomerData, type Account, type Customer, type CustomerData } from "./customer-data";
import type { Database } from "./db/database";
import type { Decision, DecisionResult } from "./decisions";
import { countOpenFindings, readDiscoveriesPage, type DiscoveriesPage } from "./discoveries-page";
import { reopenDueFindings } from "./finding-reminders";
import { chooseOption, type ChooseOptionOutcome } from "./finding-choices";
import type { Finding, FindingOptionKey, StandingSearch } from "./findings";
import { setGoalTarget } from "./goal-changes";
import { readForecast, type Forecast } from "./forecast";
import { createLedgerEventDispatcher, type LedgerEventDispatcher } from "./ledger-events";
import { createFakeMissionModel } from "./fake-mission-model";
import type { MissionModel } from "./mission-model";
import { startMission, type StartedMission } from "./mission-runner";
import type { Mission } from "./missions";
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
import { applySetup, readSetupAnswers } from "./setup";
import { STANDARD_SETUP, type SetupAnswers } from "./setup-answers";
import { createSimulator, type Simulator } from "./simulator";
import { setStandingSearch } from "./standing-searches";
import { startSubscriptionPriceRises } from "./subscription-price-rises";
import { createSystemData, type SystemData } from "./system-data";
import { undoAgentAction, type UndoOutcome } from "./undo";

export type { BillBeforePayday, BillsBeforePayday, SafeToSpend } from "./safe-to-spend";
export type { UndoOutcome } from "./undo";
export type { ActivityRow } from "./activity";
export type { CategoryFigures, ForecastFigures, ForecastPage } from "./forecast-page";
export type { Projection, ProjectionLine, ProjectionLines } from "./projection";
export type { Forecast } from "./forecast";
export type { ChooseOptionOutcome } from "./finding-choices";
export type { AgentsViewOnPage, DiscoveriesPage, FindingOnPage } from "./discoveries-page";
export type { StartedMission } from "./mission-runner";
export type { Mission } from "./missions";

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
  /** The 30-day Forecast of the checking balance. Null when the customer has no checking account. */
  forecast: Forecast | null;
  /**
   * The customer's open sweep Findings, newest first, so they can pick an Option, then their latest closed one, if
   * any. Findings of every kind are on Discoveries.
   */
  findings: Finding[];
  /** How many of the customer's Findings of any kind are open, for the "Your agent found N things" card. */
  openFindingCount: number;
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
  /** The customer's Activity: their posted ledger transactions, newest first, each tagged if their agent made it. */
  readActivity(customer: Customer): ActivityRow[];
  /**
   * The Forecast page: the Usual month of income and spending, this month On pace, and left to save, or "not enough
   * history" when the customer has no full calendar month of history.
   */
  readForecastPage(customer: Customer): ForecastPage;
  billsBeforePayday(customer: Customer): BillsBeforePayday;
  /**
   * The 30-day Forecast of the customer's checking balance, worked out from the ledger now, or null if they have no
   * checking account.
   */
  readForecast(customer: Customer): Forecast | null;
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
  /**
   * Applies the Setup survey's answers in one database transaction: settings, Rules, Goal accounts and Decision log
   * entries. Running it again reuses Goal accounts, and a dropped goal keeps its account and money. If anything
   * fails, nothing is written.
   */
  finishSetup(customer: Customer, answers: SetupAnswers): Settings;
  /** The customer's current survey answers, for running setup again, or undefined if they haven't finished setup. */
  readSetupAnswers(customer: Customer): SetupAnswers | undefined;
  /** Applies the standard Rules and settings, with no goals and so no sweep target, as `finishSetup` does. */
  skipSetup(customer: Customer): Settings;
  /**
   * Sets the Goal's target on one of the customer's savings accounts and writes a Decision log entry with them as
   * actor, or throws GoalError, saving nothing.
   */
  setGoalTarget(customer: Customer, accountId: number, target: Cents): Account;
  /** Whether the customer's agent is paused. */
  isAgentPaused(customer: Customer): boolean;
  /**
   * Pauses or unpauses the customer's agent, writing a Decision log entry with them as actor. Asking for the
   * state it is already in changes nothing. Returns whether the agent is now paused.
   */
  setAgentPaused(customer: Customer, paused: boolean): boolean;
  /** The customer's Findings, open ones first, each group newest first. */
  readFindings(customer: Customer): Finding[];
  /**
   * The Discoveries page: every Finding newest first, each Agent's view shown as the current Advice setting allows,
   * and the open Finding count.
   */
  readDiscoveries(customer: Customer): DiscoveriesPage;
  /**
   * Switches one of the customer's Standing searches on or off, writing the next settings version and a Decision log
   * entry. Off expires the search's open and snoozed Findings; on runs it over existing data. Asking for the state it
   * is already in changes nothing. Throws SettingsError, saving nothing, before setup.
   */
  setStandingSearch(customer: Customer, search: StandingSearch, on: boolean): Settings;
  /** How many of the customer's Findings are open, for the nav bar's Discoveries badge. */
  countOpenFindings(customer: Customer): number;
  /**
   * Carries out the Option the customer picked on one of their open Findings. "Move" re-runs the guardrails and
   * moves money at most once; "Leave it" moves nothing. Either way it writes a Decision log entry.
   */
  chooseOption(customer: Customer, findingId: number, option: FindingOptionKey): ChooseOptionOutcome;
  /** Marks agent actions as shown to the customer, so the toast shows them only once. */
  markAgentActionsSeen(customer: Customer, decisionIds: number[]): void;
  /**
   * Starts a Mission for the customer's question and returns it with a promise that settles once it ends, reported
   * with one Finding or failed keeping nothing. Pages don't await it: the Mission runs on after the response. Throws
   * MissionError, starting nothing, for a blank or overlong question.
   */
  startMission(customer: Customer, question: string): StartedMission;
  /** The customer's Mission with this id, or undefined if it doesn't exist or isn't theirs. */
  readMission(customer: Customer, missionId: number): Mission | undefined;
}

/**
 * Wires the bank to a migrated database and a clock, seeds the demo customers if there are none, and starts
 * the customers' agents.
 */
export function createBank(deps: {
  db: Database;
  clock: SettableClock;
  /** The language model Missions run on. The scripted fake when left out. */
  missionModel?: MissionModel;
}): Bank {
  const { db, clock } = deps;
  const missionModel = deps.missionModel ?? createFakeMissionModel({ clock });
  const ledgerEvents = createLedgerEventDispatcher();
  const customerData = createCustomerData({ db, clock, ledgerEvents });
  const systemData = createSystemData(db);
  // The seed's history posts on its own clock and its own dispatcher, so no agent reacts to it.
  seedDemoData(systemData, customerData, (seedClock) =>
    createCustomerData({ db, clock: seedClock, ledgerEvents: createLedgerEventDispatcher() }),
  );
  const simulator = createSimulator({ clock, systemData, customerData });
  const merchantClearingAccountId = systemData.ensureSystemAccount("merchant");
  startBufferAgent({ clock, customerData, systemData, ledgerEvents });
  startSubscriptionPriceRises({ clock, customerData, systemData, ledgerEvents });

  function billsBeforePayday(customer: Customer): BillsBeforePayday {
    return billsBeforePaydayOf(customerData, customer, localDateOf(clock.now()));
  }

  function forecastFor(customer: Customer): Forecast | null {
    return readForecast({ customerData, merchantClearingAccountId }, customer, clock.now());
  }

  return {
    ...simulator,
    advanceClock() {
      // A reminder date the clock reaches opens its snoozed Finding again, in the same transaction as the move. The
      // clock lives outside that transaction, so it is put back by hand if anything fails.
      const before = clock.now();
      try {
        return customerData.inOneTransaction(() => {
          const advanced = simulator.advanceClock();
          reopenDueFindings({ clock, customerData, systemData });
          return advanced;
        });
      } catch (error) {
        clock.setTo(before);
        throw error;
      }
    },
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
    readForecast: forecastFor,
    readSettings: (customer) => customerData.getSettings(customer),
    changeSettings: (customer, change) => changeSettings(customerData, customer, change),
    finishSetup: (customer, answers) => applySetup(customerData, customer, answers, "survey"),
    setGoalTarget: (customer, accountId, target) => setGoalTarget(customerData, customer, accountId, target),
    readSetupAnswers: (customer) => readSetupAnswers(customerData, customer),
    skipSetup: (customer) => applySetup(customerData, customer, STANDARD_SETUP, "skip"),
    isAgentPaused: (customer) => customerData.isAgentPaused(customer),
    setAgentPaused: (customer, paused) => setAgentPaused(customerData, customer, paused),
    readDecisionLog: (customer) => customerData.listDecisions(customer),
    readActivity: (customer) => readActivity(customerData, customer),
    readForecastPage: (customer) => readForecastPage(customerData, customer, localDateOf(clock.now())),
    readFindings: (customer) => customerData.listFindings(customer),
    readDiscoveries: (customer) => readDiscoveriesPage(customerData, customer),
    setStandingSearch: (customer, search, on) =>
      setStandingSearch({ clock, customerData, systemData }, customer, search, on),
    countOpenFindings: (customer) => countOpenFindings(customerData.listFindings(customer)),
    chooseOption: (customer, findingId, option) => chooseOption({ clock, customerData }, customer, findingId, option),
    undo: (customer, decisionId) => undoAgentAction(customerData, customer, decisionId),
    markAgentActionsSeen: (customer, decisionIds) => customerData.markAgentActionsSeen(customer, decisionIds),
    startMission: (customer, question) =>
      startMission({ clock, customerData, merchantClearingAccountId, model: missionModel }, customer, question),
    readMission: (customer, missionId) => customerData.getMission(customer, missionId),
    readHome(customer) {
      const accounts = customerData.listAccounts(customer);
      const checking = accounts.find((account) => account.kind === "checking");
      const bills = billsBeforePayday(customer);
      const findings = customerData.listFindings(customer);
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
        forecast: forecastFor(customer),
        findings: findingsOnHome(findings.filter((finding) => finding.kind === "sweep")),
        openFindingCount: countOpenFindings(findings),
        agentActions: customerData
          .listDecisions(customer)
          .filter((decision) => decision.actor === "agent")
          .map((decision) => ({ decision, state: decision.reversedByDecisionId === null ? decision.result : "Reversed" })),
        unseenAgentActions: customerData.listUnseenAgentActions(customer),
      };
    },
  };
}

/** Every open Finding, then only the newest chosen or expired one, so old Findings don't pile up on Home. */
function findingsOnHome(findings: Finding[]): Finding[] {
  const open = findings.filter((finding) => finding.state === "open");
  const latestClosed = findings.find((finding) => finding.state !== "open");
  return latestClosed ? [...open, latestClosed] : open;
}

function homeAccount(account: Account): HomeAccount {
  return { id: account.id, name: account.name, balance: account.balance };
}

function goalProgress(balance: Cents, target: Cents): GoalProgress {
  const percent = Math.floor((balance * 100) / target);
  return { target, percentReached: Math.min(100, Math.max(0, percent)) };
}
