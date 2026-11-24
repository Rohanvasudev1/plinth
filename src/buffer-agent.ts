import { formatLocalDate, localDateOf } from "./calendar";
import type { Clock } from "./clock";
import type { Account, Customer, CustomerData, LedgerTransaction } from "./customer-data";
import { GUARDRAILS, guardrailName, type Guardrail, type WhyRow } from "./decisions";
import type { LedgerEvent, LedgerEventDispatcher } from "./ledger-events";
import { cents, formatDollars, formatDollarsBriefly, type Cents } from "./money";
import { describeRule } from "./rule-changes";
import { bufferRuleFor, type BufferRule } from "./rules";
import { billsBeforePayday, safeToSpend, type BillsBeforePayday } from "./safe-to-spend";
import { EMPLOYERS, type SystemData } from "./system-data";

/** A paycheck deposit: money from an employer's payroll clearing account into one of the customer's accounts. */
interface PayrollDeposit {
  accountId: number;
  amount: Cents;
  employerName: string;
}

/** Everything the guardrails need to judge one Sweep. */
export interface ProposedSweep {
  customer: Customer;
  rule: BufferRule;
  /** Undefined when the Rule's account isn't one of the customer's. */
  checking: Account | undefined;
  savings: Account | undefined;
  amount: Cents;
  bills: BillsBeforePayday;
  /** True when the customer picked this Sweep as an Option on a Finding, which passes the Payment limit. */
  chosenByCustomer: boolean;
}

export interface GuardrailRefusal {
  guardrail: Guardrail;
  reason: string;
}

/** The first guardrail the Sweep fails, with the reason, or null if it passes them all. */
export function checkSweepGuardrails(customerData: CustomerData, sweep: ProposedSweep): GuardrailRefusal | null {
  const { customer, rule, checking, savings, amount, bills } = sweep;
  const checks: Record<Guardrail, () => string | null> = {
    agent_paused: () => (customerData.isAgentPaused(customer) ? "Agent paused until you unpause it" : null),
    ownership: () =>
      checking?.kind === "checking" && savings?.kind === "savings"
        ? null
        : "the Rule must name your own checking and savings accounts",
    "positive amount": () => (amount > 0 ? null : "the amount must be more than $0"),
    "Rule on": () => (customerData.getRule(customer, rule.id)?.on ? null : "the buffer Rule is switched off"),
    "Buffer kept": () =>
      checking && checking.balance - amount >= rule.parameters.buffer + bills.total
        ? null
        : `checking would fall below the ${formatDollars(rule.parameters.buffer)} Buffer plus ${formatDollars(bills.total)} of bills`,
    "Payment limit": () => (sweep.chosenByCustomer ? null : paymentLimitRefusal(customerData, customer, amount)),
  };
  for (const guardrail of GUARDRAILS) {
    const reason = checks[guardrail]();
    if (reason !== null) return { guardrail, reason };
  }
  return null;
}

/**
 * Why the Autonomy level doesn't let the agent move `amount` alone, or null if it does. A customer without a
 * settings record hasn't finished setup, so the agent asks before everything.
 */
function paymentLimitRefusal(customerData: CustomerData, customer: Customer, amount: Cents): string | null {
  const autonomyLevel = customerData.getSettings(customer)?.autonomyLevel ?? "ask_first";
  switch (autonomyLevel) {
    case "within_rules":
      return null;
    case "ask_first":
      return "you asked your agent to ask you before everything";
    case "small_things": {
      const limit = customerData
        .listRules(customer)
        .find((rule) => rule.kind === "payment_limit" && rule.on);
      if (limit?.kind !== "payment_limit") return "you have no Payment limit switched on, so your agent asks first";
      return amount <= limit.parameters.paymentLimit
        ? null
        : `${formatDollars(amount)} is over your ${formatDollars(limit.parameters.paymentLimit)} Payment limit`;
    }
  }
}

/** The "Checked by" row of a Sweep's Decision log entry. */
export function checkedByRow(refusal: GuardrailRefusal | null): WhyRow {
  return {
    label: "Checked by",
    value: refusal
      ? `Refused by the ${guardrailName(refusal.guardrail)} guardrail: ${refusal.reason}`
      : `Guardrails passed: ${GUARDRAILS.map(guardrailName).join(", ")}`,
  };
}

/** The "Rule" row of a Sweep's Decision log entry, naming the accounts the buffer Rule uses. */
export function bufferRuleRow(rule: BufferRule, checking: Account | undefined, savings: Account | undefined): WhyRow {
  const checkingName = checking?.name ?? "checking";
  const savingsName = savings?.name ?? "savings";
  return {
    label: "Rule",
    value: describeRule(rule, (accountId) =>
      accountId === rule.parameters.checkingAccountId ? checkingName : savingsName,
    ),
  };
}

/**
 * Runs each customer's agent on their buffer Rules: when a paycheck lands in a checking account with a
 * switched-on buffer Rule, works out the money above the Buffer and bills before payday, rounded down to whole
 * dollars. If the Autonomy level lets the agent move it alone, sweeps it to savings and writes a Decision log
 * entry; otherwise makes a sweep Finding for the customer to pick from. Each paycheck first expires the
 * customer's open sweep Finding, whose numbers it makes stale. Returns a function that stops it.
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

  function sweep(customer: Customer, rule: BufferRule, event: LedgerEvent, deposit: PayrollDeposit): void {
    // Only the customer's own accounts come back, so an account that isn't theirs reads as missing.
    const checking = customerData.getAccount(customer, rule.parameters.checkingAccountId);
    const savings = customerData.getAccount(customer, rule.parameters.savingsAccountId);
    const bills = billsBeforePayday(customerData, customer, localDateOf(clock.now()));
    const safe = checking ? safeToSpend(checking, rule.parameters.buffer, bills) : null;
    // Round down to whole dollars.
    const amount = cents(safe && safe.amount >= 100 ? safe.amount - (safe.amount % 100) : 0);
    const proposed: ProposedSweep = { customer, rule, checking, savings, amount, bills, chosenByCustomer: false };
    const refusal = checkSweepGuardrails(customerData, proposed);
    // With nothing above the Buffer there is no action to take, so nothing is logged, paused or not. Any other
    // refusal is, including Pause, so the customer can see why a sweep didn't happen.
    if (amount <= 0 && refusal?.guardrail !== "ownership") return;

    const checkingName = checking?.name ?? "checking";
    const savingsName = savings?.name ?? "savings";
    const paycheck = `${formatDollars(deposit.amount)} from ${deposit.employerName}`;
    const amountWorkedOut = safe
      ? `${formatDollars(safe.checking)} in ${checkingName}, less ${formatDollars(safe.buffer)} Buffer and ${formatDollars(safe.billsBeforePayday)} of bills, rounded down to ${formatDollars(amount)}`
      : "Not worked out: the Rule doesn't name a checking account of yours";

    // Only the Payment limit stopped it, so the agent asks instead of acting alone. Ownership passed, so both
    // accounts are the customer's; the extra checks narrow the types.
    if (refusal?.guardrail === "Payment limit" && checking && savings) {
      customerData.createFinding(customer, {
        kind: "sweep",
        ledgerEventId: event.id,
        rule: { id: rule.id, version: rule.version },
        facts: [
          { label: "Paycheck", value: paycheck },
          { label: "Bills before payday", value: describeBills(bills) },
          bufferRuleRow(rule, checking, savings),
          { label: "Amount", value: amountWorkedOut },
          { label: "Why your agent is asking", value: capitalise(refusal.reason) },
        ],
        options: [
          { key: "move", amount, fromAccountId: checking.id, toAccountId: savings.id },
          { key: "leave", accountId: checking.id },
        ],
      });
      return;
    }

    const why: WhyRow[] = [
      { label: "Trigger", value: `Paycheck of ${paycheck} posted` },
      { label: "Bills before payday", value: describeBills(bills) },
      bufferRuleRow(rule, checking, savings),
      { label: "Amount", value: amountWorkedOut },
      checkedByRow(refusal),
    ];
    const decision = {
      actor: "agent" as const,
      trigger: { ledgerEventId: event.id, description: `Paycheck from ${deposit.employerName}` },
      rule: { id: rule.id, version: rule.version },
      fromAccountId: checking?.id ?? null,
      toAccountId: savings?.id ?? null,
      amount,
      why,
      reversesDecisionId: null,
    };

    // Passing the ownership guardrail means both accounts are the customer's; the extra checks narrow the types.
    if (refusal || !checking || !savings) {
      customerData.recordDecision(customer, {
        ...decision,
        action: `Move ${formatDollarsBriefly(amount)} to ${savingsName}`,
        result: "Refused",
        refusedBy: refusal?.guardrail ?? "ownership",
        ledgerTransactionId: null,
      });
      return;
    }

    const posted = customerData.postLedgerTransaction(customer, {
      idempotencyKey: `sweep:${event.id}`,
      description: `Sweep to ${savings.name}`,
      entries: [
        { accountId: checking.id, amount: cents(-amount) },
        { accountId: savings.id, amount },
      ],
    });
    if (!posted.created) return;
    customerData.recordDecision(customer, {
      ...decision,
      action: `Moved ${formatDollarsBriefly(amount)} to ${savings.name}`,
      result: "Done",
      refusedBy: null,
      ledgerTransactionId: posted.ledgerTransactionId,
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
      // One sweep per paycheck, under the key sweep:<ledger event id>.
      const rule = bufferRuleFor(customerData.listRules(customer), deposit.accountId);
      if (rule?.on) sweep(customer, rule, event, deposit);
    });
  });
}

export function describeBills(bills: BillsBeforePayday): string {
  if (bills.nextPayday === null) return "No payday is scheduled, so no bills are counted";
  const before = `before payday on ${formatLocalDate(bills.nextPayday)}`;
  if (bills.bills.length === 0) return `None ${before}`;
  const listed = bills.bills.map((bill) => `${bill.payee} ${formatDollarsBriefly(bill.amount)}`).join(", ");
  return `${formatDollars(bills.total)} ${before}: ${listed}`;
}

function capitalise(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
