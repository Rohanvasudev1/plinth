import { closedDecisionText, PAYOUT_DESCRIPTION } from "./closure-text";
import type { Clock } from "./clock";
import type { Customer, CustomerData, LedgerEntryInput } from "./customer-data";
import { customerChangeDecision } from "./decisions";
import { unlinkAccount } from "./linked-account-changes";
import type { Mission } from "./missions";
import { cents, type Cents } from "./money";
import type { SystemData } from "./system-data";

// Close and delete: the customer leaves Plinth. Their balances are paid out, their working data deleted, and the
// Ledger, Decision log and access log kept as records. A Closed customer can't sign in, and the Simulator, Sync,
// agents and Standing searches skip them.

export class ClosureError extends Error {
  override name = "ClosureError";
}

export interface ClosureDeps {
  clock: Clock;
  customerData: CustomerData;
  systemData: SystemData;
  /** Stops the customer's running Mission as Stop does: a Stopped Decision log entry and an access log entry. */
  stopMission(customer: Customer, missionId: number): Mission;
}

/** What the confirmation page shows before the customer closes: the amount Plinth will pay out. */
export interface ClosureSummary {
  /** The sum of every Plinth account balance above zero. */
  payout: Cents;
}

/** What came of Close and delete: the amount paid out, and when the customer became Closed. */
export interface ClosureOutcome {
  payout: Cents;
  closedAt: Date;
}

/** The customer's Plinth accounts with a balance above zero, which Close and delete pays out. */
function accountsToPayOut(customerData: CustomerData, customer: Customer) {
  return customerData.listAccounts(customer).filter((account) => account.balance > 0);
}

/** The Close and delete confirmation's figures. Reads only. */
export function readClosureSummary({ customerData }: Pick<ClosureDeps, "customerData">, customer: Customer): ClosureSummary {
  return { payout: cents(accountsToPayOut(customerData, customer).reduce((sum, account) => sum + account.balance, 0)) };
}

/** One pair of entries per account, each paying its balance to the account-closure clearing account. */
function payoutEntries({ customerData, systemData }: ClosureDeps, customer: Customer): LedgerEntryInput[] {
  const clearing = systemData.ensureSystemAccount("accountClosure");
  return accountsToPayOut(customerData, customer).flatMap((account) => [
    { accountId: account.id, amount: cents(-account.balance) },
    { accountId: clearing, amount: account.balance },
  ]);
}

/**
 * Closes the customer's Plinth account in one transaction: stops a running Mission and expires open and snoozed
 * Findings; pays out every Plinth account above zero as one ledger transaction under `closure:<customer id>`; unlinks
 * every Linked account, each with its Decision log and access log entries; deletes Missions, Findings, settings and
 * Goal targets; writes "Closed your Plinth account" with the payout; and marks the customer Closed. Throws
 * ClosureError, changing nothing, if they are already Closed.
 */
export function closeAndDelete(deps: ClosureDeps, customer: Customer): ClosureOutcome {
  const { clock, customerData, systemData } = deps;
  return customerData.inOneTransaction(() => {
    if (systemData.isClosed(customer)) throw new ClosureError("This account is already closed");

    for (const mission of customerData.listMissions(customer)) {
      if (mission.state === "running") deps.stopMission(customer, mission.id);
    }
    customerData.expireLiveFindings(customer);

    const { payout } = readClosureSummary(deps, customer);
    const entries = payoutEntries(deps, customer);
    const posted =
      entries.length === 0
        ? null
        : customerData.postLedgerTransaction(customer, {
            idempotencyKey: `closure:${customer.id}`,
            description: PAYOUT_DESCRIPTION,
            entries,
          });

    for (const linked of customerData.listLinkedAccounts(customer)) unlinkAccount(deps, customer, linked.id, "close");

    customerData.deleteWorkingData(customer);
    customerData.recordDecision(customer, {
      ...customerChangeDecision({ ...closedDecisionText(payout), rule: null }),
      amount: payout,
      ledgerTransactionId: posted?.ledgerTransactionId ?? null,
    });
    const closedAt = clock.now();
    systemData.markClosed(customer, closedAt);
    return { payout, closedAt };
  });
}
