import { STANDING_SEARCHES, type StandingSearch } from "./findings";
import { DATA_CHOICE_KEYS } from "./settings";
import type {
  AdviceSetting,
  AutonomyLevel,
  DataChoice,
  GoalPreference,
  MarketDropAnswer,
  SettingsChoices,
  TimeHorizonAnswer,
} from "./settings";

// Display text for the settings record's choices, shared by the Decision log, the Setup survey and its summary.

/** Each Data choice's name, as the Decision log and Privacy show it. */
export const DATA_CHOICE_TEXT: Record<DataChoice, string> = {
  trainModels: "Train models on my data",
  shareWithPartners: "Share my data with partners",
  keepChatHistory: "Keep chat history",
};

export const AUTONOMY_LEVEL_TEXT: Record<AutonomyLevel, string> = {
  ask_first: "Ask me before everything",
  small_things: "Handle small things, ask about big ones",
  within_rules: "Act on anything within my rules",
};

export const ADVICE_SETTING_TEXT: Record<AdviceSetting, string> = {
  never: "Facts and options only",
  on_request: "Facts and options, and the agent's view only if I ask",
  always: "Facts, options and what the agent would pick",
};

export const MARKET_DROP_TEXT: Record<MarketDropAnswer, string> = {
  sell: "Sell to stop losing more",
  wait: "Wait it out",
  buy_more: "Buy more while prices are low",
  ask_me: "Show me what's going on, then I'll decide",
};

export const TIME_HORIZON_TEXT: Record<TimeHorizonAnswer, string> = {
  under_3_years: "Within 3 years",
  "3_to_10_years": "In 3 to 10 years",
  over_10_years: "More than 10 years",
};

export const GOAL_PREFERENCE_TEXT: Record<GoalPreference, string> = {
  buy_home: "Buy a home",
  emergency_cushion: "Emergency cushion",
  clear_debt: "Clear debt",
  invest_long_term: "Invest for the long term",
  travel: "Travel",
  spend_less: "Spend less",
};

/** Each Standing search's name, and what it does, for its switch. */
export const STANDING_SEARCH_TEXT: Record<StandingSearch, { name: string; description: string; stopLooking: string }> = {
  subscription_price_rises: {
    name: "Subscription price rises",
    description: "Checks your card charges as they post",
    stopLooking: "Stop looking at subscription price rises",
  },
};

function onOff(on: boolean): string {
  return on ? "On" : "Off";
}

function goalsText(goals: GoalPreference[]): string {
  return goals.length === 0 ? "None" : goals.map((goal) => GOAL_PREFERENCE_TEXT[goal]).join(", ");
}

/** Every choice in a settings record as a label and its value in words, always in the same order. */
export function settingsRows(choices: SettingsChoices): { label: string; value: string }[] {
  return [
    { label: "Autonomy level", value: AUTONOMY_LEVEL_TEXT[choices.autonomyLevel] },
    { label: "Advice setting", value: ADVICE_SETTING_TEXT[choices.adviceSetting] },
    { label: "If investments fell 20% in a month", value: MARKET_DROP_TEXT[choices.riskAnswers.marketDrop] },
    { label: "When you'll need invested money", value: TIME_HORIZON_TEXT[choices.riskAnswers.timeHorizon] },
    ...DATA_CHOICE_KEYS.map((choice) => ({ label: DATA_CHOICE_TEXT[choice], value: onOff(choices.dataChoices[choice]) })),
    { label: "Goals, in order", value: goalsText(choices.goalPreferences) },
    ...STANDING_SEARCHES.map((search) => ({
      label: STANDING_SEARCH_TEXT[search].name,
      value: onOff(choices.standingSearches[search]),
    })),
  ];
}
