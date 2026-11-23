import { formatLocalDate, localDateOf } from "./calendar";
import type { Clock } from "./clock";
import type { Account, Customer, CustomerData, LedgerTransaction } from "./customer-data";
import { GUARDRAILS, type Guardrail, type WhyRow } from "./decisions";
import type { LedgerEvent, LedgerEventDispatcher } from "./ledger-events";
import { cents, formatDollars, formatDollarsBriefly, type Cents } from "./money";
import type { Rule } from "./rules";
import { billsBeforePayday, safeToSpend, type BillsBeforePayday } from "./safe-to-spend";
import { EMPLOYERS, type SystemData } from "./system-data";

/** A paycheck deposit: money from an employer's payroll clearing account into one of the customer's accounts. */
interface PayrollDeposit {
  accountId: number;
  amount: Cents;
  employerName: string;
}

/** Everything the guardrails need to judge one Sweep. */
interface ProposedSweep {
  customer: Customer;
  rule: Rule;
  checking: Account;
  amount: Cents;
  bills: BillsBeforePayday;
}

/**
 * Runs each customer's agent on their buffer Rules: when a paycheck lands in a checking account with a
 * switched-on buffer Rule, sweeps the money above the Buffer and bills before payday to savings, rounded
 * down to whole dollars, and writes a Decision log entry. Returns a function that stops it.
 */
export function startBufferAgent(deps: {
  clock: Clock;
  customerData: CustomerData;
  systemData: SystemData;
  ledgerEvents: LedgerEventDispatcher;
}): () => void {
  const { clock, customerData, systemData, ledgerEvents } = deps;

  function payrollDeposit(transaction: LedgerTransaction): PayrollDeposit | undefined {
    for (const employer of Object.values(EMPLOYERS)) {
      const clearing = systemData.ensureSystemAccount(employer.clearingAccount);
      const paid = transaction.entries.find((entry) => entry.accountId === clearing && entry.amount < 0);
      const received = transaction.entries.find((entry) => entry.accountId !== clearing && entry.amount > 0);
      if (paid && received) return { accountId: received.accountId, amount: received.amount, employerName: employer.name };
    }
    return undefined;
  }

  /** The first guardrail the Sweep fails, with the reason, or null if it passes them all. */
  function checkGuardrails(sweep: ProposedSweep): { guardrail: Guardrail; reason: string } | null {
    const { customer, rule, checking, amount, bills } = sweep;
    const checks: Record<Guardrail, () => string | null> = {
      ownership: () =>
        customerData.getAccount(customer, rule.parameters.checkingAccountId) &&
        customerData.getAccount(customer, rule.parameters.savingsAccountId)
          ? null
          : "both accounts must be yours",
      "positive amount": () => (amount > 0 ? null : "the amount must be more than $0"),
      "Rule on": () => (customerData.getRule(customer, rule.id)?.on ? null : "the buffer Rule is switched off"),
      "checking floor": () =>
        checking.balance - amount >= rule.parameters.buffer + bills.total
          ? null
          : `checking would fall below the ${formatDollars(rule.parameters.buffer)} Buffer plus ${formatDollars(bills.total)} of bills`,
    };
    for (const guardrail of GUARDRAILS) {
      const reason = checks[guardrail]();
      if (reason !== null) return { guardrail, reason };
    }
    return null;
  }

  function sweep(customer: Customer, rule: Rule, event: LedgerEvent, deposit: PayrollDeposit): void {
    customerData.inOneTransaction(() => {
      const checking = customerData.getAccount(customer, rule.parameters.checkingAccountId);
      if (!checking) return;
      const bills = billsBeforePayday(customerData, customer, localDateOf(clock.now()));
      const safe = safeToSpend(checking, rule.parameters.buffer, bills);
      const amount = cents(Math.floor(safe.amount / 100) * 100);
      if (amount <= 0) return;

      const savings = customerData.getAccount(customer, rule.parameters.savingsAccountId);
      const savingsName = savings?.name ?? "savings";
      const refusal = checkGuardrails({ customer, rule, checking, amount, bills });
      const why: WhyRow[] = [
        { label: "Trigger", value: `Paycheck of ${formatDollars(deposit.amount)} from ${deposit.employerName} posted` },
        { label: "Bills before payday", value: describeBills(bills) },
        {
          label: "Rule",
          value: `Buffer Rule v${rule.version}: keep ${formatDollarsBriefly(rule.parameters.buffer)} in ${checking.name}, move the rest to ${savingsName}`,
        },
        {
          label: "Amount",
          value: `${formatDollars(safe.checking)} in ${checking.name}, less ${formatDollars(safe.buffer)} Buffer and ${formatDollars(safe.billsBeforePayday)} of bills, rounded down to ${formatDollars(amount)}`,
        },
        {
          label: "Checked by",
          value: refusal
            ? `Refused by the ${refusal.guardrail} guardrail: ${refusal.reason}`
            : `Guardrails passed: ${GUARDRAILS.join(", ")}`,
        },
      ];
      const decision = {
        actor: "agent" as const,
        trigger: { ledgerEventId: event.id, description: `Paycheck from ${deposit.employerName}` },
        rule: { id: rule.id, version: rule.version },
        fromAccountId: checking.id,
        toAccountId: rule.parameters.savingsAccountId,
        amount,
        why,
        reversesDecisionId: null,
      };

      if (refusal) {
        customerData.recordDecision(customer, {
          ...decision,
          action: `Move ${formatDollarsBriefly(amount)} to ${savingsName}`,
          result: "Refused",
          refusedBy: refusal.guardrail,
          ledgerTransactionId: null,
        });
        return;
      }

      const posted = customerData.postLedgerTransaction(customer, {
        idempotencyKey: `sweep:${event.id}`,
        description: `Sweep to ${savingsName}`,
        entries: [
          { accountId: checking.id, amount: cents(-amount) },
          { accountId: rule.parameters.savingsAccountId, amount },
        ],
      });
      if (!posted.created) return;
      customerData.recordDecision(customer, {
        ...decision,
        action: `Moved ${formatDollarsBriefly(amount)} to ${savingsName}`,
        result: "Done",
        refusedBy: null,
        ledgerTransactionId: posted.ledgerTransactionId,
      });
    });
  }

  return ledgerEvents.subscribe((event) => {
    const customer = systemData.findCustomer(event.customerId);
    if (!customer) return;
    const transaction = customerData.getLedgerTransaction(customer, event.ledgerTransactionId);
    const deposit = transaction && payrollDeposit(transaction);
    if (!deposit) return;
    const rules = customerData
      .listRules(customer)
      .filter((rule) => rule.kind === "buffer" && rule.on && rule.parameters.checkingAccountId === deposit.accountId);
    for (const rule of rules) sweep(customer, rule, event, deposit);
  });
}

function describeBills(bills: BillsBeforePayday): string {
  if (bills.nextPayday === null) return "No payday is scheduled, so no bills are counted";
  const before = `before payday on ${formatLocalDate(bills.nextPayday)}`;
  if (bills.bills.length === 0) return `None ${before}`;
  const listed = bills.bills.map((bill) => `${bill.payee} ${formatDollarsBriefly(bill.amount)}`).join(", ");
  return `${formatDollars(bills.total)} ${before}: ${listed}`;
}
