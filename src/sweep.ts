import { formatLocalDate } from "./calendar";
import type { Account, Customer, CustomerData } from "./customer-data";
import { GUARDRAILS, guardrailName, type Decision, type Guardrail, type NewDecision, type WhyRow } from "./decisions";
import { cents, formatDollars, formatDollarsBriefly, type Cents } from "./money";
import { describeRule } from "./rule-changes";
import type { BufferRule, Rule } from "./rules";
import type { BillsBeforePayday, SafeToSpend } from "./safe-to-spend";
import type { AutonomyLevel } from "./settings";

/** What a Sweep moves: Safe to spend rounded down to whole dollars, or zero when there's none, or no checking account. */
export function sweepAmount(safe: SafeToSpend | null): Cents {
  return cents(safe && safe.amount >= 100 ? safe.amount - (safe.amount % 100) : 0);
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
  /**
   * Who is moving the money, which decides the guardrails that run. A customer who picked an Option on a Finding
   * skips Pause and the Payment limit: Pause stops only automatic actions, and the customer chose this amount. The
   * agent acting alone under "handle small things" also runs the Payment limit guardrail.
   */
  approval: "customer" | "agent" | "agent_under_payment_limit";
}

export interface GuardrailRefusal {
  guardrail: Guardrail;
  reason: string;
}

/** The guardrails a Sweep went through: those that ran, in order, and the one that refused it, if any. */
export interface GuardrailCheck {
  ran: Guardrail[];
  refusal: GuardrailRefusal | null;
}

/** Which guardrails apply to a Sweep, in the order they run. */
function guardrailsFor(approval: ProposedSweep["approval"]): Guardrail[] {
  return GUARDRAILS.filter((guardrail) => {
    if (guardrail === "agent_paused") return approval !== "customer";
    if (guardrail === "Payment limit") return approval === "agent_under_payment_limit";
    return true;
  });
}

/**
 * Runs the guardrails that apply to the Sweep, in order, stopping at the first that refuses it. Apart from Pause
 * (ADR 0008), they read only the customer's Rules (ADR 0007).
 */
export function checkSweepGuardrails(customerData: CustomerData, sweep: ProposedSweep): GuardrailCheck {
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
    "Payment limit": () => {
      const limit = switchedOnPaymentLimit(customerData.listRules(customer));
      if (limit === undefined) return "you have no Payment limit switched on";
      return amount <= limit ? null : `${formatDollars(amount)} is over your ${formatDollars(limit)} Payment limit`;
    },
  };
  const ran: Guardrail[] = [];
  for (const guardrail of guardrailsFor(sweep.approval)) {
    ran.push(guardrail);
    const reason = checks[guardrail]();
    if (reason !== null) return { ran, refusal: { guardrail, reason } };
  }
  return { ran, refusal: null };
}

/** Whether the agent may sweep alone, or must make a Finding and why, under the customer's Autonomy level. */
export type SweepRoute = { route: "act"; approval: ProposedSweep["approval"] } | { route: "ask"; why: string };

/**
 * Chooses, before any guardrail runs, whether the agent sweeps alone or asks with a Finding: always alone under
 * "act on anything within my rules", alone at or under a switched-on Payment limit under "handle small things",
 * and never alone under "ask me before everything".
 */
export function chooseSweepRoute(autonomyLevel: AutonomyLevel, rules: Rule[], amount: Cents): SweepRoute {
  switch (autonomyLevel) {
    case "within_rules":
      return { route: "act", approval: "agent" };
    case "ask_first":
      return { route: "ask", why: "You asked your agent to ask you before everything" };
    case "small_things": {
      const limit = switchedOnPaymentLimit(rules);
      if (limit === undefined) return { route: "ask", why: "You have no Payment limit switched on, so your agent asks first" };
      return amount <= limit
        ? { route: "act", approval: "agent_under_payment_limit" }
        : { route: "ask", why: `${formatDollars(amount)} is over your ${formatDollars(limit)} Payment limit` };
    }
  }
}

function switchedOnPaymentLimit(rules: Rule[]): Cents | undefined {
  const limit = rules.find((rule) => rule.kind === "payment_limit" && rule.on);
  return limit?.kind === "payment_limit" ? limit.parameters.paymentLimit : undefined;
}

/**
 * Carries out a Sweep the guardrails judged: if one refused it, or an account isn't the customer's, writes a
 * Refused entry; otherwise posts it under `idempotencyKey` and writes a Done entry. Returns the entry, or
 * undefined when the key had already posted, in which case nothing changed.
 */
export function recordSweep(
  customerData: CustomerData,
  sweep: ProposedSweep,
  check: GuardrailCheck,
  entry: { idempotencyKey: string; trigger: Decision["trigger"]; why: WhyRow[] },
): Decision | undefined {
  const { customer, rule, checking, savings, amount } = sweep;
  const { refusal } = check;
  const decision: Omit<NewDecision, "action" | "result" | "refusedBy" | "ledgerTransactionId"> = {
    actor: "agent",
    trigger: entry.trigger,
    rule: { id: rule.id, version: rule.version },
    fromAccountId: checking?.id ?? null,
    toAccountId: savings?.id ?? null,
    amount,
    why: [...entry.why, checkedByRow(check)],
    reversesDecisionId: null,
  };
  // Passing the ownership guardrail means both accounts are the customer's; the extra checks narrow the types.
  if (refusal || !checking || !savings) {
    return customerData.recordDecision(customer, {
      ...decision,
      action: `Move ${formatDollarsBriefly(amount)} to ${savings?.name ?? "savings"}`,
      result: "Refused",
      refusedBy: refusal?.guardrail ?? "ownership",
      ledgerTransactionId: null,
    });
  }
  const posted = customerData.postLedgerTransaction(customer, {
    idempotencyKey: entry.idempotencyKey,
    description: `Sweep to ${savings.name}`,
    counterparty: savings.name,
    category: "Savings",
    entries: [
      { accountId: checking.id, amount: cents(-amount) },
      { accountId: savings.id, amount },
    ],
  });
  if (!posted.created) return undefined;
  return customerData.recordDecision(customer, {
    ...decision,
    action: `Moved ${formatDollarsBriefly(amount)} to ${savings.name}`,
    result: "Done",
    refusedBy: null,
    ledgerTransactionId: posted.ledgerTransactionId,
  });
}

/** The "Checked by" row of a Sweep's Decision log entry, naming only the guardrails that ran. */
export function checkedByRow({ ran, refusal }: GuardrailCheck): WhyRow {
  return {
    label: "Checked by",
    value: refusal
      ? `Refused by the ${guardrailName(refusal.guardrail)} guardrail: ${refusal.reason}`
      : `Guardrails passed: ${ran.map(guardrailName).join(", ")}`,
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

/** The "Bills before payday" row of a Sweep's Decision log entry or Finding. */
export function billsRow(bills: BillsBeforePayday): WhyRow {
  return { label: "Bills before payday", value: describeBills(bills) };
}

function describeBills(bills: BillsBeforePayday): string {
  if (bills.nextPayday === null) return "No payday is scheduled, so no bills are counted";
  const before = `before payday on ${formatLocalDate(bills.nextPayday)}`;
  if (bills.bills.length === 0) return `None ${before}`;
  const listed = bills.bills.map((bill) => `${bill.payee} ${formatDollarsBriefly(bill.amount)}`).join(", ");
  return `${formatDollars(bills.total)} ${before}: ${listed}`;
}
