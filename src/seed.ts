import { dayOfMonth, localDate, localDateOf, sameMonth, sameTimeNextDay, type LocalDate } from "./calendar";
import { fixedClock, type Clock } from "./clock";
import type { Account, Customer, CustomerData, NewAccount, NewPayroll, NewScheduledBill } from "./customer-data";
import { cents, type Cents } from "./money";
import type { GoalPreference, SettingsChoices } from "./settings";
import { billPaymentTransaction, createSimulator, paycheckTransaction, type MerchantKey } from "./simulator";
import { isBillDue, isOnPayCycle } from "./schedules";
import type { SystemData } from "./system-data";

/** A Card purchase from checking on a day of the month, from 1 to 28 so it falls in every month. */
interface SeedPurchase {
  day: number;
  merchant: MerchantKey;
  amount: Cents;
}

/**
 * A customer's past, posted through the ledger by the seed: paychecks counted back from the payroll's first pay
 * date, every Scheduled bill, a fixed monthly pattern of Card purchases and a monthly transfer from checking to
 * their first savings account. It runs from `from` through HISTORY_THROUGH.
 */
interface SeedHistory {
  from: LocalDate;
  monthlyPurchases: SeedPurchase[];
  /** Card purchases on top of the pattern in November, the month the simulation starts in. */
  novemberPurchases: SeedPurchase[];
  monthlyTransfer: { day: number; amount: Cents };
}

interface SeedCustomer {
  name: string;
  /** Each account's balance when it opens, on HISTORY_OPENS, before any history posts. */
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
  /** None for a customer who is new to the bank. */
  history: SeedHistory | null;
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

/** 9am in New York on Thursday 30 April 2026, when the seeded accounts open. History posts at 9am on each later date. */
const HISTORY_OPENS = new Date("2026-04-30T13:00:00Z");

/** The last date of seeded history: the day before the simulation starts on 19 Nov 2026. */
const HISTORY_THROUGH = localDate("2026-11-18");

/**
 * Sam's Card purchases in a usual month: $3,481.00 at the eight Merchants, which with $1,627.00 of Scheduled bills
 * makes the Usual month's $5,108.00 of spending.
 */
const SAMS_MONTHLY_PURCHASES: SeedPurchase[] = [
  { day: 2, merchant: "morning-crumb-cafe", amount: cents(14_50) },
  { day: 3, merchant: "lantern-noodle-bar", amount: cents(58_20) },
  { day: 5, merchant: "morning-crumb-cafe", amount: cents(17_25) },
  { day: 8, merchant: "cityline-transit", amount: cents(127_00) },
  { day: 8, merchant: "morning-crumb-cafe", amount: cents(15_80) },
  { day: 9, merchant: "green-basket-market", amount: cents(268_40) },
  { day: 9, merchant: "bright-reel-cinema", amount: cents(42_50) },
  { day: 10, merchant: "lantern-noodle-bar", amount: cents(71_40) },
  { day: 11, merchant: "morning-crumb-cafe", amount: cents(16_45) },
  { day: 11, merchant: "willow-street-pharmacy", amount: cents(79_30) },
  { day: 12, merchant: "harbor-and-pine-goods", amount: cents(312_40) },
  { day: 13, merchant: "morning-crumb-cafe", amount: cents(13_90) },
  { day: 14, merchant: "lantern-noodle-bar", amount: cents(62_90) },
  { day: 15, merchant: "cityline-transit", amount: cents(41_60) },
  { day: 15, merchant: "tunewell-streaming", amount: cents(18_00) },
  { day: 16, merchant: "green-basket-market", amount: cents(291_15) },
  { day: 17, merchant: "morning-crumb-cafe", amount: cents(18_10) },
  { day: 18, merchant: "harbor-and-pine-goods", amount: cents(348_75) },
  { day: 19, merchant: "lantern-noodle-bar", amount: cents(66_35) },
  { day: 20, merchant: "morning-crumb-cafe", amount: cents(15_20) },
  { day: 21, merchant: "harbor-and-pine-goods", amount: cents(296_10) },
  { day: 21, merchant: "bright-reel-cinema", amount: cents(47_50) },
  { day: 22, merchant: "morning-crumb-cafe", amount: cents(16_95) },
  { day: 23, merchant: "green-basket-market", amount: cents(274_60) },
  { day: 24, merchant: "lantern-noodle-bar", amount: cents(74_10) },
  { day: 24, merchant: "cityline-transit", amount: cents(46_40) },
  { day: 25, merchant: "morning-crumb-cafe", amount: cents(14_85) },
  { day: 25, merchant: "willow-street-pharmacy", amount: cents(88_70) },
  { day: 26, merchant: "morning-crumb-cafe", amount: cents(17_00) },
  { day: 26, merchant: "harbor-and-pine-goods", amount: cents(362_75) },
  { day: 27, merchant: "lantern-noodle-bar", amount: cents(57_05) },
  { day: 28, merchant: "green-basket-market", amount: cents(285_85) },
];

/** Sam's extra Eating out ($300.00) and Shopping ($1,050.00) in November so far, so the month runs hot. */
const SAMS_NOVEMBER_PURCHASES: SeedPurchase[] = [
  { day: 4, merchant: "lantern-noodle-bar", amount: cents(84_60) },
  { day: 4, merchant: "harbor-and-pine-goods", amount: cents(318_20) },
  { day: 6, merchant: "morning-crumb-cafe", amount: cents(21_40) },
  { day: 7, merchant: "lantern-noodle-bar", amount: cents(92_30) },
  { day: 7, merchant: "harbor-and-pine-goods", amount: cents(389_45) },
  { day: 15, merchant: "morning-crumb-cafe", amount: cents(23_60) },
  { day: 16, merchant: "lantern-noodle-bar", amount: cents(78_10) },
  { day: 16, merchant: "harbor-and-pine-goods", amount: cents(342_35) },
];

/** Priya's smaller pattern: $2,447.00 of Card purchases a month at seven Merchants. */
const PRIYAS_MONTHLY_PURCHASES: SeedPurchase[] = [
  { day: 2, merchant: "cityline-transit", amount: cents(127_00) },
  { day: 3, merchant: "morning-crumb-cafe", amount: cents(12_80) },
  { day: 5, merchant: "green-basket-market", amount: cents(268_30) },
  { day: 7, merchant: "morning-crumb-cafe", amount: cents(15_20) },
  { day: 9, merchant: "lantern-noodle-bar", amount: cents(48_60) },
  { day: 10, merchant: "morning-crumb-cafe", amount: cents(13_60) },
  { day: 11, merchant: "willow-street-pharmacy", amount: cents(36_00) },
  { day: 12, merchant: "green-basket-market", amount: cents(291_70) },
  { day: 13, merchant: "harbor-and-pine-goods", amount: cents(402_80) },
  { day: 14, merchant: "morning-crumb-cafe", amount: cents(14_40) },
  { day: 15, merchant: "tunewell-streaming", amount: cents(18_00) },
  { day: 16, merchant: "lantern-noodle-bar", amount: cents(55_40) },
  { day: 17, merchant: "morning-crumb-cafe", amount: cents(13_10) },
  { day: 19, merchant: "green-basket-market", amount: cents(276_45) },
  { day: 20, merchant: "bright-reel-cinema", amount: cents(38_00) },
  { day: 21, merchant: "morning-crumb-cafe", amount: cents(14_90) },
  { day: 23, merchant: "lantern-noodle-bar", amount: cents(52_00) },
  { day: 24, merchant: "morning-crumb-cafe", amount: cents(15_30) },
  { day: 26, merchant: "green-basket-market", amount: cents(283_55) },
  { day: 27, merchant: "harbor-and-pine-goods", amount: cents(437_20) },
  { day: 28, merchant: "morning-crumb-cafe", amount: cents(12_70) },
];

/**
 * Fictional customers. Sam's opening balances and history leave $227.00 in Checking and $12,400.00 in the House
 * fund on 19 Nov, which makes the 20 Nov 2026 paycheck sweep exactly $340. Priya's leave $1,836.42 and $2,150.00.
 * Neither customer's Checking goes below zero. Alex hasn't finished setup, so sees the Setup survey.
 */
const SEED_CUSTOMERS: SeedCustomer[] = [
  {
    name: "Sam Calloway",
    accounts: [
      { kind: "checking", name: "Checking", openingBalance: cents(2_559_60) },
      { kind: "savings", name: "House fund", goal: "buy_home", goalTarget: cents(40_000_00), openingBalance: cents(150_00) },
    ],
    payroll: { employer: "acme-corp", amount: cents(3_240_00), firstPayDate: localDate("2026-11-20"), intervalDays: 14 },
    bills: [
      { payee: "Rent", category: "Housing", amount: cents(1_450_00), dayOfMonth: 1 },
      { payee: "Internet", category: "Utilities", amount: cents(62_00), dayOfMonth: 2 },
      { payee: "Phone", category: "Utilities", amount: cents(45_00), dayOfMonth: 3 },
      { payee: "Power", category: "Utilities", amount: cents(70_00), dayOfMonth: 3 },
    ],
    setup: { buffer: cents(1_500_00), goal: "buy_home" },
    history: {
      from: localDate("2026-05-01"),
      monthlyPurchases: SAMS_MONTHLY_PURCHASES,
      novemberPurchases: SAMS_NOVEMBER_PURCHASES,
      monthlyTransfer: { day: 8, amount: cents(1_750_00) },
    },
  },
  {
    name: "Priya Natarajan",
    accounts: [
      { kind: "checking", name: "Checking", openingBalance: cents(1_436_32) },
      { kind: "savings", name: "Travel fund", goal: "travel", goalTarget: cents(6_000_00), openingBalance: cents(150_00) },
    ],
    payroll: { employer: "acme-corp", amount: cents(2_480_00), firstPayDate: localDate("2026-11-25"), intervalDays: 14 },
    bills: [
      { payee: "Rent", category: "Housing", amount: cents(1_180_00), dayOfMonth: 28 },
      { payee: "Phone", category: "Utilities", amount: cents(38_00), dayOfMonth: 30 },
      { payee: "Gym", category: "Health", amount: cents(29_00), dayOfMonth: 6 },
    ],
    setup: { buffer: cents(500_00), goal: "travel" },
    history: {
      from: localDate("2026-10-01"),
      monthlyPurchases: PRIYAS_MONTHLY_PURCHASES,
      novemberPurchases: [],
      monthlyTransfer: { day: 14, amount: cents(1_000_00) },
    },
  },
  {
    name: "Alex Okafor",
    accounts: [{ kind: "checking", name: "Checking", openingBalance: cents(400_00) }],
    payroll: { employer: "acme-corp", amount: cents(2_100_00), firstPayDate: localDate("2026-11-27"), intervalDays: 14 },
    bills: [],
    setup: null,
    history: null,
  },
];

/**
 * Seeds the demo customers, their accounts, payrolls, Scheduled bills, and, for customers who have finished setup,
 * their buffer and payment limit Rules and settings records, plus the clearing accounts, once per database. Opening
 * balances and history post through `customerDataOn`, a data-access layer on the seed's own clock, so they carry their
 * past dates and never read the bank's time. The bank's agents aren't running yet, so history makes no sweeps and
 * writes no Decision log entries. It all happens in one database transaction.
 */
export function seedDemoData(system: SystemData, data: CustomerData, customerDataOn: (clock: Clock) => CustomerData): void {
  system.ensureSystemAccount("acmePayroll");
  system.ensureSystemAccount("biller");
  system.ensureSystemAccount("merchant");
  if (system.listCustomers().length > 0) return;

  const historyClock = fixedClock(HISTORY_OPENS);
  const ledger = customerDataOn(historyClock);
  const simulator = createSimulator({ clock: historyClock, systemData: system, customerData: ledger });
  const openingBalances = system.ensureSystemAccount("openingBalances");
  data.inOneTransaction(() => {
    for (const seed of SEED_CUSTOMERS) {
      historyClock.setTo(HISTORY_OPENS);
      const customer: Customer = system.createCustomer(seed.name);
      const accountIds: Partial<Record<NewAccount["kind"], number>> = {};
      for (const { openingBalance, ...newAccount } of seed.accounts) {
        const account = data.openAccount(customer, newAccount);
        accountIds[account.kind] ??= account.id;
        ledger.postLedgerTransaction(customer, {
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
      if (seed.history) postHistory(customer, seed.history);
      if (!seed.setup) continue;
      data.createRule(customer, {
        kind: "buffer",
        parameters: { checkingAccountId: accountIds.checking, savingsAccountId: accountIds.savings, buffer: seed.setup.buffer },
        on: true,
      });
      data.createRule(customer, { kind: "payment_limit", parameters: { paymentLimit: SEED_PAYMENT_LIMIT }, on: true });
      data.saveSettings(customer, seedSettings(seed.setup.goal));
    }
  });

  /** Posts each date's paychecks, then bills, then Card purchases, then the transfer, at 9am on that date. */
  function postHistory(customer: Customer, history: SeedHistory): void {
    const accounts = ledger.listAccounts(customer);
    const checking = accounts.find((account) => account.kind === "checking");
    const savings = accounts.find((account) => account.kind === "savings");
    if (!checking || !savings) throw new Error(`${customer.name}'s history needs a checking and a savings account`);
    const payrolls = ledger.listPayrolls(customer);
    const bills = ledger.listScheduledBills(customer);

    for (let at = sameTimeNextDay(HISTORY_OPENS); localDateOf(at) <= HISTORY_THROUGH; at = sameTimeNextDay(at)) {
      const date = localDateOf(at);
      if (date < history.from) continue;
      historyClock.setTo(at);
      for (const payroll of payrolls.filter((candidate) => isOnPayCycle(candidate, date))) {
        ledger.postLedgerTransaction(customer, paycheckTransaction(system, payroll, date));
      }
      for (const bill of bills.filter((candidate) => isBillDue(candidate, date))) {
        ledger.postLedgerTransaction(customer, billPaymentTransaction(system, bill, date));
      }
      const purchases = sameMonth(date, HISTORY_THROUGH)
        ? [...history.monthlyPurchases, ...history.novemberPurchases]
        : history.monthlyPurchases;
      for (const { merchant, amount } of purchases.filter((purchase) => purchase.day === dayOfMonth(date))) {
        const key = `card:${merchant}:${date}`;
        const posted = simulator.cardPurchase(customer, { accountId: checking.id, merchant, amount, idempotencyKey: key });
        // The key holds one purchase per Merchant a day, so a pattern with two would otherwise lose one silently.
        if (!posted.created) throw new Error(`Seeded history has two purchases under ${key}`);
      }
      if (history.monthlyTransfer.day === dayOfMonth(date)) transfer(customer, checking, savings, history.monthlyTransfer.amount, date);
    }
  }

  /**
   * The customer moving money from checking to savings. No app path does this yet, so it posts straight to the
   * ledger with the Category Savings.
   */
  function transfer(customer: Customer, from: Account, to: Account, amount: Cents, date: LocalDate): void {
    ledger.postLedgerTransaction(customer, {
      idempotencyKey: `transfer:${from.id}:${to.id}:${date}`,
      description: `Transfer to ${to.name}`,
      counterparty: to.name,
      category: "Savings",
      entries: [
        { accountId: from.id, amount: cents(-amount) },
        { accountId: to.id, amount },
      ],
    });
  }
}
