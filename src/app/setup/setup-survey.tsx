"use client";

import Link from "next/link";
import { useState, useTransition, type FormEvent, type ReactNode } from "react";
import { formatDollarRange, formatDollarsForInput, parseDollars, type Cents, type CentsRange } from "@/money";
import { BUFFER_RANGE, PAYMENT_LIMIT_RANGE } from "@/rules";
import {
  ADVICE_SETTINGS,
  AUTONOMY_LEVELS,
  GOAL_PREFERENCES,
  MARKET_DROP_ANSWERS,
  TIME_HORIZON_ANSWERS,
  type DataChoices,
  type GoalPreference,
} from "@/settings";
import { GOAL_PREFERENCE_TEXT, MARKET_DROP_TEXT, TIME_HORIZON_TEXT } from "@/settings-text";
import type { SetupAnswers } from "@/setup-answers";
import { ADVICE_CHOICE_TEXT, AUTONOMY_CHOICE_TEXT, GOAL_DETAIL_TEXT, setupSummary } from "@/setup-text";
import { finishSetup, skipSetup } from "./actions";

/** The survey's answers while the customer works through it, with the amounts as typed. Nothing is saved until the end. */
type Draft = Omit<SetupAnswers, "buffer" | "paymentLimit"> & { buffer: string; paymentLimit: string };

const STEP_TITLES = [
  "What are you working toward?",
  "How much should your agent do on its own?",
  "When your agent finds something, it should:",
  "Set your limits",
  "Investing: how do you feel about risk?",
  "Your data",
] as const;
const SUMMARY_STEP = STEP_TITLES.length;

/** Reads a typed whole-dollar amount inside `range`, or returns null. */
function wholeDollars(text: string, range: CentsRange): Cents | null {
  try {
    const amount = parseDollars(text);
    return amount % 100 === 0 && amount >= range.min && amount <= range.max ? amount : null;
  } catch {
    return null;
  }
}

function Choice(props: {
  type: "radio" | "checkbox";
  name: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  detail?: string;
  badge?: ReactNode;
}) {
  return (
    <label className="opt">
      <input type={props.type} name={props.name} checked={props.checked} onChange={(event) => props.onChange(event.target.checked)} />
      <span>
        {props.label}
        {props.badge}
        {props.detail && <small>{props.detail}</small>}
      </span>
    </label>
  );
}

/**
 * The Setup survey: six steps and a summary, with Back and Next. Answers stay in the browser until the customer
 * turns the agent on from the summary, so leaving halfway saves nothing.
 */
export function SetupSurvey(props: {
  /** The customer's current answers on a re-run, or the standard answers the first time. */
  initial: SetupAnswers;
  /** True the first time, when Skip is offered. On a re-run the customer can go back to Agent & limits instead. */
  firstRun: boolean;
}) {
  const [step, setStep] = useState(0);
  const [draft, setDraft] = useState<Draft>({
    ...props.initial,
    buffer: formatDollarsForInput(props.initial.buffer),
    paymentLimit: formatDollarsForInput(props.initial.paymentLimit),
  });
  const [problem, setProblem] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const buffer = wholeDollars(draft.buffer, BUFFER_RANGE);
  const paymentLimit = wholeDollars(draft.paymentLimit, PAYMENT_LIMIT_RANGE);
  const answers: SetupAnswers | null =
    buffer === null || paymentLimit === null ? null : { ...draft, buffer, paymentLimit };

  function update(change: Partial<Draft>) {
    setDraft((current) => ({ ...current, ...change }));
    setProblem(null);
  }

  /** Adds a goal at the end of the order when picked, and takes it out when unpicked. */
  function pickGoal(goal: GoalPreference, picked: boolean) {
    const others = draft.goalPreferences.filter((other) => other !== goal);
    update({ goalPreferences: picked ? [...others, goal] : others });
  }

  function setDataChoice(choice: keyof DataChoices, on: boolean) {
    update({ dataChoices: { ...draft.dataChoices, [choice]: on } });
  }

  function next(event: FormEvent) {
    event.preventDefault();
    if (step === 3 && !answers) {
      setProblem(
        `The Buffer must be a whole-dollar amount from ${formatDollarRange(BUFFER_RANGE)}, and the Payment limit from ${formatDollarRange(PAYMENT_LIMIT_RANGE)}.`,
      );
      return;
    }
    if (step < SUMMARY_STEP) {
      setStep(step + 1);
      return;
    }
    if (!answers) return;
    startTransition(async () => {
      const refusal = await finishSetup(answers);
      setProblem(refusal.message);
    });
  }

  return (
    <form className="card survey" onSubmit={next} aria-labelledby="survey-title">
      <div className="survey-progress" aria-hidden="true">
        {STEP_TITLES.map((title, index) => (
          <i key={title} className={index < step ? "on" : undefined} />
        ))}
      </div>
      <p className="eyebrow">
        {step < SUMMARY_STEP ? `Set up your agent · Step ${step + 1} of ${STEP_TITLES.length}` : "Set up your agent · Summary"}
      </p>

      {step === 0 && (
        <>
          <h2 id="survey-title">{STEP_TITLES[0]}</h2>
          <p className="muted">Pick any. Your agent puts spare money toward these, in the order you pick them.</p>
          <fieldset className="opts">
            <legend className="visually-hidden">Goals</legend>
            {GOAL_PREFERENCES.map((goal) => {
              const position = draft.goalPreferences.indexOf(goal);
              return (
                <Choice
                  key={goal}
                  type="checkbox"
                  name="goal"
                  checked={position >= 0}
                  onChange={(picked) => pickGoal(goal, picked)}
                  label={GOAL_PREFERENCE_TEXT[goal]}
                  detail={GOAL_DETAIL_TEXT[goal]}
                  badge={position >= 0 && <span className="order"> · #{position + 1}</span>}
                />
              );
            })}
          </fieldset>
        </>
      )}

      {step === 1 && (
        <>
          <h2 id="survey-title">{STEP_TITLES[1]}</h2>
          <fieldset className="opts">
            <legend className="visually-hidden">Autonomy level</legend>
            {AUTONOMY_LEVELS.map((level) => (
              <Choice
                key={level}
                type="radio"
                name="autonomyLevel"
                checked={draft.autonomyLevel === level}
                onChange={() => update({ autonomyLevel: level })}
                {...AUTONOMY_CHOICE_TEXT[level]}
              />
            ))}
          </fieldset>
        </>
      )}

      {step === 2 && (
        <>
          <h2 id="survey-title">{STEP_TITLES[2]}</h2>
          <fieldset className="opts">
            <legend className="visually-hidden">Advice setting</legend>
            {ADVICE_SETTINGS.map((setting) => (
              <Choice
                key={setting}
                type="radio"
                name="adviceSetting"
                checked={draft.adviceSetting === setting}
                onChange={() => update({ adviceSetting: setting })}
                {...ADVICE_CHOICE_TEXT[setting]}
              />
            ))}
          </fieldset>
        </>
      )}

      {step === 3 && (
        <>
          <h2 id="survey-title">{STEP_TITLES[3]}</h2>
          <label className="field">
            <span>Always keep this much in checking, in dollars</span>
            <input
              name="buffer"
              inputMode="numeric"
              autoComplete="off"
              value={draft.buffer}
              onChange={(event) => update({ buffer: event.target.value })}
            />
            <small className="muted">Your agent never moves money below this, after bills before payday</small>
          </label>
          <label className="field">
            <span>Largest move it can make without asking, in dollars</span>
            <input
              name="paymentLimit"
              inputMode="numeric"
              autoComplete="off"
              value={draft.paymentLimit}
              onChange={(event) => update({ paymentLimit: event.target.value })}
            />
            <small className="muted">When it handles small things, anything bigger needs your OK</small>
          </label>
        </>
      )}

      {step === 4 && (
        <>
          <h2 id="survey-title">{STEP_TITLES[4]}</h2>
          <fieldset className="opts">
            <legend className="sub-q">If your investments fell 20% in a month, you would:</legend>
            {MARKET_DROP_ANSWERS.map((answer) => (
              <Choice
                key={answer}
                type="radio"
                name="marketDrop"
                checked={draft.riskAnswers.marketDrop === answer}
                onChange={() => update({ riskAnswers: { ...draft.riskAnswers, marketDrop: answer } })}
                label={MARKET_DROP_TEXT[answer]}
              />
            ))}
          </fieldset>
          <fieldset className="opts">
            <legend className="sub-q">When will you need this money?</legend>
            {TIME_HORIZON_ANSWERS.map((answer) => (
              <Choice
                key={answer}
                type="radio"
                name="timeHorizon"
                checked={draft.riskAnswers.timeHorizon === answer}
                onChange={() => update({ riskAnswers: { ...draft.riskAnswers, timeHorizon: answer } })}
                label={TIME_HORIZON_TEXT[answer]}
              />
            ))}
          </fieldset>
        </>
      )}

      {step === 5 && (
        <>
          <h2 id="survey-title">{STEP_TITLES[5]}</h2>
          <p className="muted">Plinth only uses your data for you, unless you say otherwise.</p>
          <fieldset className="opts">
            <legend className="visually-hidden">Data choices</legend>
            <Choice
              type="checkbox"
              name="trainModels"
              checked={draft.dataChoices.trainModels}
              onChange={(on) => setDataChoice("trainModels", on)}
              label="Let Plinth train its AI models on my data"
              detail="Anonymised first. Off by default"
            />
            <Choice
              type="checkbox"
              name="shareWithPartners"
              checked={draft.dataChoices.shareWithPartners}
              onChange={(on) => setDataChoice("shareWithPartners", on)}
              label="Share my data with partners for offers"
              detail="Off by default"
            />
            <Choice
              type="checkbox"
              name="keepChatHistory"
              checked={draft.dataChoices.keepChatHistory}
              onChange={(on) => setDataChoice("keepChatHistory", on)}
              label="Keep my chat history for 90 days"
              detail="So your agent remembers recent conversations. Off by default"
            />
          </fieldset>
        </>
      )}

      {step === SUMMARY_STEP && answers && (
        <>
          <h2 id="survey-title">Here are your agent&rsquo;s rules</h2>
          <p className="muted">Plain words, exactly as your agent will follow them.</p>
          <ul className="summary" aria-label="Summary">
            {setupSummary(answers).map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </>
      )}

      {problem && (
        <p role="alert" className="result refused">
          {problem}
        </p>
      )}

      <div className="survey-foot">
        <button
          type="button"
          className="button secondary"
          onClick={() => {
            setProblem(null);
            setStep(step - 1);
          }}
          disabled={step === 0 || pending}
        >
          Back
        </button>
        <span className="button-row">
          {props.firstRun ? (
            <button type="button" className="button secondary" disabled={pending} onClick={() => startTransition(() => skipSetup())}>
              Skip for now
            </button>
          ) : (
            <Link href="/agent" className="button secondary">
              Cancel
            </Link>
          )}
          <button type="submit" className="button" disabled={pending}>
            {step === SUMMARY_STEP ? "Turn on my agent" : "Next"}
          </button>
        </span>
      </div>
    </form>
  );
}
