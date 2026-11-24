import { formatLocalDate, type LocalDate } from "./calendar";
import type { WhyRow } from "./decisions";
import type { FindingFact } from "./findings";
import type { MissionToolName } from "./mission-tools";
import type { MissionRead } from "./missions";

// Text a Mission stores and shows: its progress labels, the Sources of its tools, its Decision log entry, and the
// parts of its Finding code writes (see CODING_STANDARDS.md).

/** The fixed progress labels a running Mission shows, each tied to the kind of tool in use. */
export const MISSION_PROGRESS = {
  transactions: "Reading your transactions",
  usualMonth: "Checking your Usual month and this month's pace",
  forecastAndGoals: "Checking your Forecast and Goals",
  writingUp: "Writing up what it found",
} as const;
export type MissionProgressLabel = (typeof MISSION_PROGRESS)[keyof typeof MISSION_PROGRESS];

/** The three suggested questions on Discoveries, which the fake model has scripts for. */
export const SUGGESTED_QUESTIONS = [
  "Could I take 3 months off work next summer?",
  "What would a $500 a month raise change?",
  "Am I on track for my House fund?",
] as const;

/** What each Mission tool read, as its Read list item: the period or the item. */
export const MISSION_READ_ITEMS = {
  transactions: (from: LocalDate, to: LocalDate) => `${formatLocalDate(from)} to ${formatLocalDate(to)}`,
  usualMonth: "Usual month and On pace",
  forecast: (today: LocalDate) => `30 days from ${formatLocalDate(today)}`,
  projection: "3-year Projection",
  goals: "Goals",
  scheduledBills: "Scheduled bills",
} as const;

/** The Source of a fact citing a call to `tool` that read `item`. Transactions name the period read. */
export function missionToolSource(tool: MissionToolName, item: string): string {
  const source = MISSION_TOOL_SOURCES[tool];
  return tool === "read_transactions" ? `${source}, ${item}` : source;
}

/** The Source of a fact citing each Mission tool. */
const MISSION_TOOL_SOURCES: Record<MissionToolName, string> = {
  read_transactions: "From your transactions",
  read_usual_month: "From your Usual month and On pace",
  read_forecast: "From your 30-day Forecast",
  read_projection: "From your Projection",
  read_goals: "From your Goals",
  read_scheduled_bills: "From your Scheduled bills",
};

/** Why a Mission couldn't finish, for its Decision log entry's Why panel. */
export const MISSION_FAILURES = {
  noTitle: "The Finding has no title",
  noFacts: "The Finding has no facts",
  blankFact: "A fact has no label or value",
  uncited: (label: string) => `The fact “${label}” cites no tool call from this Mission`,
  cantKnowMoney: "What Plinth can't know may not state a money amount or a rate",
  modelError: "The language model couldn't finish",
  notSaved: "Your agent couldn't save what it found",
} as const;

/** Why a question can't start a Mission. */
export const QUESTION_REFUSALS = {
  blank: "Type a question for your agent to look into",
  tooLong: (max: number) => `Keep the question under ${max} characters`,
} as const;

/** The label of the fact saying what Plinth can't know, when a question needs outside facts. */
export const CANT_KNOW_LABEL = "What Plinth can't know";

/** The Source of that fact: it comes from no tool call, because Plinth has no such data. */
export const CANT_KNOW_SOURCE = "Not in your Plinth data";

/** The notice under the question box. */
export const PROVIDER_NOTICE =
  "Your question and the data it reads are sent to our language model provider. Your name and account numbers are not.";

/** The trigger of a Mission's Decision log entry. */
export function missionTrigger(question: string): string {
  return `You asked: ${question}`;
}

/** The Decision log action when a Mission reports back. */
export function reportedMissionAction(title: string): string {
  return `Reported back: “${title}”`;
}

/** The Decision log action when a Mission couldn't finish. */
export function failedMissionAction(question: string): string {
  return `Couldn't finish looking into “${question}”`;
}

/** What a Mission read, as one line for its Why panel, such as "Goals; Usual month and On pace". */
export function readListText(readList: MissionRead[]): string {
  const items = [...new Set(readList.map((read) => read.item))];
  return items.length === 0 ? "Nothing" : items.join("; ");
}

/** The Why rows of a Mission's Decision log entry when it reports back. */
export function reportedMissionWhy(question: string, readList: MissionRead[], title: string): WhyRow[] {
  return [
    { label: "Trigger", value: missionTrigger(question) },
    { label: "Read", value: readListText(readList) },
    { label: "Finding", value: title },
    { label: "What changes", value: "Nothing. You choose what happens next" },
  ];
}

/** The Why rows of a Mission's Decision log entry when it couldn't finish. */
export function failedMissionWhy(question: string, readList: MissionRead[], reason: string): WhyRow[] {
  return [
    { label: "Trigger", value: missionTrigger(question) },
    { label: "Read", value: readListText(readList) },
    { label: "Why it stopped", value: reason },
    { label: "What changes", value: "Nothing. Nothing was kept" },
  ];
}

/** A Mission's full report, written from its Finding's facts when the model didn't write one. */
export function missionReportFromFacts(title: string, facts: FindingFact[]): string {
  return [title, "", ...facts.map((fact) => `${fact.label}: ${fact.value} (${fact.source})`)].join("\n");
}
