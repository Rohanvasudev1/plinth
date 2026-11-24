// No database imports here: the schema reads MISSION_STATES.
import { MISSION_PROGRESS, type MissionProgressLabel } from "./mission-text";

export { MISSION_PROGRESS, SUGGESTED_QUESTIONS, type MissionProgressLabel } from "./mission-text";

/** Running until it ends as reported, with one Finding, or as stopped or failed, keeping nothing. */
export const MISSION_STATES = ["running", "reported", "stopped", "failed"] as const;
export type MissionState = (typeof MISSION_STATES)[number];

/** One piece of the customer's data a Mission read: the tool it used and the period or item it read. */
export interface MissionRead {
  tool: string;
  item: string;
}

/** A question the customer sent their agent, which reads only their data and reports back with one Finding. */
export interface Mission {
  id: number;
  question: string;
  state: MissionState;
  /** What the Mission is doing now, or did last. */
  progressLabel: MissionProgressLabel;
  /** Every piece of data the Mission read, in the order it read them. */
  readList: MissionRead[];
  /** The Finding it reported. Null unless it reported. */
  findingId: number | null;
  startedAt: Date;
  /** Null while it runs. */
  endedAt: Date | null;
}

/** The longest question the customer can send. */
export const MAX_QUESTION_LENGTH = 500;

/** The Mission's question isn't one it can run with, or the Mission isn't the customer's. */
export class MissionError extends Error {
  override name = "MissionError";
}

/** True when `text` is one of the fixed progress labels, as when reading one back from the database. */
export function isMissionProgressLabel(text: string): text is MissionProgressLabel {
  return (Object.values(MISSION_PROGRESS) as string[]).includes(text);
}
