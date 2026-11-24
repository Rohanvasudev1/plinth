import type { LocalDate } from "./calendar";
import type { Account, Customer, CustomerData } from "./customer-data";
import { hasConsentEnded, type LinkedAccount, type LinkedAccountId } from "./linked-accounts";
import { cents, type Cents } from "./money";
import type { LinkedAccountType } from "./open-banking";

/** Where the customer stands, to the cent. Debt is below zero, and Net worth is Cash plus Investments plus Debt. */
export interface NetWorthFigures {
  cash: Cents;
  investments: Cents;
  debt: Cents;
  netWorth: Cents;
}

/** A Linked account on All accounts. Once its Consent has ended it counts in none of the figures. */
export interface LinkedAccountOnPage {
  id: LinkedAccountId;
  institution: string;
  type: LinkedAccountType;
  balance: Cents;
  syncedAt: Date;
  consentStart: LocalDate;
  consentEnd: LocalDate;
  consentEnded: boolean;
}

/** The All accounts page: the four figures, then every Plinth account, then every Linked account. */
export interface AllAccountsView {
  figures: NetWorthFigures;
  plinthAccounts: Pick<Account, "id" | "kind" | "name" | "balance">[];
  linkedAccounts: LinkedAccountOnPage[];
}

/** Which figure each Linked account type counts in. */
const FIGURE_OF_TYPE: Record<LinkedAccountType, "cash" | "investments" | "debt"> = {
  checking: "cash",
  savings: "cash",
  retirement: "investments",
  credit_card: "debt",
  loan: "debt",
};

export function readAllAccounts(customerData: CustomerData, customer: Customer, today: LocalDate): AllAccountsView {
  const plinthAccounts = customerData.listAccounts(customer);
  const linkedAccounts = customerData.listLinkedAccounts(customer).map((linked) => linkedAccountOnPage(linked, today));
  const totals = { cash: 0, investments: 0, debt: 0 };
  for (const account of plinthAccounts) totals.cash += account.balance;
  for (const linked of linkedAccounts) {
    if (!linked.consentEnded) totals[FIGURE_OF_TYPE[linked.type]] += linked.balance;
  }
  return {
    figures: {
      cash: cents(totals.cash),
      investments: cents(totals.investments),
      debt: cents(totals.debt),
      netWorth: cents(totals.cash + totals.investments + totals.debt),
    },
    plinthAccounts: plinthAccounts.map(({ id, kind, name, balance }) => ({ id, kind, name, balance })),
    linkedAccounts,
  };
}

function linkedAccountOnPage(linked: LinkedAccount, today: LocalDate): LinkedAccountOnPage {
  return {
    id: linked.id,
    institution: linked.institution,
    type: linked.type,
    balance: linked.balance,
    syncedAt: linked.syncedAt,
    consentStart: linked.consent.start,
    consentEnd: linked.consent.end,
    consentEnded: hasConsentEnded(linked.consent, today),
  };
}
