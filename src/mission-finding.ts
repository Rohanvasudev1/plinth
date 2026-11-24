import { localDate, type LocalDate } from "./calendar";
import type { FindingFact, FindingOption, NewFinding } from "./findings";
import type { ModelFinding } from "./mission-model";
import { CANT_KNOW_LABEL, CANT_KNOW_SOURCE, missionReportFromFacts } from "./mission-text";

/** The Options a Mission's Finding may offer (ADR 0009). Move comes with its guardrail checks in a later ticket. */
const MISSION_OPTION_KEYS = ["read_report", "remind_me", "not_now"] as const;

/** The Options a Mission's Finding gets when none of the model's survive the checks. */
const DEFAULT_OPTIONS: FindingOption[] = [{ key: "read_report" }, { key: "not_now" }];

/** The checked Finding, ready to store, or why the Mission fails. */
export type CheckedMissionFinding =
  | { ok: true; finding: Pick<NewFinding, "title" | "facts" | "options" | "agentsView" | "report"> }
  | { ok: false; reason: string };

/**
 * Checks the Finding a Mission's model returned (ADR 0009):
 *
 * - It needs a title and at least one fact. A fact that cites no tool call from this Mission fails it. Each fact's
 *   Source is the Source of the tool call it cites, so the model can't write its own.
 * - What Plinth can't know, when the model says, becomes a fact of its own.
 * - An Option not on the Mission list, a repeat, or one whose details don't check is dropped. Remind me needs a
 *   real date after today. With no Options left, the Finding gets Read the full report and Not now.
 * - With no report from the model, code writes one from the facts.
 */
export function checkMissionFinding(
  model: ModelFinding,
  context: { sourceOf: (toolCallId: string) => string | undefined; today: LocalDate },
): CheckedMissionFinding {
  const title = text(model.title);
  if (!title) return { ok: false, reason: "The Finding has no title" };
  if (!Array.isArray(model.facts) || model.facts.length === 0) return { ok: false, reason: "The Finding has no facts" };

  const facts: FindingFact[] = [];
  for (const fact of model.facts) {
    const label = text(fact?.label);
    const value = text(fact?.value);
    const source = typeof fact?.toolCallId === "string" ? context.sourceOf(fact.toolCallId) : undefined;
    if (!label || !value) return { ok: false, reason: "A fact has no label or value" };
    if (!source) return { ok: false, reason: `The fact “${label}” cites no tool call from this Mission` };
    facts.push({ label, value, source });
  }
  const cantKnow = text(model.cantKnow);
  if (cantKnow) facts.push({ label: CANT_KNOW_LABEL, value: cantKnow, source: CANT_KNOW_SOURCE });

  const options: FindingOption[] = [];
  for (const candidate of Array.isArray(model.options) ? model.options : []) {
    const option = checkedOption(candidate, context.today);
    if (option && !options.some((kept) => kept.key === option.key)) options.push(option);
  }

  return {
    ok: true,
    finding: {
      title,
      facts,
      options: options.length > 0 ? options : DEFAULT_OPTIONS,
      agentsView: text(model.agentsView) ?? null,
      report: text(model.report) ?? missionReportFromFacts(title, facts),
    },
  };
}

/** The Option, if it is on the Mission list and its details check, or undefined to drop it. */
function checkedOption(candidate: unknown, today: LocalDate): FindingOption | undefined {
  if (typeof candidate !== "object" || candidate === null) return undefined;
  const { key, date } = candidate as { key?: unknown; date?: unknown };
  if (!(MISSION_OPTION_KEYS as readonly unknown[]).includes(key)) return undefined;
  switch (key) {
    case "read_report":
      return { key };
    case "not_now":
      return { key };
    case "remind_me": {
      const checked = typeof date === "string" ? realDate(date) : undefined;
      return checked && checked > today ? { key, date: checked } : undefined;
    }
  }
  return undefined;
}

function realDate(text: string): LocalDate | undefined {
  try {
    return localDate(text);
  } catch {
    return undefined;
  }
}

/** Trimmed text, or undefined when it isn't a string or is blank. */
function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}
