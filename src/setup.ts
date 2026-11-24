import type { Account, Customer, CustomerData } from "./customer-data";
import { customerChangeDecision, type NewDecision, type WhyRow } from "./decisions";
import { formatDollarsBriefly } from "./money";
import { describeRule, sweepTargetText } from "./rule-changes";
import { bufferRuleFor, type Rule, type RuleContent } from "./rules";
import { isSavingsGoal, SettingsError, STANDING_SEARCHES_ON, type SavingsGoal, type Settings } from "./settings";
import { settingsRows } from "./settings-text";
import { GOAL_ACCOUNT_NAMES, STANDARD_SETUP, type SetupAnswers } from "./setup-answers";

/**
 * Applies the Setup survey's answers in one database transaction: the next settings version, a Goal account for
 * each savings goal that has none, the buffer Rule aimed at the first savings goal (or at nothing when there is
 * none), the payment limit Rule, and a Decision log entry for each. If anything fails, nothing is written.
 *
 * Running it again reuses the Goal account already open for a goal. A goal left out keeps its account and money,
 * and is simply out of the sweep order. Throws SettingsError if the choices don't fit the settings record, and
 * RuleParametersError if the Buffer or the Payment limit is out of range.
 */
export function applySetup(
  customerData: CustomerData,
  customer: Customer,
  answers: SetupAnswers,
  source: "survey" | "skip",
): Settings {
  return customerData.inOneTransaction(() => {
    const current = customerData.getSettings(customer);
    const isFirstRun = current === undefined;
    if (source === "skip" && !isFirstRun) {
      throw new SettingsError("Skip is only for a customer who hasn't finished setup");
    }
    const trigger =
      source === "skip" ? "You skipped the Setup survey" : isFirstRun ? "You finished the Setup survey" : "You ran setup again";
    const { buffer, paymentLimit, ...choices } = answers;

    // The survey doesn't ask about Standing searches, so their switches stay as they are, or start on.
    const settings = customerData.saveSettings(customer, {
      ...choices,
      standingSearches: current?.standingSearches ?? STANDING_SEARCHES_ON,
    });
    const accounts = customerData.listAccounts(customer);
    const checking = accounts.find((account) => account.kind === "checking");
    if (!checking) throw new SettingsError("Setup needs a checking account to keep the Buffer in");
    const sweepOrder = settings.goalPreferences
      .filter(isSavingsGoal)
      .map((goal) => goalAccount(customerData, customer, accounts, goal));
    const opened = sweepOrder.filter((account) => !accounts.some((existing) => existing.id === account.id));
    customerData.recordDecision(
      customer,
      customerChangeDecision({
        trigger,
        rule: null,
        action: source === "skip" ? "Saved the standard settings" : "Saved your settings from the Setup survey",
        why: [
          { label: "Trigger", value: trigger },
          { label: "Settings", value: `Version ${settings.version}` },
          ...settingsRows(settings),
          {
            label: "Goal accounts opened",
            value: opened.length === 0 ? "None" : opened.map((account) => account.name).join(", "),
          },
        ],
      }),
    );

    const sweepTarget = sweepOrder[0] ?? null;
    const accountName = (accountId: number) =>
      [...accounts, ...opened].find((account) => account.id === accountId)?.name ?? "an account";
    const rules = customerData.listRules(customer);
    const savingsAccountId = sweepTarget?.id ?? null;
    setRule(customerData, customer, bufferRuleFor(rules, checking.id), {
      content: { kind: "buffer", parameters: { checkingAccountId: checking.id, savingsAccountId, buffer } },
      trigger,
      action: `Set the Buffer to ${formatDollarsBriefly(buffer)}, ${sweepTargetText(savingsAccountId, accountName)}`,
      accountName,
    });
    setRule(customerData, customer, rules.find((rule) => rule.kind === "payment_limit"), {
      content: { kind: "payment_limit", parameters: { paymentLimit } },
      trigger,
      action: `Set the Payment limit to ${formatDollarsBriefly(paymentLimit)}`,
      accountName,
    });
    return settings;
  });
}

/**
 * The customer's current answers, for running setup again: their settings record plus the Buffer and the Payment
 * limit from their Rules, or the standard amounts if a Rule is missing. Undefined if they haven't finished setup.
 */
export function readSetupAnswers(customerData: CustomerData, customer: Customer): SetupAnswers | undefined {
  const settings = customerData.getSettings(customer);
  if (!settings) return undefined;
  const { version: _version, createdAt: _createdAt, standingSearches: _standingSearches, ...choices } = settings;
  const checking = customerData.listAccounts(customer).find((account) => account.kind === "checking");
  const rules = customerData.listRules(customer);
  const bufferRule = checking && bufferRuleFor(rules, checking.id);
  const limitRule = rules.find((rule) => rule.kind === "payment_limit");
  return {
    ...choices,
    buffer: bufferRule?.parameters.buffer ?? STANDARD_SETUP.buffer,
    paymentLimit: limitRule?.kind === "payment_limit" ? limitRule.parameters.paymentLimit : STANDARD_SETUP.paymentLimit,
  };
}

/** The customer's Goal account for `goal`, opening one if they have none. */
function goalAccount(customerData: CustomerData, customer: Customer, accounts: Account[], goal: SavingsGoal): Account {
  return (
    accounts.find((account) => account.kind === "savings" && account.goal === goal) ??
    customerData.openAccount(customer, { kind: "savings", name: GOAL_ACCOUNT_NAMES[goal], goal })
  );
}

/**
 * Gives the customer's Rule of this kind these parameters, writing its first version or, if they changed, its next
 * one, with a Decision log entry. A Rule whose parameters are unchanged gets no new version and no entry.
 */
function setRule(
  customerData: CustomerData,
  customer: Customer,
  existing: Rule | undefined,
  change: { content: RuleContent; trigger: string; action: string; accountName: (accountId: number) => string },
): void {
  const { content, trigger, action, accountName } = change;
  const decision = (rule: Rule, why: WhyRow[]): NewDecision =>
    customerChangeDecision({
      trigger,
      rule: { id: rule.id, version: rule.version },
      action,
      why: [{ label: "Trigger", value: trigger }, ...why],
    });

  if (!existing) {
    const created = customerData.createRule(customer, { ...content, on: true });
    customerData.recordDecision(customer, decision(created, [{ label: "Rule", value: describeRule(created, accountName) }]));
    return;
  }
  if (sameParameters(existing.parameters, content.parameters)) return;
  customerData.reviseRule(
    customer,
    existing.id,
    () => ({ parameters: content.parameters }),
    (before, after) =>
      decision(after, [
        { label: "Before", value: describeRule(before, accountName) },
        { label: "After", value: describeRule(after, accountName) },
      ]),
  );
}

/** True when two Rules' parameters hold the same values, whatever order their fields are in. */
function sameParameters(a: RuleContent["parameters"], b: RuleContent["parameters"]): boolean {
  const entries = (parameters: object) => Object.entries(parameters).sort(([x], [y]) => x.localeCompare(y));
  return JSON.stringify(entries(a)) === JSON.stringify(entries(b));
}
