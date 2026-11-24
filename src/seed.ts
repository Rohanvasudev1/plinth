import { localDate } from "./calendar";
import type { Customer, CustomerData, NewAccount, NewPayroll, NewScheduledBill } from "./customer-data";
import { cents, type Cents } from "./money";
import type { GoalPreference, SettingsChoices } from "./settings";
import type { SystemData } from "./system-data";

interface SeedCustomer {
  name: string;
  accounts: (NewAccount & { openingBalance: Cents })[];
  /** Paid into the customer's checking account. */
  payroll?: Omit<NewPayroll, "accountId">;
  /** Paid from the customer's checking account. */
  bills: Omit<NewScheduledBill, "accountId">[];
  /** The Buffer of the customer's buffer Rule, which sweeps checking to their first savings account. */
  buffer: Cents;
  /** The goal their savings account is for. */
  goal: GoalPreference;
}

/**
 * The standard choices, except that seeded customers let the agent act on anything within their Rules, so the
 * Sweep behaves as it did before the Autonomy level existed.
 */
function seedSettings(goal: GoalPreference): SettingsChoices {
  return {
    autonomyLevel: "within_rules",
    adviceSetting: "on_request",
    riskAnswers: { marketDrop: "wait", timeHorizon: "over_10_years" },
    dataChoices: { trainModels: false, shareWithPartners: false, keepChatHistory: false },
    goalPreferences: [goal],
  };
}

/** The Payment limit every seeded customer starts with. */
const SEED_PAYMENT_LIMIT = cents(500_00);

/** Fictional customers. Sam's numbers make the 20 Nov 2026 paycheck sweep exactly $340. */
const SEED_CUSTOMERS: SeedCustomer[] = [
  {
    name: "Sam Calloway",
    accounts: [
      { kind: "checking", name: "Checking", openingBalance: cents(227_00) },
      { kind: "savings", name: "House fund", goalTarget: cents(40_000_00), openingBalance: cents(12_400_00) },
    ],
    payroll: { employer: "acme-corp", amount: cents(3_240_00), firstPayDate: localDate("2026-11-20"), intervalDays: 14 },
    bills: [
      { payee: "Rent", amount: cents(1_450_00), dayOfMonth: 1 },
      { payee: "Internet", amount: cents(62_00), dayOfMonth: 2 },
      { payee: "Phone", amount: cents(45_00), dayOfMonth: 3 },
      { payee: "Power", amount: cents(70_00), dayOfMonth: 3 },
    ],
    buffer: cents(1_500_00),
    goal: "buy_home",
  },
  {
    name: "Priya Natarajan",
    accounts: [
      { kind: "checking", name: "Checking", openingBalance: cents(1_836_42) },
      { kind: "savings", name: "Travel fund", goalTarget: cents(6_000_00), openingBalance: cents(2_150_00) },
    ],
    payroll: { employer: "acme-corp", amount: cents(2_480_00), firstPayDate: localDate("2026-11-25"), intervalDays: 14 },
    bills: [
      { payee: "Rent", amount: cents(1_180_00), dayOfMonth: 28 },
      { payee: "Phone", amount: cents(38_00), dayOfMonth: 30 },
      { payee: "Gym", amount: cents(29_00), dayOfMonth: 6 },
    ],
    buffer: cents(500_00),
    goal: "travel",
  },
];

/**
 * Seeds the demo customers, their accounts, balances, payrolls, Scheduled bills, buffer and payment limit Rules
 * and settings records, and the clearing accounts, once per database.
 */
export function seedDemoData(system: SystemData, data: CustomerData): void {
  system.ensureSystemAccount("acmePayroll");
  system.ensureSystemAccount("biller");
  system.ensureSystemAccount("merchant");
  if (system.listCustomers().length > 0) return;

  const openingBalances = system.ensureSystemAccount("openingBalances");
  for (const seed of SEED_CUSTOMERS) {
    const customer: Customer = system.createCustomer(seed.name);
    const accountIds: Partial<Record<NewAccount["kind"], number>> = {};
    for (const { openingBalance, ...newAccount } of seed.accounts) {
      const account = data.openAccount(customer, newAccount);
      accountIds[account.kind] ??= account.id;
      data.postLedgerTransaction(customer, {
        idempotencyKey: `opening:${account.id}`,
        description: `Opening balance of ${account.name}`,
        entries: [
          { accountId: account.id, amount: openingBalance },
          { accountId: openingBalances, amount: cents(-openingBalance) },
        ],
      });
      if (account.kind === "checking") {
        if (seed.payroll) data.addPayroll(customer, { ...seed.payroll, accountId: account.id });
        for (const bill of seed.bills) data.addScheduledBill(customer, { ...bill, accountId: account.id });
      }
    }
    data.createRule(customer, {
      kind: "buffer",
      parameters: { checkingAccountId: accountIds.checking, savingsAccountId: accountIds.savings, buffer: seed.buffer },
      on: true,
    });
    data.createRule(customer, { kind: "payment_limit", parameters: { paymentLimit: SEED_PAYMENT_LIMIT }, on: true });
    data.saveSettings(customer, seedSettings(seed.goal));
  }
}
