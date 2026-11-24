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
  /**
   * The customer's finished setup: the Buffer of their buffer Rule, which sweeps checking to their first savings
   * account, and the goal that account is for. Null for a customer who hasn't finished setup.
   */
  setup: { buffer: Cents; goal: GoalPreference } | null;
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

/**
 * Fictional customers. Sam's numbers make the 20 Nov 2026 paycheck sweep exactly $340. Alex hasn't finished
 * setup, so sees the Setup survey.
 */
const SEED_CUSTOMERS: SeedCustomer[] = [
  {
    name: "Sam Calloway",
    accounts: [
      { kind: "checking", name: "Checking", openingBalance: cents(227_00) },
      { kind: "savings", name: "House fund", goal: "buy_home", goalTarget: cents(40_000_00), openingBalance: cents(12_400_00) },
    ],
    payroll: { employer: "acme-corp", amount: cents(3_240_00), firstPayDate: localDate("2026-11-20"), intervalDays: 14 },
    bills: [
      { payee: "Rent", category: "Housing", amount: cents(1_450_00), dayOfMonth: 1 },
      { payee: "Internet", category: "Utilities", amount: cents(62_00), dayOfMonth: 2 },
      { payee: "Phone", category: "Utilities", amount: cents(45_00), dayOfMonth: 3 },
      { payee: "Power", category: "Utilities", amount: cents(70_00), dayOfMonth: 3 },
    ],
    setup: { buffer: cents(1_500_00), goal: "buy_home" },
  },
  {
    name: "Priya Natarajan",
    accounts: [
      { kind: "checking", name: "Checking", openingBalance: cents(1_836_42) },
      { kind: "savings", name: "Travel fund", goal: "travel", goalTarget: cents(6_000_00), openingBalance: cents(2_150_00) },
    ],
    payroll: { employer: "acme-corp", amount: cents(2_480_00), firstPayDate: localDate("2026-11-25"), intervalDays: 14 },
    bills: [
      { payee: "Rent", category: "Housing", amount: cents(1_180_00), dayOfMonth: 28 },
      { payee: "Phone", category: "Utilities", amount: cents(38_00), dayOfMonth: 30 },
      { payee: "Gym", category: "Health", amount: cents(29_00), dayOfMonth: 6 },
    ],
    setup: { buffer: cents(500_00), goal: "travel" },
  },
  {
    name: "Alex Okafor",
    accounts: [{ kind: "checking", name: "Checking", openingBalance: cents(400_00) }],
    payroll: { employer: "acme-corp", amount: cents(2_100_00), firstPayDate: localDate("2026-11-27"), intervalDays: 14 },
    bills: [],
    setup: null,
  },
];

/**
 * Seeds the demo customers, their accounts, balances, payrolls, Scheduled bills, and, for customers who have
 * finished setup, their buffer and payment limit Rules and settings records, plus the clearing accounts, once per
 * database.
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
    if (!seed.setup) continue;
    data.createRule(customer, {
      kind: "buffer",
      parameters: { checkingAccountId: accountIds.checking, savingsAccountId: accountIds.savings, buffer: seed.setup.buffer },
      on: true,
    });
    data.createRule(customer, { kind: "payment_limit", parameters: { paymentLimit: SEED_PAYMENT_LIMIT }, on: true });
    data.saveSettings(customer, seedSettings(seed.setup.goal));
  }
}
