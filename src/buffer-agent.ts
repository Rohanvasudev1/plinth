import { localDateOf } from "./calendar";
import type { Clock } from "./clock";
import type { Customer, CustomerData, LedgerTransaction } from "./customer-data";
import { SWEEP_SOURCES, sweepFindingTitle } from "./finding-text";
import type { LedgerEvent, LedgerEventDispatcher } from "./ledger-events";
import { formatDollars, type Cents } from "./money";
import { bufferRuleFor, type BufferRule } from "./rules";
import { billsBeforePayday, safeToSpend } from "./safe-to-spend";
import type { AutonomyLevel } from "./settings";
import {
  billsRow,
  bufferRuleRow,
  checkSweepGuardrails,
  chooseSweepRoute,
  recordSweep,
  sweepAmount,
  type ProposedSweep,
} from "./sweep";
import { EMPLOYERS, type SystemData } from "./system-data";

/** A paycheck deposit: money from an employer's payroll clearing account into one of the customer's accounts. */
interface PayrollDeposit {
  accountId: number;
  amount: Cents;
  employerName: string;
}

/**
 * Runs each customer's agent on their buffer Rules: when a paycheck lands in a checking account with a
 * switched-on buffer Rule, works out the money above the Buffer and bills before payday, rounded down to whole
 * dollars. If the Autonomy level lets the agent move it alone, sweeps it to savings and writes a Decision log
 * entry; otherwise makes a sweep Finding for the customer to pick from. Each paycheck first expires the
 * customer's open sweep Finding, whose numbers it makes stale. A customer with no settings record hasn't finished
 * setup, so their agent takes no action. Returns a function that stops it.
 */
export function startBufferAgent(deps: {
  clock: Clock;
  customerData: CustomerData;
  systemData: SystemData;
  ledgerEvents: LedgerEventDispatcher;
}): () => void {
  const { clock, customerData, systemData, ledgerEvents } = deps;
  const employerClearingAccounts = Object.values(EMPLOYERS).map((employer) => ({
    name: employer.name,
    clearing: systemData.ensureSystemAccount(employer.clearingAccount),
  }));

  function payrollDeposit(transaction: LedgerTransaction): PayrollDeposit | undefined {
    for (const employer of employerClearingAccounts) {
      const { clearing } = employer;
      const paid = transaction.entries.find((entry) => entry.accountId === clearing && entry.amount < 0);
      const received = transaction.entries.find((entry) => entry.accountId !== clearing && entry.amount > 0);
      if (paid && received) return { accountId: received.accountId, amount: received.amount, employerName: employer.name };
    }
    return undefined;
  }

  function sweep(
    customer: Customer,
    rule: BufferRule,
    autonomyLevel: AutonomyLevel,
    event: LedgerEvent,
    deposit: PayrollDeposit,
  ): void {
    // Only the customer's own accounts come back, so an account that isn't theirs reads as missing.
    const checking = customerData.getAccount(customer, rule.parameters.checkingAccountId);
    const { savingsAccountId } = rule.parameters;
    const savings = savingsAccountId === null ? undefined : customerData.getAccount(customer, savingsAccountId);
    const bills = billsBeforePayday(customerData, customer, localDateOf(clock.now()));
    const safe = checking ? safeToSpend(checking, rule.parameters.buffer, bills) : null;
    const amount = sweepAmount(safe);
    // The Autonomy level chooses the route before any guardrail runs. Asking makes a Finding, which isn't a refusal.
    const route = chooseSweepRoute(autonomyLevel, customerData.listRules(customer), amount);
    const proposed: ProposedSweep = {
      customer,
      rule,
      checking,
      savings,
      amount,
      bills,
      approval: route.route === "act" ? route.approval : "agent",
    };
    const check = checkSweepGuardrails(customerData, proposed);
    const { refusal } = check;
    // With nothing above the Buffer there is no action to take, so nothing is logged, paused or not. Any other
    // refusal is, including Pause, so the customer can see why a sweep didn't happen.
    if (amount <= 0 && refusal?.guardrail !== "ownership") return;

    const paycheck = `${formatDollars(deposit.amount)} from ${deposit.employerName}`;
    const amountRow = {
      label: "Amount",
      value: safe
        ? `${formatDollars(safe.checking)} in ${checking?.name ?? "checking"}, less ${formatDollars(safe.buffer)} Buffer and ${formatDollars(safe.billsBeforePayday)} of bills, rounded down to ${formatDollars(amount)}`
        : "Not worked out: the Rule doesn't name a checking account of yours",
    };

    // The guardrails passed but the agent may not act alone, so it asks. Ownership passed, so both accounts are
    // the customer's; the extra checks narrow the types. A paused agent was refused above, so it makes no Finding.
    if (route.route === "ask" && !refusal && checking && savings) {
      customerData.createFinding(customer, {
        kind: "sweep",
        title: sweepFindingTitle(amount, checking.name),
        ledgerEventId: event.id,
        rule: { id: rule.id, version: rule.version },
        facts: [
          { label: "Paycheck", value: paycheck, source: SWEEP_SOURCES.paycheck },
          { ...billsRow(bills), source: SWEEP_SOURCES.bills },
          { ...bufferRuleRow(rule, checking, savings), source: SWEEP_SOURCES.rule },
          { ...amountRow, source: SWEEP_SOURCES.amount },
          { label: "Why your agent is asking", value: route.why, source: SWEEP_SOURCES.why },
        ],
        options: [
          { key: "move", amount, fromAccountId: checking.id, toAccountId: savings.id },
          { key: "leave", accountId: checking.id },
        ],
      });
      return;
    }

    recordSweep(customerData, proposed, check, {
      idempotencyKey: `sweep:${event.id}`,
      trigger: { ledgerEventId: event.id, description: `Paycheck from ${deposit.employerName}` },
      why: [
        { label: "Trigger", value: `Paycheck of ${paycheck} posted` },
        billsRow(bills),
        bufferRuleRow(rule, checking, savings),
        amountRow,
      ],
    });
  }

  return ledgerEvents.subscribe((event) => {
    const customer = systemData.findCustomer(event.customerId);
    if (!customer) return;
    const transaction = customerData.getLedgerTransaction(customer, event.ledgerTransactionId);
    const deposit = transaction && payrollDeposit(transaction);
    if (!deposit) return;
    customerData.inOneTransaction(() => {
      // A new paycheck makes the numbers in an open sweep Finding stale, whatever happens next.
      customerData.expireOpenFindings(customer, "sweep");
      const settings = customerData.getSettings(customer);
      if (!settings) return;
      // One sweep per paycheck, under the key sweep:<ledger event id>. A buffer Rule with no sweep target, as after
      // Skip, keeps the Buffer but has nowhere to sweep to, so no action is taken.
      const rule = bufferRuleFor(customerData.listRules(customer), deposit.accountId);
      if (rule?.on && rule.parameters.savingsAccountId !== null) sweep(customer, rule, settings.autonomyLevel, event, deposit);
    });
  });
}
