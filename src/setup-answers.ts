import { cents, type Cents } from "./money";
import { RuleParametersError } from "./rules";
import { parseSettingsChoices, SettingsError, type SavingsGoal, type SettingsChoices } from "./settings";

/**
 * Everything the Setup survey asks: the settings record's choices, plus the Buffer and the Payment limit, which
 * become Rules (ADR 0007).
 */
export interface SetupAnswers extends SettingsChoices {
  buffer: Cents;
  paymentLimit: Cents;
}

/** What Skip applies: standard Rules and settings, every data choice off, and no goals, so no sweep target. */
export const STANDARD_SETUP: SetupAnswers = {
  goalPreferences: [],
  autonomyLevel: "small_things",
  adviceSetting: "on_request",
  buffer: cents(1_500_00),
  paymentLimit: cents(500_00),
  riskAnswers: { marketDrop: "wait", timeHorizon: "over_10_years" },
  dataChoices: { trainModels: false, shareWithPartners: false, keepChatHistory: false },
};

/** The name of the Goal account opened for each savings goal. */
export const GOAL_ACCOUNT_NAMES: Record<SavingsGoal, string> = {
  buy_home: "House fund",
  emergency_cushion: "Emergency cushion",
  travel: "Travel fund",
};

/**
 * Checks survey answers sent from a page and returns them typed. Throws SettingsError for choices that don't fit
 * the settings record, and RuleParametersError for amounts that aren't whole cents; the Rules check their ranges
 * when setup is applied.
 */
export function parseSetupAnswers(answers: unknown): SetupAnswers {
  if (typeof answers !== "object" || answers === null) throw new SettingsError("Setup answers must be an object");
  const { buffer, paymentLimit, ...choices } = answers as Record<string, unknown>;
  if (!Number.isSafeInteger(buffer) || !Number.isSafeInteger(paymentLimit)) {
    throw new RuleParametersError("The Buffer and the Payment limit must be amounts in cents");
  }
  return { ...parseSettingsChoices(choices), buffer: cents(buffer as number), paymentLimit: cents(paymentLimit as number) };
}
