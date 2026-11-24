import Anthropic from "@anthropic-ai/sdk";
import type { Clock } from "./clock";
import { createFakeMissionModel } from "./fake-mission-model";
import { MISSION_OPTION_KEYS } from "./mission-finding";
import type { MissionModel, MissionModelRequest, ModelFinding } from "./mission-model";

// The Anthropic SDK adapter behind the language model interface (ADR 0005, ADR 0009). It runs the tool-use loop
// itself: each tool the model asks for runs through the request's `callTool`, and the result goes back with the
// call's id so facts can cite it. The model returns its Finding by calling `submit_finding`. Everything it sends
// goes through a transport, so tests run it against a fake one and never reach the network.

/** What the adapter sends Messages requests through: the SDK client in the app, a scripted fake in tests. */
export interface MessagesTransport {
  create(params: Anthropic.MessageCreateParamsNonStreaming): Promise<Anthropic.Message>;
}

/** The model Missions run on when `PLINTH_MODEL` isn't set. */
export const DEFAULT_MISSION_MODEL = "claude-opus-5-5";

/** The model a Mission runs on, and which kind it is. */
export type ChosenMissionModel = { provider: "fake"; model: MissionModel } | { provider: "anthropic"; model: MissionModel };

/**
 * The adapter when `ANTHROPIC_API_KEY` is set, on `PLINTH_MODEL` or the default model, and the scripted fake
 * otherwise. Unit tests (Vitest sets `VITEST`) and the end-to-end suite (`PLINTH_E2E=1`) always get the fake, even
 * with a key in the environment.
 */
export function chooseMissionModel(deps: {
  env: Record<string, string | undefined>;
  clock: Clock;
  /** How long the fake waits before each tool call. */
  fakeToolCallDelayMs?: number;
  /** Builds the transport for the key. The SDK client by default. */
  transportFor?: (apiKey: string) => MessagesTransport;
}): ChosenMissionModel {
  const { env, clock, fakeToolCallDelayMs, transportFor = sdkTransport } = deps;
  const apiKey = env.ANTHROPIC_API_KEY;
  if (!apiKey || env.PLINTH_E2E === "1" || env.VITEST) {
    return { provider: "fake", model: createFakeMissionModel({ clock, toolCallDelayMs: fakeToolCallDelayMs }) };
  }
  return {
    provider: "anthropic",
    model: createAnthropicMissionModel({ transport: transportFor(apiKey), model: env.PLINTH_MODEL || DEFAULT_MISSION_MODEL }),
  };
}

/** The real transport: the Anthropic SDK client with the key. */
function sdkTransport(apiKey: string): MessagesTransport {
  const client = new Anthropic({ apiKey });
  return { create: (params) => client.messages.create(params) };
}

/** The tool the model returns its one Finding with. It is never sent to `callTool`. */
const SUBMIT_FINDING = "submit_finding";

const NULLABLE_TEXT = { type: ["string", "null"] } as const;

const SUBMIT_FINDING_TOOL: Anthropic.Tool = {
  name: SUBMIT_FINDING,
  description:
    "Call this once, last, to return your Finding. Every fact cites the toolCallId of the tool result it came from.",
  strict: true,
  input_schema: {
    type: "object",
    properties: {
      title: { type: "string" },
      facts: {
        type: "array",
        items: {
          type: "object",
          properties: { label: { type: "string" }, value: { type: "string" }, toolCallId: { type: "string" } },
          required: ["label", "value", "toolCallId"],
          additionalProperties: false,
        },
      },
      options: {
        type: "array",
        items: {
          type: "object",
          properties: {
            key: { type: "string", enum: [...MISSION_OPTION_KEYS] },
            date: { ...NULLABLE_TEXT, description: "YYYY-MM-DD for remind_me, otherwise null." },
          },
          required: ["key", "date"],
          additionalProperties: false,
        },
      },
      agentsView: NULLABLE_TEXT,
      cantKnow: NULLABLE_TEXT,
      report: NULLABLE_TEXT,
    },
    required: ["title", "facts", "options", "agentsView", "cantKnow", "report"],
    additionalProperties: false,
  },
};

/** The most tool calls one Mission may make (#53). Calls past it are answered with an error, not run. */
export const MISSION_TOOL_CALL_LIMIT = 8;

/** The most output tokens one Mission may spend across all its requests, including the thinking the model does by default. */
export const MISSION_OUTPUT_TOKEN_LIMIT = 32_000;

/** The most output tokens one request may ask for. Larger non-streaming requests risk the SDK's HTTP timeout. */
const MAX_TOKENS_PER_REQUEST = 16_000;

/** What a tool call past the limit gets back instead of a result. */
const TOOL_CALL_LIMIT_REACHED = `This Mission has used its ${MISSION_TOOL_CALL_LIMIT} tool calls. Call submit_finding now.`;

export function createAnthropicMissionModel(deps: { transport: MessagesTransport; model: string }): MissionModel {
  const { transport, model } = deps;
  return {
    async runMission(request) {
      const tools = toolsFor(request);
      const messages: Anthropic.MessageParam[] = [{ role: "user", content: request.question }];
      let toolCalls = 0;
      let outputTokens = 0;
      let toldToSubmit = false;
      for (;;) {
        const remaining = MISSION_OUTPUT_TOKEN_LIMIT - outputTokens;
        if (remaining <= 0) throw new Error(`The Mission used its ${MISSION_OUTPUT_TOKEN_LIMIT} output tokens`);
        const response = await transport.create({
          model,
          max_tokens: Math.min(MAX_TOKENS_PER_REQUEST, remaining),
          system: request.system,
          tools,
          messages,
        });
        outputTokens += response.usage.output_tokens;
        const uses = response.content.filter((block): block is Anthropic.ToolUseBlock => block.type === "tool_use");
        const submitted = uses.find((use) => use.name === SUBMIT_FINDING);
        if (submitted) return modelFindingFrom(submitted.input);
        if (response.stop_reason !== "tool_use") {
          throw new Error(`The model stopped (${response.stop_reason}) without submitting a Finding`);
        }
        if (toldToSubmit) throw new Error("The model kept calling tools after the tool-call limit");
        messages.push({ role: "assistant", content: response.content });
        const results: Anthropic.ToolResultBlockParam[] = [];
        for (const use of uses) {
          if (toolCalls >= MISSION_TOOL_CALL_LIMIT) {
            toldToSubmit = true;
            results.push({ type: "tool_result", tool_use_id: use.id, is_error: true, content: TOOL_CALL_LIMIT_REACHED });
            continue;
          }
          toolCalls += 1;
          const answer = await request.callTool(use.name, use.input);
          results.push({
            type: "tool_result",
            tool_use_id: use.id,
            ...("error" in answer ? { is_error: true } : {}),
            content: JSON.stringify(answer),
          });
        }
        messages.push({ role: "user", content: results });
      }
    },
  };
}

function toolsFor(request: MissionModelRequest): Anthropic.Tool[] {
  return [
    ...request.tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      strict: true,
      input_schema: tool.inputSchema,
    })),
    SUBMIT_FINDING_TOOL,
  ];
}

/**
 * The submitted Finding as the interface carries it, with any missing text as null. Its shape and content are
 * checked by `checkMissionFinding`, which fails the Mission on a malformed one, so the adapter doesn't check twice.
 */
function modelFindingFrom(input: unknown): ModelFinding {
  const submitted = (typeof input === "object" && input !== null ? input : {}) as Partial<ModelFinding>;
  return {
    title: submitted.title as string,
    facts: submitted.facts as ModelFinding["facts"],
    options: submitted.options as unknown[],
    agentsView: submitted.agentsView ?? null,
    cantKnow: submitted.cantKnow ?? null,
    report: submitted.report ?? null,
  };
}
