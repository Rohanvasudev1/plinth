import { missionAccess } from "./access-log-text";
import { localDateOf } from "./calendar";
import type { Customer } from "./customer-data";
import { cents } from "./money";
import { checkMissionFinding, type MissionFindingToStore } from "./mission-finding";
import { MISSION_SYSTEM_PROMPT, type MissionModel, type MissionToolAnswer, type ModelFinding } from "./mission-model";
import {
  failedMissionAction,
  failedMissionWhy,
  MISSION_FAILURES,
  missionTrigger,
  QUESTION_REFUSALS,
  reportedMissionAction,
  reportedMissionWhy,
  stoppedMissionAction,
  stoppedMissionWhy,
} from "./mission-text";
import { MISSION_TOOL_DEFINITIONS, runMissionTool, type MissionToolDeps } from "./mission-tools";
import {
  MAX_MISSIONS_PER_DAY,
  MAX_QUESTION_LENGTH,
  MISSION_PROGRESS,
  MISSION_TOOL_CALL_LIMIT,
  MissionError,
  type Mission,
} from "./missions";

export interface MissionDeps extends MissionToolDeps {
  model: MissionModel;
  /** How long a Mission may run, by the wall clock, before it fails. */
  timeLimitMs: number;
}

/**
 * A Mission just started, and a promise that settles with the Mission once it ends. A model error, a failed check,
 * the time limit or the tool call limit ends the Mission as failed, and the customer can stop it; the promise
 * rejects only if recording how it ended fails, such as when the database is gone.
 */
export interface StartedMission {
  mission: Mission;
  ended: Promise<Mission>;
}

export interface MissionRunner {
  /**
   * Starts a Mission for the customer's question and runs it in the background: the model reads the customer's data
   * through the Mission tools, each call recording its progress label and what it read, then returns one Finding.
   *
   * If the Finding passes its checks, one database transaction stores it, ends the Mission as reported and writes a
   * Reported Decision log entry linking it. If the model fails, the Finding fails its checks, the Mission runs past
   * its time limit or asks for more than its tool calls, it ends as failed with a Failed entry, and no Finding is
   * kept. However it ends, the transaction that ends it also writes one access log entry listing what it read
   * (ADR 0010). Throws MissionError, starting nothing, for a blank or overlong question, while another of the customer's
   * Missions runs, or once they have sent the day's most Missions by the simulated clock.
   */
  start(customer: Customer, question: string): StartedMission;
  /**
   * Stops the customer's running Mission: ends it as stopped, keeping nothing it found, and writes a Stopped entry.
   * A stop writes one access log entry, as every ending does. A Mission that has already ended is returned
   * unchanged. Throws MissionError if it isn't the customer's.
   */
  stop(customer: Customer, missionId: number): Mission;
}

/** Thrown into the model's tool-use loop once its Mission has ended, so the loop stops reading. */
class MissionEndedError extends Error {
  override name = "MissionEndedError";
}

export function createMissionRunner(deps: MissionDeps): MissionRunner {
  const { clock, customerData, model, timeLimitMs } = deps;
  /** Settles a running Mission's `ended` promise once something else, such as Stop, has ended it. */
  const settlers = new Map<number, (ended: Mission) => void>();

  function start(customer: Customer, question: string): StartedMission {
    const asked = question.trim();
    if (asked.length === 0) throw new MissionError(QUESTION_REFUSALS.blank);
    if (asked.length > MAX_QUESTION_LENGTH) throw new MissionError(QUESTION_REFUSALS.tooLong(MAX_QUESTION_LENGTH));
    const mission = customerData.inOneTransaction(() => {
      const missions = customerData.listMissions(customer);
      if (missions.some((each) => each.state === "running")) throw new MissionError(QUESTION_REFUSALS.oneRunning);
      const today = localDateOf(clock.now());
      if (missions.filter((each) => localDateOf(each.startedAt) === today).length >= MAX_MISSIONS_PER_DAY) {
        throw new MissionError(QUESTION_REFUSALS.dailyLimit(MAX_MISSIONS_PER_DAY));
      }
      return customerData.createMission(customer, asked, MISSION_PROGRESS.transactions);
    });
    const missionId = mission.id;

    let settled = false;
    let resolveEnded: (ended: Mission) => void = () => {};
    let rejectEnded: (error: unknown) => void = () => {};
    const ended = new Promise<Mission>((resolve, reject) => {
      resolveEnded = resolve;
      rejectEnded = reject;
    });
    const timer = setTimeout(() => finish(() => fail(MISSION_FAILURES.timeLimit)), timeLimitMs);
    settlers.set(missionId, (stopped) => finish(() => stopped));

    /** Ends the Mission once, however many ways it tries to: the first ending wins, and later ones change nothing. */
    function finish(end: () => Mission): void {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      settlers.delete(missionId);
      try {
        // Another server process may have ended it, such as by Stop; then that ending stands.
        const current = customerData.getMission(customer, missionId);
        resolveEnded(current && current.state !== "running" ? current : end());
      } catch (error) {
        rejectEnded(error);
      }
    }

    // Each call gets the next number, failed or not, and an id unique across Missions. Only a call that read
    // something has a Source, so a fact citing a failed call fails the checks.
    const sources = new Map<string, string>();
    let callCount = 0;

    async function callTool(name: string, input: unknown): Promise<MissionToolAnswer> {
      if (settled) throw new MissionEndedError(`Mission ${missionId} has ended`);
      callCount += 1;
      if (callCount > MISSION_TOOL_CALL_LIMIT) {
        finish(() => fail(MISSION_FAILURES.toolCallLimit(MISSION_TOOL_CALL_LIMIT)));
        throw new MissionEndedError(`Mission ${missionId} reached its limit of ${MISSION_TOOL_CALL_LIMIT} tool calls`);
      }
      const toolCallId = `m${missionId}_call_${callCount}`;
      try {
        const outcome = runMissionTool(deps, customer, name, input);
        customerData.recordMissionProgress(customer, missionId, outcome.progress, outcome.read);
        sources.set(toolCallId, outcome.source);
        return { toolCallId, result: outcome.result };
      } catch (error) {
        if (error instanceof MissionError || error instanceof RangeError) return { toolCallId, error: error.message };
        throw error;
      }
    }

    model.runMission({ system: MISSION_SYSTEM_PROMPT, question: asked, tools: MISSION_TOOL_DEFINITIONS, callTool }).then(
      (returned) => finish(() => reportOrFail(returned)),
      (error: unknown) => {
        if (settled) return;
        // The model's own error message is not customer copy, so the log says only that the model failed.
        console.error(`Mission ${missionId} failed in the language model`, error);
        finish(() => fail(MISSION_FAILURES.modelError));
      },
    );

    function reportOrFail(returned: ModelFinding): Mission {
      customerData.recordMissionProgress(customer, missionId, MISSION_PROGRESS.writingUp);
      const checked = checkMissionFinding(returned, {
        sourceOf: (toolCallId) => sources.get(toolCallId),
        today: localDateOf(clock.now()),
        accounts: customerData.listAccounts(customer),
      });
      if (!checked.ok) return fail(checked.reason);
      try {
        return report(checked.finding);
      } catch (error) {
        // The transaction rolled back, so nothing of the Finding was kept.
        console.error(`Mission ${missionId} couldn't store its Finding`, error);
        return fail(MISSION_FAILURES.notSaved);
      }
    }

    function report(finding: MissionFindingToStore): Mission {
      return customerData.inOneTransaction(() => {
        const created = customerData.createFinding(customer, { kind: "mission", missionId, ...finding });
        const reported = customerData.endMission(customer, missionId, "reported");
        customerData.recordDecision(customer, {
          ...missionDecision(asked, missionId),
          action: reportedMissionAction(created.title),
          result: "Reported",
          why: reportedMissionWhy(asked, reported.readList, created.title),
          findingId: created.id,
        });
        customerData.recordAccess(customer, missionAccess(asked, reported.readList));
        return customerData.getMission(customer, missionId) ?? reported;
      });
    }

    function fail(reason: string): Mission {
      return customerData.inOneTransaction(() => {
        const failed = customerData.endMission(customer, missionId, "failed");
        customerData.recordDecision(customer, {
          ...missionDecision(asked, missionId),
          action: failedMissionAction(asked),
          result: "Failed",
          why: failedMissionWhy(asked, failed.readList, reason),
          findingId: null,
        });
        customerData.recordAccess(customer, missionAccess(asked, failed.readList));
        return failed;
      });
    }

    return { mission, ended };
  }

  function stop(customer: Customer, missionId: number): Mission {
    const stopped = customerData.inOneTransaction(() => {
      const mission = customerData.getMission(customer, missionId);
      if (!mission) throw new MissionError(`No Mission ${missionId} for this customer`);
      if (mission.state !== "running") return mission;
      const ended = customerData.endMission(customer, missionId, "stopped");
      customerData.recordDecision(customer, {
        ...missionDecision(mission.question, missionId),
        action: stoppedMissionAction(mission.question),
        result: "Stopped",
        why: stoppedMissionWhy(mission.question, ended.readList),
        findingId: null,
      });
      customerData.recordAccess(customer, missionAccess(mission.question, ended.readList));
      return ended;
    });
    settlers.get(missionId)?.(stopped);
    return stopped;
  }

  return { start, stop };
}

/** The parts of a Mission's Decision log entry that are the same however it ends: it names no Rule and moves nothing. */
function missionDecision(question: string, missionId: number) {
  return {
    actor: "agent" as const,
    trigger: { ledgerEventId: null, description: missionTrigger(question) },
    rule: null,
    fromAccountId: null,
    toAccountId: null,
    amount: cents(0),
    refusedBy: null,
    ledgerTransactionId: null,
    reversesDecisionId: null,
    missionId,
  };
}
