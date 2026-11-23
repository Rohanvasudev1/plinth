import { localDate } from "./calendar";
import type { Customer, CustomerData, NewAccount, NewPayroll, NewScheduledBill } from "./customer-data";
import { cents, type Cents } from "./money";
import type { SystemData } from "./system-data";

interface SeedCustomer {
  name: string;
  accounts: (NewAccount & { openingBalance: Cents })[];
  /** Paid into the customer's checking account. */
  payroll?: Omit<NewPayroll, "accountId">;
  /** Paid from the customer's checking account. */
  bills: Omit<NewScheduledBill, "accountId">[];
  /** The Buffer kept in checking. Stands in for the buffer Rule until Rules exist. */
  buffer: Cents;
}

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
  },
];

/**
 * The customer's Buffer from the seed data, or zero for a customer the seed doesn't know.
 * A stand-in until the buffer Rule holds the Buffer.
 */
export function seededBuffer(customer: Customer): Cents {
  return SEED_CUSTOMERS.find((seed) => seed.name === customer.name)?.buffer ?? cents(0);
}

/** Seeds the demo customers, their accounts, balances, payrolls and Scheduled bills, and the clearing accounts, once per database. */
export function seedDemoData(system: SystemData, data: CustomerData): void {
  system.ensureSystemAccount("acmePayroll");
  system.ensureSystemAccount("biller");
  system.ensureSystemAccount("merchant");
  if (system.listCustomers().length > 0) return;

  const openingBalances = system.ensureSystemAccount("openingBalances");
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
      if (account.kind === "checking") {
        if (seed.payroll) data.addPayroll(customer, { ...seed.payroll, accountId: account.id });
        for (const bill of seed.bills) data.addScheduledBill(customer, { ...bill, accountId: account.id });
      }
    }
  }
}
