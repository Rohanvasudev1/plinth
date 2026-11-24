"use client";

import { useActionState, useEffect, useState } from "react";
import { chooseOptionAction, markAgentActionsSeen, setStandingSearchAction, undoAction } from "./agent-actions";

/** The Undo button on one agent action. A refusal shows its reason under the button. */
export function UndoButton({ decisionId, action }: { decisionId: number; action: string }) {
  const [result, formAction, pending] = useActionState(undoAction, null);
  return (
    <form action={formAction} className="undo">
      <input type="hidden" name="decisionId" value={decisionId} />
      <button type="submit" className="button small" disabled={pending} aria-label={`Undo: ${action}`}>
        Undo
      </button>
      {result && !result.ok && (
        <p role="alert" className="result refused">
          Can&rsquo;t undo: {result.message}
        </p>
      )}
    </form>
  );
}

/**
 * Tells the customer about agent actions they haven't seen yet, once: as soon as the toast shows, it marks
 * them seen, so the next page load has none to show.
 */
export function AgentActionsToast({ actions }: { actions: { id: number; text: string }[] }) {
  const [open, setOpen] = useState(true);
  const ids = actions.map((action) => action.id).join(",");
  useEffect(() => {
    if (ids === "") return;
    void markAgentActionsSeen(ids.split(",").map(Number));
    const timer = setTimeout(() => setOpen(false), 8000);
    return () => clearTimeout(timer);
  }, [ids]);
  if (!open || actions.length === 0) return null;
  return (
    <div className="toast" role="status" aria-label="New from your agent">
      <ul>
        {actions.map((action) => (
          <li key={action.id}>{action.text}</li>
        ))}
      </ul>
      <button type="button" className="toast-close" onClick={() => setOpen(false)} aria-label="Dismiss">
        ×
      </button>
    </div>
  );
}

/** The on/off switch for one Standing search. Pressing it asks for the opposite of the state the page showed. */
export function StandingSearchSwitch({ search, on, label }: { search: string; on: boolean; label: string }) {
  const [result, formAction, pending] = useActionState(setStandingSearchAction, null);
  return (
    <form action={formAction} className="rule-switch">
      <input type="hidden" name="search" value={search} />
      <input type="hidden" name="on" value={String(!on)} />
      <button type="submit" className="switch" role="switch" aria-checked={on} aria-label={label} disabled={pending}>
        <span aria-hidden="true">{on ? "On" : "Off"}</span>
      </button>
      {result && !result.ok && (
        <p role="alert" className="result refused">
          {result.message}
        </p>
      )}
    </form>
  );
}

/** "Stop looking" on a Finding a Standing search made: switches that Standing search off. */
export function StopLookingButton({ search, label }: { search: string; label: string }) {
  const [result, formAction, pending] = useActionState(setStandingSearchAction, null);
  return (
    <form action={formAction}>
      <input type="hidden" name="search" value={search} />
      <input type="hidden" name="on" value="false" />
      <button type="submit" className="link-button" disabled={pending}>
        {label}
      </button>
      {result && !result.ok && (
        <p role="alert" className="result refused">
          {result.message}
        </p>
      )}
    </form>
  );
}

/** The Options on one open Finding, each a button. A refused pick shows its reason under them. */
export function FindingOptions({
  findingId,
  options,
}: {
  findingId: number;
  options: { key: string; label: string; detail: string }[];
}) {
  const [result, formAction, pending] = useActionState(chooseOptionAction, null);
  return (
    <form action={formAction} className="finding-options">
      <input type="hidden" name="findingId" value={findingId} />
      <div className="option-buttons">
        {options.map((option) => (
          <button key={option.key} type="submit" name="option" value={option.key} className="option-button" disabled={pending}>
            <b>{option.label}</b>
            <small>{option.detail}</small>
          </button>
        ))}
      </div>
      {result?.message && (
        <p role="alert" className="result refused">
          {result.message}
        </p>
      )}
      {result?.report && (
        <section className="report" aria-label="Full report">
          <h3>Full report</h3>
          <p>{result.report}</p>
        </section>
      )}
    </form>
  );
}
