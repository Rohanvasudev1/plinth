import { formatDollarsBriefly } from "./money";
import { isSavingsGoal, type AdviceSetting, type AutonomyLevel, type GoalPreference } from "./settings";
import { GOAL_PREFERENCE_TEXT, MARKET_DROP_TEXT, TIME_HORIZON_TEXT } from "./settings-text";
import { GOAL_ACCOUNT_NAMES, type SetupAnswers } from "./setup-answers";

// Copy for the Setup survey, from the demo in prototypes/plinth-demo.html.

/** One line under each goal the survey offers. */
export const GOAL_DETAIL_TEXT: Record<GoalPreference, string> = {
  buy_home: "Grow the House fund",
  emergency_cushion: "3 to 6 months of essentials",
  clear_debt: "Cards first, then loans",
  invest_long_term: "Retirement and beyond",
  travel: "Save for trips",
  spend_less: "Flag overspending early",
};

export const AUTONOMY_CHOICE_TEXT: Record<AutonomyLevel, { label: string; detail: string }> = {
  ask_first: { label: "Ask me before everything", detail: "It suggests; you approve each action" },
  small_things: { label: "Handle small things, ask about big ones", detail: "Acts below your limit and tells you after" },
  within_rules: { label: "Act on anything within my rules", detail: "Tells you after, with Undo" },
};

export const ADVICE_CHOICE_TEXT: Record<AdviceSetting, { label: string; detail?: string }> = {
  never: { label: "Give me the facts and options only", detail: "It never says what it would pick" },
  on_request: { label: "Facts and options, and its view only if I ask" },
  always: { label: "Facts, options and what it would pick" },
};

/** The survey's answers as plain sentences, for the summary before the customer turns the agent on. */
export function setupSummary(answers: SetupAnswers): string[] {
  const goals = answers.goalPreferences;
  const savingsGoals = goals.filter(isSavingsGoal);
  const limit = formatDollarsBriefly(answers.paymentLimit);
  const { trainModels, shareWithPartners, keepChatHistory } = answers.dataChoices;
  return [
    goals.length === 0
      ? "Put spare money toward: nothing yet."
      : `Put spare money toward: ${goals.map((goal) => GOAL_PREFERENCE_TEXT[goal]).join(", ")}.`,
    savingsGoals.length === 0
      ? "Keep spare money in checking, since no savings goal is picked."
      : `Sweep spare money to ${GOAL_ACCOUNT_NAMES[savingsGoals[0]!]} first. Each savings goal has its own account: ${savingsGoals.map((goal) => GOAL_ACCOUNT_NAMES[goal]).join(", ")}.`,
    {
      ask_first: "Suggest everything and wait for my OK.",
      small_things: `Act on its own for anything up to ${limit}, and tell me after.`,
      within_rules: "Act on anything within these rules, and tell me after with an Undo.",
    }[answers.autonomyLevel],
    {
      never: "When you find something, give me the facts and options only.",
      on_request: "When you find something, give me the facts and options, and your view only if I ask.",
      always: "When you find something, give me the facts, the options and what you would pick.",
    }[answers.adviceSetting],
    `Never let checking fall below ${formatDollarsBriefly(answers.buffer)} after bills before payday.`,
    `My Payment limit is ${limit}: when you handle small things, anything bigger needs my OK.`,
    `If investments fell 20% in a month: ${MARKET_DROP_TEXT[answers.riskAnswers.marketDrop]}. I'll need invested money: ${TIME_HORIZON_TEXT[answers.riskAnswers.timeHorizon]}.`,
    trainModels ? "Plinth may train its models on my anonymised data." : "Never train AI models on my data.",
    shareWithPartners ? "Partners may see my data for offers." : "Never share my data with partners.",
    keepChatHistory ? "Keep chat history for 90 days." : "Delete chats at the end of each conversation.",
  ];
}
