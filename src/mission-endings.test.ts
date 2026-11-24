import { describe, expect, it } from "vitest";
import { SIMULATION_START } from "./app-clock";
import { createBank, type Bank } from "./bank";
import { fixedClock } from "./clock";
import { openTestDatabase } from "./db/database";
import { FAKE_TEST_QUESTIONS } from "./fake-mission-model";
import type { MissionModel } from "./mission-model";
import { openTestBank, signInByName } from "./test-bank";

/** A model that waits until the test lets it go, so its Mission stays running. Read the Usual month first. */
function heldModel(): { model: MissionModel; release: () => void } {
  let release: () => void = () => {};
  const held = new Promise<void>((resolve) => (release = resolve));
  return {
    release: () => release(),
    model: {
      async runMission(request) {
        const usual = await request.callTool("read_usual_month", {});
        await held;
        return {
          title: "Your Usual month",
          facts: [{ label: "Usual month", value: "$7,020.00 in", toolCallId: usual.toolCallId }],
          options: [{ key: "not_now" }],
          agentsView: null,
          cantKnow: null,
          report: null,
        };
      },
    },
  };
}

function bankWith(missionModel: MissionModel, missionTimeLimitMs?: number): Bank {
  return createBank({ db: openTestDatabase(), clock: fixedClock(SIMULATION_START), missionModel, missionTimeLimitMs });
}

describe("Mission limits", () => {
  it("refuse a second Mission while one runs, naming the limit, and allow one once it has ended", async () => {
    const { model, release } = heldModel();
    const bank = bankWith(model);
    const sam = signInByName(bank, "Sam Calloway");
    const priya = signInByName(bank, "Priya Natarajan");
    const first = bank.startMission(sam, "What's my Usual month?");

    expect(() => bank.startMission(sam, "Where does my money go?")).toThrow(
      "Your agent looks into one question at a time. Wait for this one to finish, or stop it, then ask again",
    );
    expect(bank.customerData.listMissions(sam)).toHaveLength(1);
    // The limit is per customer: Priya can still ask.
    expect(bank.startMission(priya, "What's my Usual month?").mission.state).toBe("running");

    release();
    await first.ended;
    expect(bank.startMission(sam, "Where does my money go?").mission.state).toBe("running");
  });

  it("refuse the 11th Mission in a simulated day, naming the limit, and allow one the next day", async () => {
    const bank = openTestBank();
    const sam = signInByName(bank, "Sam Calloway");
    for (let count = 0; count < 10; count += 1) {
      await bank.startMission(sam, "Am I on track for my House fund?").ended;
    }

    expect(() => bank.startMission(sam, "Am I on track for my House fund?")).toThrow(
      "You've sent 10 Missions today, the most in one day. Ask again tomorrow",
    );
    expect(bank.customerData.listMissions(sam)).toHaveLength(10);

    bank.advanceClock();
    expect((await bank.startMission(sam, "Am I on track for my House fund?").ended).state).toBe("reported");
  });

  it("fail a Mission at its 9th tool call: it stops at 8, keeping nothing and logging once", async () => {
    const bank = openTestBank();
    const sam = signInByName(bank, "Sam Calloway");
    const before = bank.readDecisionLog(sam).length;

    const finished = await bank.startMission(sam, FAKE_TEST_QUESTIONS.tooManyReads).ended;

    expect(finished).toMatchObject({ state: "failed", findingId: null });
    expect(finished.readList).toHaveLength(8);
    expect(bank.readFindings(sam).filter((each) => each.kind === "mission")).toEqual([]);
    const log = bank.readDecisionLog(sam);
    expect(log).toHaveLength(before + 1);
    expect(log[0]).toMatchObject({ result: "Failed", missionId: finished.id });
    expect(log[0]?.why).toContainEqual({ label: "Why it stopped", value: "Your agent reached its limit of 8 reads" });
  });
});

describe("Stopping a Mission", () => {
  it("ends it as stopped, keeps nothing and writes one Decision log entry", async () => {
    const bank = openTestBank();
    const sam = signInByName(bank, "Sam Calloway");
    const before = bank.readDecisionLog(sam).length;
    const started = bank.startMission(sam, FAKE_TEST_QUESTIONS.runLong);
    await new Promise((resolve) => setTimeout(resolve, 5));

    const stopped = bank.stopMission(sam, started.mission.id);

    expect(stopped).toMatchObject({ state: "stopped", findingId: null });
    expect(await started.ended).toMatchObject({ id: started.mission.id, state: "stopped" });
    expect(bank.readFindings(sam).filter((each) => each.kind === "mission")).toEqual([]);
    const log = bank.readDecisionLog(sam);
    expect(log).toHaveLength(before + 1);
    expect(log[0]).toMatchObject({
      actor: "agent",
      trigger: { description: `You asked: ${FAKE_TEST_QUESTIONS.runLong}` },
      rule: null,
      result: "Stopped",
      missionId: started.mission.id,
      findingId: null,
    });
    expect(log[0]?.why).toContainEqual({ label: "What changes", value: "Nothing. Nothing was kept" });
  });

  it("keeps nothing when the model reports back after the stop, and logs only the stop", async () => {
    const { model, release } = heldModel();
    const bank = bankWith(model);
    const sam = signInByName(bank, "Sam Calloway");
    const before = bank.readDecisionLog(sam).length;
    const started = bank.startMission(sam, "What's my Usual month?");
    await new Promise((resolve) => setTimeout(resolve, 0));

    bank.stopMission(sam, started.mission.id);
    release();
    await new Promise((resolve) => setTimeout(resolve, 5));

    expect(bank.readMission(sam, started.mission.id)).toMatchObject({ state: "stopped", findingId: null });
    expect(bank.readFindings(sam).filter((each) => each.kind === "mission")).toEqual([]);
    expect(bank.readDecisionLog(sam)).toHaveLength(before + 1);
  });

  it("changes nothing on a Mission that has already ended, and refuses another customer's Mission", async () => {
    const bank = openTestBank();
    const sam = signInByName(bank, "Sam Calloway");
    const priya = signInByName(bank, "Priya Natarajan");
    const reported = await bank.startMission(sam, "Am I on track for my House fund?").ended;
    const before = bank.readDecisionLog(sam).length;

    expect(bank.stopMission(sam, reported.id)).toMatchObject({ state: "reported" });
    expect(bank.readDecisionLog(sam)).toHaveLength(before);

    const running = bank.startMission(sam, FAKE_TEST_QUESTIONS.runLong);
    expect(() => bank.stopMission(priya, running.mission.id)).toThrow("No Mission");
    expect(bank.readMission(sam, running.mission.id)?.state).toBe("running");
    bank.stopMission(sam, running.mission.id);
  });
});

describe("A failing Mission", () => {
  it("fails on a model error, keeping nothing and logging once", async () => {
    const bank = openTestBank();
    const sam = signInByName(bank, "Sam Calloway");
    const before = bank.readDecisionLog(sam).length;

    const finished = await bank.startMission(sam, FAKE_TEST_QUESTIONS.modelError).ended;

    expect(finished).toMatchObject({ state: "failed", findingId: null });
    expect(bank.readFindings(sam).filter((each) => each.kind === "mission")).toEqual([]);
    expect(bank.readDecisionLog(sam)).toHaveLength(before + 1);
    expect(bank.readDecisionLog(sam)[0]?.why).toContainEqual({
      label: "Why it stopped",
      value: "The language model couldn't finish",
    });
  });

  it("fails at its time limit, keeping nothing and logging once", async () => {
    const bank = bankWith(heldModel().model, 20);
    const sam = signInByName(bank, "Sam Calloway");
    const before = bank.readDecisionLog(sam).length;

    const finished = await bank.startMission(sam, "What's my Usual month?").ended;

    expect(finished).toMatchObject({ state: "failed", findingId: null });
    expect(bank.readFindings(sam).filter((each) => each.kind === "mission")).toEqual([]);
    expect(bank.readDecisionLog(sam)).toHaveLength(before + 1);
    expect(bank.readDecisionLog(sam)[0]?.why).toContainEqual({
      label: "Why it stopped",
      value: "Your agent ran out of time",
    });
  });

  it("fails when its Finding fails the checks", async () => {
    const bank = openTestBank();
    const sam = signInByName(bank, "Sam Calloway");

    const finished = await bank.startMission(sam, FAKE_TEST_QUESTIONS.uncitedFact).ended;

    expect(finished.state).toBe("failed");
    expect(bank.readFindings(sam).filter((each) => each.kind === "mission")).toEqual([]);
  });
});

describe("Discoveries with ended Missions", () => {
  it("shows a failed Mission as unfinished, with its question for Try again, until it is asked again", async () => {
    const bank = openTestBank();
    const sam = signInByName(bank, "Sam Calloway");
    const priya = signInByName(bank, "Priya Natarajan");
    const failed = await bank.startMission(sam, FAKE_TEST_QUESTIONS.modelError).ended;

    expect(bank.readDiscoveries(sam).unfinishedMissions).toEqual([
      expect.objectContaining({ id: failed.id, question: FAKE_TEST_QUESTIONS.modelError, state: "failed" }),
    ]);
    expect(bank.readDiscoveries(priya).unfinishedMissions).toEqual([]);

    // Try again starts a new Mission with the same question.
    bank.startMission(sam, FAKE_TEST_QUESTIONS.runLong);
    await bank.startMission(priya, FAKE_TEST_QUESTIONS.modelError).ended;
    const page = bank.readDiscoveries(sam);
    expect(page.unfinishedMissions).toEqual([expect.objectContaining({ id: failed.id })]);
    bank.stopMission(sam, page.runningMissions[0]?.id ?? -1);

    const again = await bank.startMission(sam, FAKE_TEST_QUESTIONS.modelError).ended;
    expect(bank.readDiscoveries(sam).unfinishedMissions.map((mission) => mission.id)).toEqual([
      again.id,
      expect.any(Number),
    ]);
    expect(bank.readDiscoveries(sam).unfinishedMissions.map((mission) => mission.state)).toEqual(["failed", "stopped"]);
  });

  it("shows only today's unfinished Missions by the simulated clock", async () => {
    const bank = openTestBank();
    const sam = signInByName(bank, "Sam Calloway");
    await bank.startMission(sam, FAKE_TEST_QUESTIONS.modelError).ended;

    bank.advanceClock();

    expect(bank.readDiscoveries(sam).unfinishedMissions).toEqual([]);
  });
});
