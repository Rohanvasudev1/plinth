import type { Customer, CustomerData, NewAccount } from "./customer-data";
import { cents, type Cents } from "./money";
import type { SystemData } from "./system-data";

interface SeedCustomer {
  name: string;
  accounts: (NewAccount & { openingBalance: Cents })[];
}

/** Fictional customers. Sam's numbers make the 20 Nov 2026 paycheck sweep exactly $340. */
const SEED_CUSTOMERS: SeedCustomer[] = [
  {
    name: "Sam Calloway",
    accounts: [
      { kind: "checking", name: "Checking", openingBalance: cents(227_00) },
      { kind: "savings", name: "House fund", goalTarget: cents(40_000_00), openingBalance: cents(12_400_00) },
    ],
  },
  {
    name: "Priya Natarajan",
    accounts: [
      { kind: "checking", name: "Checking", openingBalance: cents(1_836_42) },
      { kind: "savings", name: "Travel fund", goalTarget: cents(6_000_00), openingBalance: cents(2_150_00) },
    ],
  },
];

/** Seeds the demo customers, their accounts and balances, and the clearing accounts, once per database. */
export function seedDemoData(system: SystemData, data: CustomerData): void {
  system.systemAccountId("acmePayroll");
  system.systemAccountId("biller");
  system.systemAccountId("merchant");
  if (system.listCustomers().length > 0) return;

  const openingBalances = system.systemAccountId("openingBalances");
  for (const seed of SEED_CUSTOMERS) {
    const customer: Customer = system.createCustomer(seed.name);
    for (const { openingBalance, ...newAccount } of seed.accounts) {
      const account = data.openAccount(customer, newAccount);
      data.postLedgerTransaction(customer, {
        idempotencyKey: `opening:${account.id}`,
        description: `Opening balance of ${account.name}`,
        entries: [
          { accountId: account.id, amount: openingBalance },
          { accountId: openingBalances, amount: cents(-openingBalance) },
        ],
      });
    }
  }
}
