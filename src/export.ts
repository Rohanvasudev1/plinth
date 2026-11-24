import { exportAccess } from "./access-log-text";
import type { AccessReader } from "./access-log";
import type { LocalDate } from "./calendar";
import type { Customer, CustomerAccountKind, CustomerData } from "./customer-data";
import type { Decision } from "./decisions";
import type { Finding, FindingOption } from "./findings";
import type { LinkedAccountType } from "./open-banking";
import type { Mission } from "./missions";
import type { Rule } from "./rules";
import type { SavingsGoal, Settings } from "./settings";

// Every shape here is plain JSON: money is integer cents in fields ending `Cents`, and times are ISO 8601 strings in
// UTC. Dates with no time, such as a Consent's end, stay YYYY-MM-DD.

export interface ExportedPlinthAccount {
  id: number;
  kind: CustomerAccountKind;
  name: string;
  balanceCents: number;
}

export interface ExportedLinkedAccount {
  id: number;
  institution: string;
  type: LinkedAccountType;
  balanceCents: number;
  syncedAt: string;
  consent: { start: LocalDate; end: LocalDate };
}

export interface ExportedLedgerTransaction {
  id: number;
  idempotencyKey: string;
  description: string;
  postedAt: string;
  counterparty: string | null;
  category: string | null;
  /** Every entry, including the outside side on a system account, so each transaction sums to zero. */
  entries: { accountId: number; amountCents: number }[];
}

export type ExportedDecision = Omit<Decision, "at" | "amount"> & { at: string; amountCents: number };

export type ExportedFindingOption =
  | (Omit<Extract<FindingOption, { key: "move" }>, "amount"> & { amountCents: number })
  | Exclude<FindingOption, { key: "move" }>;

export type ExportedFinding = Omit<Finding, "at" | "options" | "subscriptionPrice"> & {
  at: string;
  options: ExportedFindingOption[];
  subscriptionPrice: { merchant: string; priceCents: number } | null;
};

export type ExportedMission = Omit<Mission, "startedAt" | "endedAt"> & { startedAt: string; endedAt: string | null };

export type ExportedSettings = Omit<Settings, "createdAt"> & { createdAt: string };

export interface ExportedRule {
  id: number;
  kind: Rule["kind"];
  versions: { version: number; on: boolean; parameters: Record<string, unknown>; createdAt: string }[];
}

export interface ExportedGoal {
  accountId: number;
  accountName: string;
  goal: SavingsGoal | null;
  targetCents: number | null;
  balanceCents: number;
}

export interface ExportedAccess {
  id: number;
  at: string;
  who: AccessReader;
  what: string;
  why: string;
}

/**
 * Everything Plinth holds about one customer, as one JSON file. Money is integer cents in fields ending `Cents`,
 * times are ISO 8601 strings in UTC, and the customer is named once, at the top.
 */
export interface CustomerExport {
  customer: { id: number; name: string };
  exportedAt: string;
  plinthAccounts: ExportedPlinthAccount[];
  linkedAccounts: ExportedLinkedAccount[];
  /** Oldest first. */
  ledgerTransactions: ExportedLedgerTransaction[];
  /** Newest first. */
  decisionLog: ExportedDecision[];
  findings: ExportedFinding[];
  /** Newest first, each with its Read list. */
  missions: ExportedMission[];
  /** Every version of the settings record, oldest first. Empty before setup. */
  settingsVersions: ExportedSettings[];
  /** Every Rule with every one of its versions, oldest first. */
  rules: ExportedRule[];
  /** Each savings account with a Goal. */
  goals: ExportedGoal[];
  /** Newest first, starting with this Export's own entry. */
  accessLog: ExportedAccess[];
}

/**
 * Writes the Export's access log entry, then builds the file from the customer data layer, in one transaction, so
 * the file holds that entry and nothing of any other customer's.
 */
export function buildExport(deps: { customerData: CustomerData }, customer: Customer): CustomerExport {
  const { customerData } = deps;
  return customerData.inOneTransaction(() => {
    const access = customerData.recordAccess(customer, exportAccess());
    const accounts = customerData.listAccounts(customer);
    const latestSettings = customerData.getSettings(customer);
    return {
      customer: { id: customer.id, name: customer.name },
      exportedAt: access.at.toISOString(),
      plinthAccounts: accounts.map(({ id, kind, name, balance }) => ({ id, kind, name, balanceCents: balance })),
      linkedAccounts: customerData.listLinkedAccounts(customer).map((linked) => ({
        id: linked.id,
        institution: linked.institution,
        type: linked.type,
        balanceCents: linked.balance,
        syncedAt: linked.syncedAt.toISOString(),
        consent: { start: linked.consent.start, end: linked.consent.end },
      })),
      ledgerTransactions: customerData.listLedgerTransactions(customer).map((transaction) => ({
        id: transaction.id,
        idempotencyKey: transaction.idempotencyKey,
        description: transaction.description,
        postedAt: transaction.postedAt.toISOString(),
        counterparty: transaction.counterparty,
        category: transaction.category,
        entries: transaction.entries.map(({ accountId, amount }) => ({ accountId, amountCents: amount })),
      })),
      decisionLog: customerData.listDecisions(customer).map(({ at, amount, ...decision }) => ({
        ...decision,
        at: at.toISOString(),
        amountCents: amount,
      })),
      findings: customerData.listFindings(customer).map(({ at, options, subscriptionPrice, ...finding }) => ({
        ...finding,
        at: at.toISOString(),
        options: options.map(exportOption),
        subscriptionPrice: subscriptionPrice && { merchant: subscriptionPrice.merchant, priceCents: subscriptionPrice.price },
      })),
      missions: customerData.listMissions(customer).map(({ startedAt, endedAt, ...mission }) => ({
        ...mission,
        startedAt: startedAt.toISOString(),
        endedAt: endedAt?.toISOString() ?? null,
      })),
      settingsVersions: versionsUpTo(latestSettings?.version ?? 0).map((version) => {
        const settings = customerData.getSettings(customer, version);
        if (!settings) throw new Error(`Settings version ${version} is missing`);
        const { createdAt, ...choices } = settings;
        return { ...choices, createdAt: createdAt.toISOString() };
      }),
      rules: customerData.listRules(customer).map((latest) => ({
        id: latest.id,
        kind: latest.kind,
        versions: versionsUpTo(latest.version).map((version) => {
          const rule = customerData.getRule(customer, latest.id, version);
          if (!rule) throw new Error(`Rule ${latest.id} version ${version} is missing`);
          return {
            version: rule.version,
            on: rule.on,
            parameters: exportRuleParameters(rule),
            createdAt: rule.createdAt.toISOString(),
          };
        }),
      })),
      goals: accounts
        .filter((account) => account.goal !== null || account.goalTarget !== null)
        .map((account) => ({
          accountId: account.id,
          accountName: account.name,
          goal: account.goal,
          targetCents: account.goalTarget,
          balanceCents: account.balance,
        })),
      accessLog: customerData
        .listAccessLog(customer)
        .map(({ id, at, who, what, why }) => ({ id, at: at.toISOString(), who, what, why })),
    };
  });
}

/** 1 to `latest`. */
function versionsUpTo(latest: number): number[] {
  return Array.from({ length: latest }, (_, index) => index + 1);
}

function exportOption(option: FindingOption): ExportedFindingOption {
  if (option.key !== "move") return option;
  const { amount, ...move } = option;
  return { ...move, amountCents: amount };
}

function exportRuleParameters(rule: Rule): Record<string, unknown> {
  switch (rule.kind) {
    case "buffer": {
      const { buffer, ...parameters } = rule.parameters;
      return { ...parameters, bufferCents: buffer };
    }
    case "payment_limit":
      return { paymentLimitCents: rule.parameters.paymentLimit };
  }
}
