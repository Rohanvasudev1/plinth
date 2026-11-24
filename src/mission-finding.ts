import { localDate, type LocalDate } from "./calendar";
import type { FindingFact, FindingOption, NewFinding } from "./findings";
import { cents } from "./money";
import type { ModelFinding } from "./mission-model";
import { CANT_KNOW_LABEL, CANT_KNOW_SOURCE, MISSION_FAILURES, missionReportFromFacts } from "./mission-text";

/** The Options a Mission's Finding may offer (ADR 0009). */
export const MISSION_OPTION_KEYS = ["move", "read_report", "remind_me", "not_now"] as const;

/** The Options a Mission's Finding gets when none of the model's survive the checks. */
const DEFAULT_OPTIONS: FindingOption[] = [{ key: "read_report" }, { key: "not_now" }];

/** The parts of a Mission's Finding the model wrote, checked and ready to store. */
export type MissionFindingToStore = Pick<NewFinding, "title" | "facts" | "options" | "agentsView" | "report">;

/** What the checks know beyond the Finding: today, and the asking customer's own accounts, which a Move must name. */
export interface MissionFindingContext {
  sourceOf: (toolCallId: string) => string | undefined;
  today: LocalDate;
  accounts: { id: number; name: string }[];
}

/** The checked Finding, or why the Mission fails. */
export type CheckedMissionFinding = { ok: true; finding: MissionFindingToStore } | { ok: false; reason: string };

/** A number written as digits, or as a number word, such as "six" or "a hundred". */
const NUMBER = String.raw`(?:\d[\d,.]*|(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty|thirty|forty|fifty|hundred|thousand|half)\b)`;

/**
 * A money amount or a rate: a currency sign or code next to a number, a digit next to `%`, or a number followed by
 * "percent" or "dollars". Only a cited fact may state one, so What Plinth can't know never states an outside price
 * or rate. Other numbers, such as a year, are allowed (decision on #53).
 */
const MONEY_OR_RATE = new RegExp(
  [
    String.raw`[$€£¥]\s?\d`,
    String.raw`\b(?:USD|EUR|GBP)\s?\d`,
    String.raw`\d\s?(?:USD|EUR|GBP)\b`,
    String.raw`\d\s?%`,
    String.raw`\b${NUMBER}\s*(?:percent|per cent|dollars?)\b`,
  ].join("|"),
  "i",
);

/**
 * Checks the Finding a Mission's model returned (ADR 0009):
 *
 * - It needs a title and at least one fact. A fact that cites no tool call from this Mission fails it. Each fact's
 *   Source is the Source of the tool call it cites, so the model can't write its own.
 * - What Plinth can't know, when the model says, becomes a fact of its own, with a fixed Source since no tool call
 *   could have read it. It may state no money amount or rate, so outside prices and rates can't slip in uncited;
 *   one that does fails the Mission.
 * - An Option not on the Mission list, a repeat, or one whose details don't check is dropped. Remind me needs a
 *   real date after today. Move names its accounts by their Plinth names, as the tools do, and needs two different
 *   accounts of the customer's own and a positive whole number of cents. The guardrails run again when it is picked. With no Options left, the Finding gets Read the full report and Not now.
 * - With no report from the model, code writes one from the facts.
 */
export function checkMissionFinding(
  model: ModelFinding,
  context: MissionFindingContext,
): CheckedMissionFinding {
  const title = trimmedText(model.title);
  if (!title) return { ok: false, reason: MISSION_FAILURES.noTitle };
  if (!Array.isArray(model.facts) || model.facts.length === 0) return { ok: false, reason: MISSION_FAILURES.noFacts };

  const facts: FindingFact[] = [];
  for (const fact of model.facts) {
    const label = trimmedText(fact?.label);
    const value = trimmedText(fact?.value);
    const source = typeof fact?.toolCallId === "string" ? context.sourceOf(fact.toolCallId) : undefined;
    if (!label || !value) return { ok: false, reason: MISSION_FAILURES.blankFact };
    if (!source) return { ok: false, reason: MISSION_FAILURES.uncited(label) };
    facts.push({ label, value, source });
  }
  const cantKnow = trimmedText(model.cantKnow);
  if (cantKnow && MONEY_OR_RATE.test(cantKnow)) return { ok: false, reason: MISSION_FAILURES.cantKnowMoney };
  if (cantKnow) facts.push({ label: CANT_KNOW_LABEL, value: cantKnow, source: CANT_KNOW_SOURCE });

  const options: FindingOption[] = [];
  for (const candidate of Array.isArray(model.options) ? model.options : []) {
    const option = checkedOption(candidate, context);
    if (option && !options.some((kept) => kept.key === option.key)) options.push(option);
  }

  return {
    ok: true,
    finding: {
      title,
      facts,
      options: options.length > 0 ? options : DEFAULT_OPTIONS,
      agentsView: trimmedText(model.agentsView) ?? null,
      report: trimmedText(model.report) ?? missionReportFromFacts(title, facts),
    },
  };
}

/** The Option, if it is on the Mission list and its details check, or undefined to drop it. */
function checkedOption(
  candidate: unknown,
  context: MissionFindingContext,
): FindingOption | undefined {
  if (typeof candidate !== "object" || candidate === null) return undefined;
  const { key, date, amountCents, from, to } = candidate as Record<string, unknown>;
  if (!(MISSION_OPTION_KEYS as readonly unknown[]).includes(key)) return undefined;
  if (key === "read_report" || key === "not_now") return { key };
  if (key === "move") {
    const ownAccount = (name: unknown) => context.accounts.find((account) => account.name === name);
    const fromAccount = ownAccount(from);
    const toAccount = ownAccount(to);
    if (!fromAccount || !toAccount || fromAccount.id === toAccount.id) return undefined;
    if (typeof amountCents !== "number" || !Number.isSafeInteger(amountCents) || amountCents <= 0) return undefined;
    return { key: "move", amount: cents(amountCents), fromAccountId: fromAccount.id, toAccountId: toAccount.id };
  }
  const checked = typeof date === "string" ? realDate(date) : undefined;
  return checked && checked > context.today ? { key: "remind_me", date: checked } : undefined;
}

function realDate(text: string): LocalDate | undefined {
  try {
    return localDate(text);
  } catch {
    return undefined;
  }
}

/** Trimmed text, or undefined when it isn't a string or is blank. */
function trimmedText(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}
