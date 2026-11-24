import { addDays, firstOfNextMonth, formatLocalDate, localDateOf, type LocalDate } from "./calendar";
import type { Clock } from "./clock";
import type { MissionModel, MissionModelRequest, MissionToolAnswer, ModelFact, ModelFinding } from "./mission-model";
import { cents, formatDollars, type Cents } from "./money";

// The scripted fake language model. It picks a canned script by keyword, makes real tool calls through the same
// tools, and builds its Finding from their results, so every Finding check runs against it. Tests always use it, and
// so does the app when no API key is set.

/** How many days back the scripts read transactions for. */
const RECENT_DAYS = 90;

/**
 * Questions that run the fake's test scripts when it is made with `testScripts`, for tests and the end-to-end suite
 * only: one fails with a model error, one
 * runs long, reading once a minute until it is stopped or reaches a limit, one reads more often than a Mission may,
 * and one returns a fact that cites no tool call.
 */
export const FAKE_TEST_QUESTIONS = {
  modelError: "Test: fail with a model error",
  runLong: "Test: run long",
  tooManyReads: "Test: read too often",
  uncitedFact: "Test: cite nothing",
} as const;

/** How long the run-long script waits between reads. */
const RUN_LONG_STEP_MS = 60_000;

export function createFakeMissionModel(deps: {
  clock: Clock;
  /** How long to wait before each tool call, so the app shows a running Mission's progress. Zero in tests. */
  toolCallDelayMs?: number;
  /** Whether the questions in FAKE_TEST_QUESTIONS run their test scripts. Only tests and the end-to-end suite. */
  testScripts?: boolean;
}): MissionModel {
  const { clock, toolCallDelayMs = 0, testScripts = false } = deps;
  return {
    async runMission(request) {
      const session = new ScriptSession(request, localDateOf(clock.now()), toolCallDelayMs);
      const testScript = testScripts ? testScriptFor(request.question) : undefined;
      if (testScript) return testScript(session);
      const transactions = await session.call<TransactionsResult>("read_transactions", {
        from: addDays(session.today, -RECENT_DAYS),
        to: session.today,
      });
      const usual = await session.call<UsualMonthResult>("read_usual_month", {});
      if (usual.result.kind === "not_enough_history") return notEnoughHistory(session, transactions, usual);
      const usualFigures = { ...usual, result: usual.result };
      const question = request.question.toLowerCase();
      if (/\b(time|months?) off\b|\boff work\b|\bsabbatical\b/.test(question)) {
        return timeOff(session, usualFigures, request.question);
      }
      if (/\braise\b|\bpay rise\b/.test(question)) return raise(session, transactions, usualFigures, request.question);
      if (/\bon track\b|\bgoal\b|\bfund\b/.test(question)) return onTrack(session, usualFigures, request.question);
      return fallback(session, transactions, usualFigures);
    },
  };
}

function testScriptFor(question: string): ((session: ScriptSession) => Promise<ModelFinding>) | undefined {
  switch (question.trim().toLowerCase()) {
    case FAKE_TEST_QUESTIONS.modelError.toLowerCase():
      return async (session) => {
        await session.call("read_usual_month", {});
        throw new Error("The fake model failed, as its test script asks");
      };
    case FAKE_TEST_QUESTIONS.runLong.toLowerCase():
      return async (session) => {
        for (;;) {
          await session.call("read_goals", {});
          await sleep(RUN_LONG_STEP_MS);
        }
      };
    case FAKE_TEST_QUESTIONS.tooManyReads.toLowerCase():
      return async (session) => {
        const calls: Called<unknown>[] = [];
        for (let count = 0; count < 9; count += 1) calls.push(await session.call("read_goals", {}));
        return citing(calls[0] as Called<unknown>);
      };
    case FAKE_TEST_QUESTIONS.uncitedFact.toLowerCase():
      return async (session) => {
        const goals = await session.call("read_goals", {});
        const finding = citing(goals);
        return { ...finding, facts: [...finding.facts, { label: "Rents nearby", value: "Higher", toolCallId: "call_99" }] };
      };
    default:
      return undefined;
  }
}

/** A plain Finding with one fact citing `call`, for the test scripts. */
function citing(call: Called<unknown>): ModelFinding {
  return {
    title: "Your Goals",
    facts: [fact("Goals read", "Yes", call)],
    options: [{ key: "not_now" }],
    agentsView: null,
    cantKnow: null,
    report: null,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// The parts of each tool's result the scripts read.
interface TransactionsResult {
  transactions: { category: string; amountCents: number }[];
}
type UsualMonthResult =
  | { kind: "not_enough_history" }
  | {
      kind: "figures";
      fullMonths: number;
      usualMonth: { incomeCents: number; spendingCents: number };
      leftToSave: { usualMonthCents: number };
      categories: { category: string; usualMonthCents: number }[];
    };
type UsualFigures = Extract<UsualMonthResult, { kind: "figures" }>;
interface GoalsResult {
  goals: { account: string; balanceCents: number; targetCents: number | null }[];
}
interface BillsResult {
  bills: { payee: string; amountCents: number; account?: string }[];
}
type ForecastResult =
  | { kind: "no_checking_account" }
  | { kind: "forecast"; account: string; today: { balanceCents: number }; bufferCents: number };
type ProjectionResult =
  | { kind: "not_enough_history" | "no_sweep_target" }
  | { kind: "projection"; account: string; balanceCents: number; usualMonth: { after36MonthsCents: number } };

/** A tool call the script made: its id, for facts to cite, and its result. */
interface Called<T> {
  toolCallId: string;
  result: T;
}

class ScriptSession {
  constructor(
    private readonly request: MissionModelRequest,
    readonly today: LocalDate,
    private readonly toolCallDelayMs: number,
  ) {}

  async call<T>(name: string, input: unknown): Promise<Called<T>> {
    if (this.toolCallDelayMs > 0) await new Promise((resolve) => setTimeout(resolve, this.toolCallDelayMs));
    const answer: MissionToolAnswer = await this.request.callTool(name, input);
    if ("error" in answer) throw new Error(`The fake model's ${name} call failed: ${answer.error}`);
    return { toolCallId: answer.toolCallId, result: answer.result as T };
  }
}

function fact(label: string, value: string, from: Called<unknown>): ModelFact {
  return { label, value, toolCallId: from.toolCallId };
}

function dollars(amount: number): string {
  return formatDollars(cents(amount));
}

/** The facts as report lines, under the title, with any closing paragraphs. */
function report(title: string, facts: ModelFact[], ...paragraphs: string[]): string {
  return [title, "", ...facts.map((each) => `${each.label}: ${each.value}`), "", ...paragraphs].join("\n").trim();
}

/** Total spending in the transactions: money out under any Category but Savings. */
function spendingIn(transactions: TransactionsResult): Cents {
  return cents(
    -transactions.transactions
      .filter((each) => each.amountCents < 0 && each.category !== "Savings" && each.category !== "Income")
      .reduce((sum, each) => sum + each.amountCents, 0),
  );
}

/** The whole number of months the question asks about, such as 3 in "3 months off", or `fallback`. */
function monthsIn(question: string, fallback: number): number {
  const match = /(\d{1,2})\s*months?/i.exec(question);
  return match ? Number(match[1]) : fallback;
}

/** The dollar amount in the question, such as $500 in "a $500 a month raise", or `fallback`. */
function amountIn(question: string, fallback: Cents): Cents {
  const match = /\$\s?(\d{1,3}(?:,\d{3})*|\d+)\b/.exec(question);
  return match?.[1] ? cents(Number(match[1].replaceAll(",", "")) * 100) : fallback;
}

/** A reminder date about three months out, on the first of a month. */
function inAboutThreeMonths(today: LocalDate): LocalDate {
  return firstOfNextMonth(firstOfNextMonth(firstOfNextMonth(today)));
}

async function timeOff(session: ScriptSession, usual: Called<UsualFigures>, question: string): Promise<ModelFinding> {
  const goals = await session.call<GoalsResult>("read_goals", {});
  const bills = await session.call<BillsResult>("read_scheduled_bills", {});
  const months = monthsIn(question, 3);
  const spending = usual.result.usualMonth.spendingCents;
  const saved = goals.result.goals.reduce((sum, goal) => sum + goal.balanceCents, 0);
  const billsEachMonth = bills.result.bills.reduce((sum, bill) => sum + bill.amountCents, 0);
  const needed = spending * months;
  const remindOn = inAboutThreeMonths(session.today);
  const title = `${months} months without pay would take about ${dollars(needed)} of spending`;
  const facts = [
    fact("Usual month", `${dollars(usual.result.usualMonth.incomeCents)} in, ${dollars(spending)} out`, usual),
    fact(`${months} months of Usual spending`, dollars(needed), usual),
    fact("Of that, Scheduled bills", `${dollars(billsEachMonth * months)} (${dollars(billsEachMonth)} a month)`, bills),
    fact("Saved in your Goals today", dollars(saved), goals),
    fact("Left to save in a Usual month", dollars(usual.result.leftToSave.usualMonthCents), usual),
  ];
  const cantKnow =
    "Whether your time off would be paid, and what prices will be next summer. Plinth only sees your own accounts.";
  return {
    title,
    facts,
    options: [{ key: "read_report" }, { key: "remind_me", date: remindOn }, { key: "not_now" }],
    agentsView:
      `I would pick Remind me on ${formatLocalDate(remindOn)}: by then you may know whether the time off is paid, ` +
      `and each Usual month adds ${dollars(usual.result.leftToSave.usualMonthCents)} to what you have saved.`,
    cantKnow,
    report: report(
      title,
      facts,
      `Without pay, ${months} months of Usual spending is ${dollars(needed)}. Your Goals hold ${dollars(saved)} today.`,
      `What Plinth can't know: ${cantKnow}`,
    ),
  };
}

async function raise(
  session: ScriptSession,
  transactions: Called<TransactionsResult>,
  usual: Called<UsualFigures>,
  question: string,
): Promise<ModelFinding> {
  const projection = await session.call<ProjectionResult>("read_projection", {});
  const extra = amountIn(question, cents(500_00));
  const leftToSave = usual.result.leftToSave.usualMonthCents;
  const paidIn = transactions.result.transactions
    .filter((each) => each.category === "Income" && each.amountCents > 0)
    .reduce((sum, each) => sum + each.amountCents, 0);
  const title = `${dollars(extra)} more a month would take Left to save to ${dollars(leftToSave + extra)}`;
  const facts = [
    fact(`Paid in over the last ${RECENT_DAYS} days`, dollars(paidIn), transactions),
    fact("Usual month income", dollars(usual.result.usualMonth.incomeCents), usual),
    fact("Left to save in a Usual month now", dollars(leftToSave), usual),
    fact(`With ${dollars(extra)} more a month`, dollars(leftToSave + extra), usual),
  ];
  if (projection.result.kind === "projection") {
    const now = projection.result.usualMonth.after36MonthsCents;
    facts.push(
      fact(
        `${projection.result.account} in 3 years`,
        `${dollars(now)} at your Usual month, ${dollars(now + extra * 36)} with the extra`,
        projection,
      ),
    );
  }
  const cantKnow = "How much of the raise you would keep after tax. Plinth sees your pay as it lands, not your tax.";
  return {
    title,
    facts,
    options: [{ key: "read_report" }, { key: "not_now" }],
    agentsView: "I would pick Read the full report: it shows where the extra would go each month before you plan around it.",
    cantKnow,
    report: report(
      title,
      facts,
      `This counts the whole ${dollars(extra)} as money in. What Plinth can't know: ${cantKnow}`,
    ),
  };
}

async function onTrack(session: ScriptSession, usual: Called<UsualFigures>, question: string): Promise<ModelFinding> {
  const goals = await session.call<GoalsResult>("read_goals", {});
  const projection = await session.call<ProjectionResult>("read_projection", {});
  const asked = question.toLowerCase();
  const goal =
    goals.result.goals.find((each) => asked.includes(each.account.toLowerCase())) ??
    goals.result.goals.find((each) => projection.result.kind === "projection" && each.account === projection.result.account) ??
    goals.result.goals[0];
  const monthly = usual.result.leftToSave.usualMonthCents;
  if (!goal || goal.targetCents === null) {
    const title = "You have no Goal with a target to measure against";
    const facts = [
      fact("Goals with a target", "None", goals),
      fact("Left to save in a Usual month", dollars(monthly), usual),
    ];
    return {
      title,
      facts,
      options: [{ key: "read_report" }, { key: "not_now" }],
      agentsView: "I would pick Not now: set a target on a Goal, then ask again.",
      cantKnow: null,
      report: report(title, facts),
    };
  }
  const toGo = Math.max(0, goal.targetCents - goal.balanceCents);
  const percent = Math.floor((goal.balanceCents * 100) / goal.targetCents);
  const months = monthly > 0 ? Math.ceil(toGo / monthly) : null;
  const title =
    months === null
      ? `${goal.account} is at ${percent}%, and a Usual month leaves nothing to add`
      : `${goal.account} is at ${percent}%, about ${months} months from its target`;
  const facts = [
    fact(goal.account, `${dollars(goal.balanceCents)} of ${dollars(goal.targetCents)} (${percent}%)`, goals),
    fact("Still to save", dollars(toGo), goals),
    fact("Left to save in a Usual month", dollars(monthly), usual),
  ];
  if (projection.result.kind === "projection" && projection.result.account === goal.account) {
    facts.push(fact("In 3 years at your Usual month", dollars(projection.result.usualMonth.after36MonthsCents), projection));
  }
  // Offer to move what checking holds today above its Buffer and a month of the Scheduled bills paid from it, in
  // whole dollars, up to what the Goal still needs.
  const forecast = await session.call<ForecastResult>("read_forecast", {});
  const bills = await session.call<BillsResult>("read_scheduled_bills", {});
  let move: { key: "move"; amountCents: number; from: string; to: string } | undefined;
  if (forecast.result.kind === "forecast") {
    const checking = forecast.result;
    const billsEachMonth = bills.result.bills
      .filter((bill) => bill.account === checking.account)
      .reduce((sum, bill) => sum + bill.amountCents, 0);
    const spare = checking.today.balanceCents - checking.bufferCents - billsEachMonth;
    const amountCents = Math.min(toGo, Math.floor(spare / 100) * 100);
    facts.push(
      fact(`${checking.account} today`, `${dollars(checking.today.balanceCents)}, with a ${dollars(checking.bufferCents)} Buffer`, forecast),
      fact(`Scheduled bills from ${checking.account} each month`, dollars(billsEachMonth), bills),
    );
    if (amountCents > 0) move = { key: "move", amountCents, from: checking.account, to: goal.account };
  }
  return {
    title,
    facts,
    options: [
      ...(move ? [move] : []),
      { key: "read_report" },
      { key: "remind_me", date: inAboutThreeMonths(session.today) },
      { key: "not_now" },
    ],
    agentsView: move
      ? `I would pick Move ${dollars(move.amountCents)} to ${goal.account}: ${move.from} keeps its Buffer and a month of bills, and the Goal grows now.`
      : months === null
        ? "I would pick Read the full report: it shows which Categories take up the money you'd save."
        : `I would pick Remind me: checking again in three months shows whether you're keeping the Usual month's pace.`,
    cantKnow: null,
    report: report(
      title,
      facts,
      months === null
        ? "A Usual month leaves nothing to save, so the Goal doesn't grow."
        : `Saving ${dollars(monthly)} a month, ${dollars(toGo)} takes ${months} months. That assumes the sweep keeps moving your Left to save, with no interest.`,
    ),
  };
}

async function fallback(
  session: ScriptSession,
  transactions: Called<TransactionsResult>,
  usual: Called<UsualFigures>,
): Promise<ModelFinding> {
  const biggest = [...usual.result.categories].sort((a, b) => b.usualMonthCents - a.usualMonthCents)[0];
  const title = `What your last ${RECENT_DAYS} days of spending show`;
  const facts = [
    fact(`Spent in the last ${RECENT_DAYS} days`, dollars(spendingIn(transactions.result)), transactions),
    fact("Usual month", `${dollars(usual.result.usualMonth.incomeCents)} in, ${dollars(usual.result.usualMonth.spendingCents)} out`, usual),
  ];
  if (biggest) facts.push(fact("Biggest Category in a Usual month", `${biggest.category}, ${dollars(biggest.usualMonthCents)}`, usual));
  const cantKnow = "Anything outside your Plinth accounts. This Mission read only your transactions and your Usual month.";
  return {
    title,
    facts,
    options: [{ key: "read_report" }, { key: "not_now" }],
    agentsView: "I would pick Read the full report: it lays out the figures your question touches.",
    cantKnow,
    report: report(title, facts, `What Plinth can't know: ${cantKnow}`),
  };
}

function notEnoughHistory(
  session: ScriptSession,
  transactions: Called<TransactionsResult>,
  usual: Called<UsualMonthResult>,
): ModelFinding {
  const title = "Not enough history to answer this yet";
  const facts = [
    fact("Full months of history", "None yet", usual),
    fact(`Transactions in the last ${RECENT_DAYS} days`, String(transactions.result.transactions.length), transactions),
  ];
  return {
    title,
    facts,
    // No Options: code adds Read the full report and Not now.
    options: [],
    agentsView: `I would pick Not now: ask again after ${formatLocalDate(firstOfNextMonth(firstOfNextMonth(session.today)))}, once you have a full month.`,
    cantKnow: null,
    report: report(title, facts, "Your agent works from your own history, and you have no full calendar month yet."),
  };
}
