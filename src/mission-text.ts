import type { WhyRow } from "./decisions";
import type { FindingFact } from "./findings";
import type { MissionRead } from "./missions";

// Text a Mission stores when it ends: its Decision log entry, and the parts of its Finding code writes
// (see CODING_STANDARDS.md).

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
