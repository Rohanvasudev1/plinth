import type { Customer, CustomerData } from "./customer-data";
import { customerChangeDecision, type WhyRow } from "./decisions";
import {
  SettingsError,
  type AdviceSetting,
  type AutonomyLevel,
  type GoalPreference,
  type MarketDropAnswer,
  type Settings,
  type SettingsChoices,
  type TimeHorizonAnswer,
} from "./settings";

/** A change to some of a settings record's choices. Whatever is left out stays as it is. */
export type SettingsChange = Partial<SettingsChoices>;

/**
 * Writes the next version of the customer's settings record with `change` applied, and a Decision log entry with
 * the customer as actor, in one database transaction. Throws SettingsError, saving nothing, if the customer has
 * no settings record yet or the result doesn't match the record's schema.
 */
export function changeSettings(customerData: CustomerData, customer: Customer, change: SettingsChange): Settings {
  return customerData.inOneTransaction(() => {
    const current = customerData.getSettings(customer);
    if (!current) throw new SettingsError("This customer hasn't finished setup, so there are no settings to change");
    const { version: _version, createdAt: _createdAt, ...currentChoices } = current;
    const saved = customerData.saveSettings(customer, { ...currentChoices, ...change });

    const changed = describeDifferences(current, saved);
    const why: WhyRow[] = [
      { label: "Trigger", value: "You changed your settings" },
      { label: "Settings", value: `Version ${current.version} to version ${saved.version}` },
      ...changed,
    ];
    customerData.recordDecision(
      customer,
      customerChangeDecision({
        trigger: "You changed your settings",
        rule: null,
        action:
          changed.length === 0
            ? "Saved your settings unchanged"
            : `Changed your settings: ${changed.map((row) => row.label).join(", ")}`,
        why,
      }),
    );
    return saved;
  });
}

/** One Why row per choice that differs, labelled with the choice and valued "before → after". */
function describeDifferences(before: SettingsChoices, after: SettingsChoices): WhyRow[] {
  const rows: [label: string, before: string, after: string][] = [
    ["Autonomy level", AUTONOMY_LEVEL_TEXT[before.autonomyLevel], AUTONOMY_LEVEL_TEXT[after.autonomyLevel]],
    ["Advice setting", ADVICE_SETTING_TEXT[before.adviceSetting], ADVICE_SETTING_TEXT[after.adviceSetting]],
    [
      "If investments fell 20% in a month",
      MARKET_DROP_TEXT[before.riskAnswers.marketDrop],
      MARKET_DROP_TEXT[after.riskAnswers.marketDrop],
    ],
    [
      "When you'll need invested money",
      TIME_HORIZON_TEXT[before.riskAnswers.timeHorizon],
      TIME_HORIZON_TEXT[after.riskAnswers.timeHorizon],
    ],
    ["Train models on my data", onOff(before.dataChoices.trainModels), onOff(after.dataChoices.trainModels)],
    ["Share my data with partners", onOff(before.dataChoices.shareWithPartners), onOff(after.dataChoices.shareWithPartners)],
    ["Keep chat history", onOff(before.dataChoices.keepChatHistory), onOff(after.dataChoices.keepChatHistory)],
    ["Goals, in order", goalsText(before.goalPreferences), goalsText(after.goalPreferences)],
  ];
  return rows.filter(([, from, to]) => from !== to).map(([label, from, to]) => ({ label, value: `${from} → ${to}` }));
}

const AUTONOMY_LEVEL_TEXT: Record<AutonomyLevel, string> = {
  ask_first: "Ask me before everything",
  small_things: "Handle small things, ask about big ones",
  within_rules: "Act on anything within my rules",
};

const ADVICE_SETTING_TEXT: Record<AdviceSetting, string> = {
  never: "Facts and options only",
  on_request: "Facts and options, and the agent's view only if I ask",
  always: "Facts, options and what the agent would pick",
};

const MARKET_DROP_TEXT: Record<MarketDropAnswer, string> = {
  sell: "Sell to stop losing more",
  wait: "Wait it out",
  buy_more: "Buy more while prices are low",
  ask_me: "Show me what's going on, then I'll decide",
};

const TIME_HORIZON_TEXT: Record<TimeHorizonAnswer, string> = {
  under_3_years: "Within 3 years",
  "3_to_10_years": "In 3 to 10 years",
  over_10_years: "More than 10 years",
};

const GOAL_PREFERENCE_TEXT: Record<GoalPreference, string> = {
  buy_home: "Buy a home",
  emergency_cushion: "Emergency cushion",
  clear_debt: "Clear debt",
  invest_long_term: "Invest for the long term",
  travel: "Travel",
  spend_less: "Spend less",
};

function onOff(on: boolean): string {
  return on ? "On" : "Off";
}

function goalsText(goals: GoalPreference[]): string {
  return goals.length === 0 ? "None" : goals.map((goal) => GOAL_PREFERENCE_TEXT[goal]).join(", ");
}
