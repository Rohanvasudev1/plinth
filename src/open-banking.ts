import { datesAfterThrough, dayOfMonth, localDate, type LocalDate } from "./calendar";
import type { Customer } from "./customer-data";
import { cents, type Cents } from "./money";

// The simulated open banking adapter: fictional Institutions, the accounts each customer holds at them, and their
// balances. No real open banking API is ever called. The adapter returns only an Institution name, account type and
// balance: no account numbers, no transactions.

/** The kinds of account a Linked account can be. */
export const LINKED_ACCOUNT_TYPES = ["checking", "savings", "credit_card", "loan", "retirement"] as const;
export type LinkedAccountType = (typeof LINKED_ACCOUNT_TYPES)[number];

/** The first date the adapter has balances for: the day the simulation starts. */
export const OPEN_BANKING_FROM = localDate("2026-11-19");

interface InstitutionAccountPlan {
  institution: string;
  type: LinkedAccountType;
  /** The customers who hold it, by name, or every customer. */
  heldBy: "everyone" | readonly string[];
  /** The balance on OPEN_BANKING_FROM. */
  opening: Cents;
  /** What each later date adds to the balance. */
  stepOn: (date: LocalDate) => number;
}

const INSTITUTION_ACCOUNTS = {
  // Each later day adds $45.00 of card spending; on the 3rd a payment adds $1,350.00.
  "summit-card": {
    institution: "Summit Card",
    type: "credit_card",
    heldBy: ["Sam Calloway"],
    opening: cents(-2_310_55),
    stepOn: (date) => -45_00 + (dayOfMonth(date) === 3 ? 1_350_00 : 0),
  },
  // On the 1st a contribution adds $270.00, with no returns.
  northwind: {
    institution: "Northwind",
    type: "retirement",
    heldBy: ["Sam Calloway"],
    opening: cents(41_200_00),
    stepOn: (date) => (dayOfMonth(date) === 1 ? 270_00 : 0),
  },
  // On the 15th a pay-down adds $310.00.
  "keystone-student-lending": {
    institution: "Keystone Student Lending",
    type: "loan",
    heldBy: ["Sam Calloway"],
    opening: cents(-14_800_00),
    stepOn: (date) => (dayOfMonth(date) === 15 ? 310_00 : 0),
  },
  "harbor-credit-union": {
    institution: "Harbor Credit Union",
    type: "checking",
    heldBy: "everyone",
    opening: cents(2_140_00),
    stepOn: () => 0,
  },
  "lakeside-bank": {
    institution: "Lakeside Bank",
    type: "savings",
    heldBy: "everyone",
    opening: cents(5_200_00),
    stepOn: () => 0,
  },
} as const satisfies Record<string, InstitutionAccountPlan>;

/** One account at an Institution, such as `summit-card`. */
export type InstitutionAccountKey = keyof typeof INSTITUTION_ACCOUNTS;

export function isInstitutionAccountKey(key: string): key is InstitutionAccountKey {
  return Object.hasOwn(INSTITUTION_ACCOUNTS, key);
}

/** An account the customer holds at an Institution, as the adapter lists it. */
export interface InstitutionAccount {
  key: InstitutionAccountKey;
  institution: string;
  type: LinkedAccountType;
}

export class OpenBankingError extends Error {
  override name = "OpenBankingError";
}

/** The simulated open banking adapter. */
export interface OpenBankingAdapter {
  /** The accounts the customer holds at the Institutions, in a fixed order. */
  listAccounts(customer: Customer): InstitutionAccount[];
  /**
   * The balance in cents, below zero when owed, of one of the customer's Institution accounts at the end of `date`.
   * Throws RangeError for a date before 19 Nov 2026, and OpenBankingError for an account the customer doesn't hold.
   */
  balanceOn(customer: Customer, key: InstitutionAccountKey, date: LocalDate): Cents;
}

function holds(customer: Customer, plan: InstitutionAccountPlan): boolean {
  return plan.heldBy === "everyone" || plan.heldBy.includes(customer.name);
}

export const openBankingAdapter: OpenBankingAdapter = {
  listAccounts(customer) {
    return Object.entries(INSTITUTION_ACCOUNTS)
      .filter(([, plan]) => holds(customer, plan))
      .map(([key, plan]) => ({ key: key as InstitutionAccountKey, institution: plan.institution, type: plan.type }));
  },
  balanceOn(customer, key, date) {
    const plan: InstitutionAccountPlan = INSTITUTION_ACCOUNTS[key];
    if (!holds(customer, plan)) throw new OpenBankingError(`${customer.name} holds no account at ${plan.institution}`);
    if (date < OPEN_BANKING_FROM) throw new RangeError(`The open banking adapter has no balances before ${OPEN_BANKING_FROM}`);
    let balance: number = plan.opening;
    for (const day of datesAfterThrough(OPEN_BANKING_FROM, date)) balance += plan.stepOn(day);
    return cents(balance);
  },
};
