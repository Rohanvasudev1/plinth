import type { MissionToolDefinition } from "./mission-tools";

// The language model interface for Missions (ADR 0005, ADR 0009). An implementation takes a system prompt, the tools
// and the customer's question, runs the tool-use loop through `callTool`, and returns one structured Finding. Code
// checks that Finding before anything is kept, so an implementation's output is never trusted as it stands.

/** A fact as the model writes it: a label and value, citing the id of the tool call it came from. */
export interface ModelFact {
  label: string;
  value: string;
  toolCallId: string;
}

/** The one Finding a Mission's model returns. Options are as the model wrote them; code checks each one. */
export interface ModelFinding {
  title: string;
  facts: ModelFact[];
  options: unknown[];
  /** The Option the model would pick, and why. */
  agentsView: string | null;
  /** What Plinth can't know when the question needs outside facts, or null when it needs none. */
  cantKnow: string | null;
  /** The full report. When it is null, code writes one from the facts. */
  report: string | null;
}

/** A tool call's answer: its id, for facts to cite, and its result, or why it couldn't run. */
export type MissionToolAnswer = { toolCallId: string; result: unknown } | { toolCallId: string; error: string };

export interface MissionModelRequest {
  system: string;
  question: string;
  tools: MissionToolDefinition[];
  /** Runs one of the tools for the asking customer. Every call gets a new id. */
  callTool(name: string, input: unknown): Promise<MissionToolAnswer>;
}

export interface MissionModel {
  /** Runs the tool-use loop for one Mission and returns its Finding, or throws if the model fails. */
  runMission(request: MissionModelRequest): Promise<ModelFinding>;
}

/** The system prompt every Mission's model gets. */
export const MISSION_SYSTEM_PROMPT = [
  "You are the agent of one customer of Plinth, a bank. The customer has asked you a question.",
  "Answer it only from the customer's own data, which you read with the tools. You may only read: you can't move money or change anything yourself. Only the customer can, by picking an Option.",
  "Return one Finding: a short neutral title, facts, Options, your view and a full report.",
  "Every fact must cite the toolCallId of the tool result it came from. A fact that cites no tool call fails the Finding.",
  "Pick Options only from this list: read_report, remind_me (with a YYYY-MM-DD date after today), not_now, and move " +
    "(with amountCents, a whole number of cents above zero, and from and to, two different accounts of the customer's named as the tools name them).",
  "Never guess outside prices, rates or rules. When the question needs facts you can't read, say what Plinth can't know instead. Write that in words: it may not state a money amount or a rate.",
  "Write your view, the Agent's view, as the Option you would pick, and why, in one or two sentences.",
].join("\n");
