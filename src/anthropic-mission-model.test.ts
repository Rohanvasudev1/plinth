import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import { chooseMissionModel, createAnthropicMissionModel, type MessagesTransport } from "./anthropic-mission-model";
import { fixedClock } from "./clock";
import { SIMULATION_START } from "./app-clock";
import { createBank } from "./bank";
import { openTestDatabase } from "./db/database";
import { signInByName } from "./test-bank";
import { MISSION_SYSTEM_PROMPT, type MissionModelRequest, type MissionToolAnswer } from "./mission-model";
import { MISSION_TOOL_DEFINITIONS } from "./mission-tools";

// The adapter runs against a fake transport: it hands back scripted Messages and records each request. No test
// makes a network call.

type Block = Anthropic.ToolUseBlock | Anthropic.TextBlock;

function reply(content: Block[], stopReason: Anthropic.StopReason = "tool_use", outputTokens = 100): Anthropic.Message {
  return {
    id: "msg_test",
    type: "message",
    role: "assistant",
    model: "claude-test",
    content,
    stop_reason: stopReason,
    stop_sequence: null,
    usage: { input_tokens: 10, output_tokens: outputTokens },
  } as unknown as Anthropic.Message;
}

function toolUse(id: string, name: string, input: unknown): Anthropic.ToolUseBlock {
  return { type: "tool_use", id, name, input } as Anthropic.ToolUseBlock;
}

function text(words: string): Anthropic.TextBlock {
  return { type: "text", text: words } as Anthropic.TextBlock;
}

/** A transport that answers each request with the next scripted reply and keeps a copy of every request. */
function scriptedTransport(...replies: Anthropic.Message[]) {
  const requests: Anthropic.MessageCreateParamsNonStreaming[] = [];
  const transport: MessagesTransport = {
    async create(params) {
      requests.push(structuredClone(params));
      const next = replies.shift();
      if (!next) throw new Error("The script ran out of replies");
      return next;
    },
  };
  return { transport, requests };
}

/** A Mission request whose tools answer from `results` and give each call the next id, as the runner does. */
function missionRequest(results: Record<string, unknown> = {}) {
  const calls: { name: string; input: unknown }[] = [];
  const request: MissionModelRequest = {
    system: MISSION_SYSTEM_PROMPT,
    question: "Am I on track for my House fund?",
    tools: MISSION_TOOL_DEFINITIONS,
    async callTool(name, input): Promise<MissionToolAnswer> {
      calls.push({ name, input });
      const toolCallId = `m1_call_${calls.length}`;
      return name in results ? { toolCallId, result: results[name] } : { toolCallId, error: `No ${name} here` };
    },
  };
  return { request, calls };
}

const GOALS = { goals: [{ account: "House fund", balanceCents: 1_200_000, targetCents: 2_400_000 }] };

const SUBMITTED = {
  title: "House fund is halfway to its target",
  facts: [{ label: "House fund", value: "$12,000.00 of $24,000.00", toolCallId: "m1_call_1" }],
  options: [{ key: "read_report", date: null }, { key: "not_now", date: null }],
  agentsView: "I would pick Read the full report.",
  cantKnow: null,
  report: "House fund holds half its target.",
};

describe("The Anthropic Mission model", () => {
  it("runs the tool-use loop, passing each call's id back, and returns the submitted Finding", async () => {
    const { transport, requests } = scriptedTransport(
      reply([text("Reading your Goals."), toolUse("tu_1", "read_goals", {})]),
      reply([toolUse("tu_2", "submit_finding", SUBMITTED)]),
    );
    const { request, calls } = missionRequest({ read_goals: GOALS });

    const finding = await createAnthropicMissionModel({ transport, model: "claude-test" }).runMission(request);

    expect(calls).toEqual([{ name: "read_goals", input: {} }]);
    expect(finding).toEqual(SUBMITTED);

    const [first, second] = requests;
    expect(first?.system).toBe(MISSION_SYSTEM_PROMPT);
    expect(first?.messages).toEqual([{ role: "user", content: "Am I on track for my House fund?" }]);
    expect(first?.tools?.map((tool) => ("name" in tool ? tool.name : undefined))).toEqual([
      ...MISSION_TOOL_DEFINITIONS.map((tool) => tool.name),
      "submit_finding",
    ]);
    const toolResults = second?.messages.at(-1);
    expect(toolResults?.role).toBe("user");
    expect(toolResults?.content).toEqual([
      { type: "tool_result", tool_use_id: "tu_1", content: JSON.stringify({ toolCallId: "m1_call_1", result: GOALS }) },
    ]);
  });
});

describe("The Anthropic Mission model's limits", () => {
  it("marks a tool call that couldn't run as an error, with its id", async () => {
    const { transport, requests } = scriptedTransport(
      reply([toolUse("tu_1", "read_forecast", {})]),
      reply([toolUse("tu_2", "submit_finding", SUBMITTED)]),
    );

    await createAnthropicMissionModel({ transport, model: "claude-test" }).runMission(missionRequest().request);

    expect(requests[1]?.messages.at(-1)?.content).toEqual([
      {
        type: "tool_result",
        tool_use_id: "tu_1",
        is_error: true,
        content: JSON.stringify({ toolCallId: "m1_call_1", error: "No read_forecast here" }),
      },
    ]);
  });

  it("runs at most 8 tool calls, then tells the model to submit its Finding", async () => {
    const reads = Array.from({ length: 9 }, (_, index) => reply([toolUse(`tu_${index + 1}`, "read_goals", {})]));
    const { transport, requests } = scriptedTransport(...reads, reply([toolUse("tu_10", "submit_finding", SUBMITTED)]));
    const { request, calls } = missionRequest({ read_goals: GOALS });

    const finding = await createAnthropicMissionModel({ transport, model: "claude-test" }).runMission(request);

    expect(calls).toHaveLength(8);
    expect(finding.title).toBe(SUBMITTED.title);
    const refused = requests[9]?.messages.at(-1)?.content;
    expect(refused).toEqual([expect.objectContaining({ tool_use_id: "tu_9", is_error: true })]);
  });

  it("fails when the model keeps calling tools after the limit", async () => {
    const reads = Array.from({ length: 12 }, (_, index) => reply([toolUse(`tu_${index + 1}`, "read_goals", {})]));
    const { transport } = scriptedTransport(...reads, reply([toolUse("tu_99", "submit_finding", SUBMITTED)]));

    await expect(
      createAnthropicMissionModel({ transport, model: "claude-test" }).runMission(missionRequest({ read_goals: GOALS }).request),
    ).rejects.toThrow();
  });

  it("caps the Mission's output tokens across all its requests", async () => {
    const { transport, requests } = scriptedTransport(
      reply([toolUse("tu_1", "read_goals", {})], "tool_use", 10_000),
      reply([toolUse("tu_2", "read_goals", {})], "tool_use", 10_000),
      reply([toolUse("tu_3", "read_goals", {})], "tool_use", 12_000),
      reply([toolUse("tu_4", "submit_finding", SUBMITTED)]),
    );

    await expect(
      createAnthropicMissionModel({ transport, model: "claude-test" }).runMission(missionRequest({ read_goals: GOALS }).request),
    ).rejects.toThrow();
    expect(requests.map((each) => each.max_tokens)).toEqual([16_000, 16_000, 12_000]);
  });
});

describe("Choosing the Mission model", () => {
  const clock = fixedClock(SIMULATION_START);

  it("uses the fake without an API key", () => {
    expect(chooseMissionModel({ env: {}, clock }).provider).toBe("fake");
    expect(chooseMissionModel({ env: { ANTHROPIC_API_KEY: "", PLINTH_MODEL: "claude-other" }, clock }).provider).toBe("fake");
  });

  it("uses the fake in the end-to-end suite and the unit tests even with an API key", () => {
    expect(chooseMissionModel({ env: { ANTHROPIC_API_KEY: "sk-test", PLINTH_E2E: "1" }, clock }).provider).toBe("fake");
    expect(chooseMissionModel({ env: { ANTHROPIC_API_KEY: "sk-test", VITEST: "true" }, clock }).provider).toBe("fake");
    expect(chooseMissionModel({ env: { ...process.env, ANTHROPIC_API_KEY: "sk-test" }, clock }).provider).toBe("fake");
  });

  it("uses claude-opus-5-5 with an API key, or PLINTH_MODEL when it is set", async () => {
    const { transport, requests } = scriptedTransport(
      reply([toolUse("tu_1", "submit_finding", SUBMITTED)]),
      reply([toolUse("tu_2", "submit_finding", SUBMITTED)]),
    );
    const transportFor = () => transport;

    const byDefault = chooseMissionModel({ env: { ANTHROPIC_API_KEY: "sk-test" }, clock, transportFor });
    const chosen = chooseMissionModel({
      env: { ANTHROPIC_API_KEY: "sk-test", PLINTH_MODEL: "claude-other" },
      clock,
      transportFor,
    });
    await byDefault.model.runMission(missionRequest().request);
    await chosen.model.runMission(missionRequest().request);

    expect(byDefault.provider).toBe("anthropic");
    expect(requests.map((each) => each.model)).toEqual(["claude-opus-5-5", "claude-other"]);
  });
});

describe("A Mission on the Anthropic model", () => {
  async function missionEndingWith(...replies: Anthropic.Message[]) {
    const { transport } = scriptedTransport(...replies);
    const missionModel = createAnthropicMissionModel({ transport, model: "claude-test" });
    const bank = createBank({ db: openTestDatabase(), clock: fixedClock(SIMULATION_START), missionModel });
    const sam = signInByName(bank, "Sam Calloway");
    const ended = await bank.startMission(sam, "Am I on track for my House fund?").ended;
    return { ended, findings: bank.readFindings(sam).filter((finding) => finding.kind === "mission") };
  }

  it("reports the Finding the model submits, with each fact's Source from the call it cites", async () => {
    const { ended, findings } = await missionEndingWith(
      reply([toolUse("tu_1", "read_goals", {})]),
      reply([toolUse("tu_2", "submit_finding", { ...SUBMITTED, facts: [{ ...SUBMITTED.facts[0], toolCallId: "m1_call_1" }] })]),
    );

    expect(ended.state).toBe("reported");
    expect(findings).toHaveLength(1);
    expect(findings[0]?.title).toBe(SUBMITTED.title);
  });

  it.each([
    ["a Finding with no facts list", reply([toolUse("tu_1", "submit_finding", { ...SUBMITTED, facts: "none" })])],
    ["a Finding with no title", reply([toolUse("tu_1", "submit_finding", { ...SUBMITTED, title: undefined })])],
    ["a fact that names no tool call", reply([toolUse("tu_1", "submit_finding", { ...SUBMITTED, facts: [{ label: "A", value: "B" }] })])],
    ["a plain text answer with no Finding", reply([text("You're doing fine.")], "end_turn")],
    ["a reply cut off at the token limit", reply([text("You're doing")], "max_tokens")],
    ["a refusal", reply([], "refusal")],
  ])("fails, keeping nothing, on %s", async (_, malformed) => {
    // A good Finding follows, so an adapter that carried on past the malformed reply would report it.
    const { ended, findings } = await missionEndingWith(
      malformed,
      reply([toolUse("tu_9", "read_goals", {})]),
      reply([toolUse("tu_10", "submit_finding", { ...SUBMITTED, facts: [{ ...SUBMITTED.facts[0], toolCallId: "m1_call_1" }] })]),
    );

    expect(ended.state).toBe("failed");
    expect(findings).toHaveLength(0);
  });
});
