/** How much the agent does alone (ADR 0007). */
export const AUTONOMY_LEVELS = ["ask_first", "small_things", "within_rules"] as const;
export type AutonomyLevel = (typeof AUTONOMY_LEVELS)[number];

/** Whether the agent's own view appears in a Finding. */
export const ADVICE_SETTINGS = ["never", "on_request", "always"] as const;
export type AdviceSetting = (typeof ADVICE_SETTINGS)[number];

/** The raw answer to "If your investments fell 20% in a month, you would:". */
export const MARKET_DROP_ANSWERS = ["sell", "wait", "buy_more", "ask_me"] as const;
export type MarketDropAnswer = (typeof MARKET_DROP_ANSWERS)[number];

/** The raw answer to "When will you need this money?". */
export const TIME_HORIZON_ANSWERS = ["under_3_years", "3_to_10_years", "over_10_years"] as const;
export type TimeHorizonAnswer = (typeof TIME_HORIZON_ANSWERS)[number];

/** The goals a customer can put in order, savings goals and others such as clearing debt. */
export const GOAL_PREFERENCES = [
  "buy_home",
  "emergency_cushion",
  "clear_debt",
  "invest_long_term",
  "travel",
  "spend_less",
] as const;
export type GoalPreference = (typeof GOAL_PREFERENCES)[number];

/** The goal preferences that get a Goal account each. The others, such as Clear debt, hold no money. */
export const SAVINGS_GOALS = ["buy_home", "emergency_cushion", "travel"] as const satisfies readonly GoalPreference[];
export type SavingsGoal = (typeof SAVINGS_GOALS)[number];

export function isSavingsGoal(goal: string): goal is SavingsGoal {
  return (SAVINGS_GOALS as readonly string[]).includes(goal);
}

export interface RiskAnswers {
  marketDrop: MarketDropAnswer;
  timeHorizon: TimeHorizonAnswer;
}

/** The customer's data choices. Each is off unless the customer turns it on. */
export interface DataChoices {
  trainModels: boolean;
  shareWithPartners: boolean;
  keepChatHistory: boolean;
}

/** Everything a settings record holds, without its version. */
export interface SettingsChoices {
  autonomyLevel: AutonomyLevel;
  adviceSetting: AdviceSetting;
  riskAnswers: RiskAnswers;
  dataChoices: DataChoices;
  /** Most important first. No goal appears twice. */
  goalPreferences: GoalPreference[];
}

/** One version of a customer's settings record (ADR 0007). Each change writes the next version. */
export interface Settings extends SettingsChoices {
  version: number;
  createdAt: Date;
}

/** Settings that don't match the settings record's schema, or a change for a customer with no settings record. */
export class SettingsError extends Error {
  override name = "SettingsError";
}

/** Checks `choices` against the settings record's schema and returns them typed, or throws SettingsError. */
export function parseSettingsChoices(choices: unknown): SettingsChoices {
  if (!isObject(choices)) throw new SettingsError("Settings must be an object");
  const { autonomyLevel, adviceSetting, riskAnswers, dataChoices, goalPreferences } = choices;
  if (!isOneOf(AUTONOMY_LEVELS, autonomyLevel)) throw new SettingsError("Unknown Autonomy level");
  if (!isOneOf(ADVICE_SETTINGS, adviceSetting)) throw new SettingsError("Unknown Advice setting");
  if (
    !isObject(riskAnswers) ||
    !isOneOf(MARKET_DROP_ANSWERS, riskAnswers.marketDrop) ||
    !isOneOf(TIME_HORIZON_ANSWERS, riskAnswers.timeHorizon)
  ) {
    throw new SettingsError("Unknown risk answers");
  }
  if (
    !isObject(dataChoices) ||
    typeof dataChoices.trainModels !== "boolean" ||
    typeof dataChoices.shareWithPartners !== "boolean" ||
    typeof dataChoices.keepChatHistory !== "boolean"
  ) {
    throw new SettingsError("Each data choice must be on or off");
  }
  if (
    !Array.isArray(goalPreferences) ||
    !goalPreferences.every((goal) => isOneOf(GOAL_PREFERENCES, goal)) ||
    new Set(goalPreferences).size !== goalPreferences.length
  ) {
    throw new SettingsError("Goal preferences must be known goals, each listed once");
  }
  return {
    autonomyLevel,
    adviceSetting,
    riskAnswers: { marketDrop: riskAnswers.marketDrop, timeHorizon: riskAnswers.timeHorizon },
    dataChoices: {
      trainModels: dataChoices.trainModels,
      shareWithPartners: dataChoices.shareWithPartners,
      keepChatHistory: dataChoices.keepChatHistory,
    },
    goalPreferences: [...goalPreferences],
  };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isOneOf<T extends string>(allowed: readonly T[], value: unknown): value is T {
  return typeof value === "string" && (allowed as readonly string[]).includes(value);
}
