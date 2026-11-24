import { formatLocalDate } from "./calendar";
import type { Account, Customer, CustomerData } from "./customer-data";
import { GUARDRAILS, guardrailName, type Decision, type Guardrail, type NewDecision, type WhyRow } from "./decisions";
import { cents, formatDollars, formatDollarsBriefly, type Cents } from "./money";
import { describeRule } from "./rule-changes";
import type { BufferRule } from "./rules";
import type { BillsBeforePayday } from "./safe-to-spend";
import type { AutonomyLevel } from "./settings";

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
   * Who is moving the money: the customer, by picking an Option on a Finding, which passes the Payment limit, or
   * the agent alone under the customer's Autonomy level, which decides whether the Payment limit applies.
   */
  approval: { by: "customer" } | { by: "agent"; autonomyLevel: AutonomyLevel };
}

export interface GuardrailRefusal {
  guardrail: Guardrail;
  reason: string;
}

/**
 * The first guardrail the Sweep fails, with the reason, or null if it passes them all. Apart from Pause (ADR
 * 0008), the guardrails read only the customer's Rules; the Autonomy level comes in with the proposed Sweep.
 */
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
    "Payment limit": () => paymentLimitRefusal(customerData, sweep),
  };
  for (const guardrail of GUARDRAILS) {
    const reason = checks[guardrail]();
    if (reason !== null) return { guardrail, reason };
  }
  return null;
}

/** Why the agent may not move this amount alone, or null if it may or the customer chose it. */
function paymentLimitRefusal(customerData: CustomerData, { customer, amount, approval }: ProposedSweep): string | null {
  if (approval.by === "customer") return null;
  switch (approval.autonomyLevel) {
    case "within_rules":
      return null;
    case "ask_first":
      return "you asked your agent to ask you before everything";
    case "small_things": {
      const limit = customerData.listRules(customer).find((rule) => rule.kind === "payment_limit" && rule.on);
      if (limit?.kind !== "payment_limit") return "you have no Payment limit switched on, so your agent asks first";
      return amount <= limit.parameters.paymentLimit
        ? null
        : `${formatDollars(amount)} is over your ${formatDollars(limit.parameters.paymentLimit)} Payment limit`;
    }
  }
}

/**
 * Carries out a Sweep the guardrails judged: if one refused it, or an account isn't the customer's, writes a
 * Refused entry; otherwise posts it under `idempotencyKey` and writes a Done entry. Returns the entry, or
 * undefined when the key had already posted, in which case nothing changed.
 */
export function recordSweep(
  customerData: CustomerData,
  sweep: ProposedSweep,
  refusal: GuardrailRefusal | null,
  entry: { idempotencyKey: string; trigger: Decision["trigger"]; why: WhyRow[] },
): Decision | undefined {
  const { customer, rule, checking, savings, amount } = sweep;
  const decision: Omit<NewDecision, "action" | "result" | "refusedBy" | "ledgerTransactionId"> = {
    actor: "agent",
    trigger: entry.trigger,
    rule: { id: rule.id, version: rule.version },
    fromAccountId: checking?.id ?? null,
    toAccountId: savings?.id ?? null,
    amount,
    why: [...entry.why, checkedByRow(refusal)],
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
