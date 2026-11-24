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

export interface ClosedAccount {
  payout: Cents;
  closedAt: Date;
}

/** The entries that pay out each of the customer's Plinth accounts above zero to the account-closure clearing account. */
function payoutEntries({ customerData, systemData }: ClosureDeps, customer: Customer): LedgerEntryInput[] {
  const clearing = systemData.ensureSystemAccount("accountClosure");
  return customerData
    .listAccounts(customer)
    .filter((account) => account.balance > 0)
    .flatMap((account) => [
      { accountId: account.id, amount: cents(-account.balance) },
      { accountId: clearing, amount: account.balance },
    ]);
}

function sumOfPayout(entries: LedgerEntryInput[]): Cents {
  return cents(entries.reduce((sum, entry) => sum + (entry.amount < 0 ? -entry.amount : 0), 0));
}

export function readClosureSummary(deps: ClosureDeps, customer: Customer): ClosureSummary {
  return { payout: sumOfPayout(payoutEntries(deps, customer)) };
}

/**
 * Closes the customer's Plinth account in one transaction: stops a running Mission and expires open and snoozed
 * Findings; pays out every Plinth account above zero as one ledger transaction under `closure:<customer id>`; unlinks
 * every Linked account, each with its Decision log and access log entries; deletes Missions, Findings, settings and
 * Goal targets; writes "Closed your Plinth account" with the payout; and marks the customer Closed. Throws
 * ClosureError, changing nothing, if they are already Closed.
 */
export function closeAccount(deps: ClosureDeps, customer: Customer): ClosedAccount {
  const { clock, customerData, systemData } = deps;
  return customerData.inOneTransaction(() => {
    if (systemData.isClosed(customer)) throw new ClosureError("This account is already closed");

    for (const mission of customerData.listMissions(customer)) {
      if (mission.state === "running") deps.stopMission(customer, mission.id);
    }
    customerData.expireLiveFindings(customer);

    const entries = payoutEntries(deps, customer);
    const payout = sumOfPayout(entries);
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
