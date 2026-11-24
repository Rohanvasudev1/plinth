import { localDateOf } from "./calendar";
import type { Customer } from "./customer-data";
import { cents } from "./money";
import { checkMissionFinding, type MissionFindingToStore } from "./mission-finding";
import { MISSION_SYSTEM_PROMPT, type MissionModel, type MissionToolAnswer } from "./mission-model";
import {
  failedMissionAction,
  failedMissionWhy,
  MISSION_FAILURES,
  missionTrigger,
  QUESTION_REFUSALS,
  reportedMissionAction,
  reportedMissionWhy,
} from "./mission-text";
import { MISSION_TOOL_DEFINITIONS, runMissionTool, type MissionToolDeps } from "./mission-tools";
import { MAX_QUESTION_LENGTH, MISSION_PROGRESS, MissionError, type Mission } from "./missions";

export interface MissionDeps extends MissionToolDeps {
  model: MissionModel;
}

/**
 * A Mission just started, and a promise that settles with the Mission once it ends. A model error or a failed check
 * ends the Mission as failed; the promise rejects only if recording that fails, such as when the database is gone.
 */
export interface StartedMission {
  mission: Mission;
  ended: Promise<Mission>;
}

/**
 * Starts a Mission for the customer's question and runs it in the background: the model reads the customer's data
 * through the Mission tools, each call recording its progress label and what it read, then returns one Finding.
 *
 * If the Finding passes its checks, one database transaction stores it, ends the Mission as reported and writes a
 * Reported Decision log entry linking it. If the model fails or the Finding fails its checks, the Mission ends as
 * failed with a Failed entry, and no Finding is kept. Throws MissionError, starting nothing, for a blank or overlong
 * question.
 */
export function startMission(deps: MissionDeps, customer: Customer, question: string): StartedMission {
  const { clock, customerData, model } = deps;
  const asked = question.trim();
  if (asked.length === 0) throw new MissionError(QUESTION_REFUSALS.blank);
  if (asked.length > MAX_QUESTION_LENGTH) throw new MissionError(QUESTION_REFUSALS.tooLong(MAX_QUESTION_LENGTH));
  const mission = customerData.createMission(customer, asked, MISSION_PROGRESS.transactions);
  const sources = new Map<string, string>();

  async function callTool(name: string, input: unknown): Promise<MissionToolAnswer> {
    const toolCallId = `call_${sources.size + 1}`;
    try {
      const outcome = runMissionTool(deps, customer, name, input);
      customerData.recordMissionProgress(customer, mission.id, outcome.progress, outcome.read);
      sources.set(toolCallId, outcome.source);
      return { toolCallId, result: outcome.result };
    } catch (error) {
      if (error instanceof MissionError || error instanceof RangeError) return { toolCallId, error: error.message };
      throw error;
    }
  }

  async function run(): Promise<Mission> {
    let reason: string;
    try {
      const returned = await model.runMission({
        system: MISSION_SYSTEM_PROMPT,
        question: asked,
        tools: MISSION_TOOL_DEFINITIONS,
        callTool,
      });
      customerData.recordMissionProgress(customer, mission.id, MISSION_PROGRESS.writingUp);
      const checked = checkMissionFinding(returned, {
        sourceOf: (toolCallId) => sources.get(toolCallId),
        today: localDateOf(clock.now()),
      });
      if (checked.ok) return report(checked.finding);
      reason = checked.reason;
    } catch (error) {
      // The model's own error message is not customer copy, so the log says only that the model failed.
      console.error(`Mission ${mission.id} failed in the language model`, error);
      reason = MISSION_FAILURES.modelError;
    }
    return fail(reason);
  }

  function report(finding: MissionFindingToStore): Mission {
    return customerData.inOneTransaction(() => {
      const created = customerData.createFinding(customer, { kind: "mission", missionId: mission.id, ...finding });
      const ended = customerData.endMission(customer, mission.id, "reported");
      customerData.recordDecision(customer, {
        ...missionDecision(),
        action: reportedMissionAction(created.title),
        result: "Reported",
        why: reportedMissionWhy(asked, ended.readList, created.title),
        findingId: created.id,
      });
      return customerData.getMission(customer, mission.id) ?? ended;
    });
  }

  function fail(reason: string): Mission {
    return customerData.inOneTransaction(() => {
      const ended = customerData.endMission(customer, mission.id, "failed");
      customerData.recordDecision(customer, {
        ...missionDecision(),
        action: failedMissionAction(asked),
        result: "Failed",
        why: failedMissionWhy(asked, ended.readList, reason),
        findingId: null,
      });
      return ended;
    });
  }

  function missionDecision() {
    return {
      actor: "agent" as const,
      trigger: { ledgerEventId: null, description: missionTrigger(asked) },
      rule: null,
      fromAccountId: null,
      toAccountId: null,
      amount: cents(0),
      refusedBy: null,
      ledgerTransactionId: null,
      reversesDecisionId: null,
      missionId: mission.id,
    };
  }

  return { mission, ended: run() };
}
