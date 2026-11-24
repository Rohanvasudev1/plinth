import { localDateOf, type LocalDate } from "./calendar";
import type { Category } from "./categories";
import type { Customer, CustomerData, LedgerTransaction } from "./customer-data";
import { cents, type Cents } from "./money";

/** One posted ledger transaction in the customer's Activity. */
export interface ActivityRow {
  ledgerTransactionId: number;
  date: LocalDate;
  /** Null on a transaction posted without one, such as an opening balance. */
  counterparty: string | null;
  category: Category | null;
  description: string;
  /**
   * What the transaction did to the customer's money: positive when money came in, negative when it went out.
   * A move between their own accounts shows the amount that left the account it came from, as a negative.
   */
  amount: Cents;
  /** True when the customer's agent made it: a Done entry by the agent in the Decision log names this transaction. */
  byAgent: boolean;
}

/**
 * The customer's Activity: every posted ledger transaction, newest first. Ledger transactions carry no agent
 * flag, so the "Agent" tag comes from the Decision log.
 */
export function readActivity(customerData: CustomerData, customer: Customer): ActivityRow[] {
  const ownAccountIds = new Set(customerData.listAccounts(customer).map((account) => account.id));
  const agentMade = new Set(
    customerData
      .listDecisions(customer)
      .filter((decision) => decision.actor === "agent" && decision.result === "Done")
      .map((decision) => decision.ledgerTransactionId),
  );
  return customerData
    .listLedgerTransactions(customer)
    .sort((a, b) => b.postedAt.getTime() - a.postedAt.getTime() || b.id - a.id)
    .map((transaction) => ({
      ledgerTransactionId: transaction.id,
      date: localDateOf(transaction.postedAt),
      counterparty: transaction.counterparty,
      category: transaction.category,
      description: transaction.description,
      amount: signedAmount(transaction, ownAccountIds),
      byAgent: agentMade.has(transaction.id),
    }));
}

function signedAmount(transaction: LedgerTransaction, ownAccountIds: Set<number>): Cents {
  const own = transaction.entries.filter((entry) => ownAccountIds.has(entry.accountId));
  const net = own.reduce((sum, entry) => sum + entry.amount, 0);
  if (net !== 0) return cents(net);
  // A move between the customer's own accounts nets to zero, so show what left the account it came from.
  return cents(own.filter((entry) => entry.amount < 0).reduce((sum, entry) => sum + entry.amount, 0));
}
