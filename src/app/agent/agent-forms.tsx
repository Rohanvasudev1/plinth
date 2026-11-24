"use client";

import { useActionState } from "react";
import { setBuffer, setPaymentLimit, switchRule, type AgentFormResult } from "./actions";

function Result({ result }: { result: AgentFormResult | null }) {
  if (!result) return null;
  return (
    <p role="status" className={result.ok ? "result" : "result refused"}>
      {result.message}
    </p>
  );
}

/** An on/off switch for one Rule. Pressing it asks for the opposite of the state the page showed. */
export function RuleSwitch(props: { ruleId: number; on: boolean; label: string }) {
  const [result, action, pending] = useActionState(switchRule, null);
  return (
    <form action={action} className="rule-switch">
      <input type="hidden" name="ruleId" value={props.ruleId} />
      <input type="hidden" name="on" value={String(!props.on)} />
      <button type="submit" className="switch" role="switch" aria-checked={props.on} aria-label={props.label} disabled={pending}>
        <span aria-hidden="true">{props.on ? "On" : "Off"}</span>
      </button>
      {result && !result.ok && <Result result={result} />}
    </form>
  );
}

/** A form that sets one whole-dollar amount on a Rule: the Buffer or the Payment limit. */
export function RuleAmountForm(props: {
  kind: "buffer" | "paymentLimit";
  ruleId: number;
  label: string;
  hint: string;
  /** The current amount in whole dollars, as the input's starting text. */
  dollars: string;
}) {
  const [result, action, pending] = useActionState(props.kind === "buffer" ? setBuffer : setPaymentLimit, null);
  return (
    <form action={action} className="stack">
      <input type="hidden" name="ruleId" value={props.ruleId} />
      <label className="field">
        <span>{props.label}</span>
        <input name="amount" inputMode="numeric" autoComplete="off" required defaultValue={props.dollars} />
        <small className="muted">{props.hint}</small>
      </label>
      <button type="submit" className="button" disabled={pending}>
        Save
      </button>
      <Result result={result} />
    </form>
  );
}
