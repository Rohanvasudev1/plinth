"use client";

import { useActionState, useEffect, useState } from "react";
import { markAgentActionsSeen, undoAction } from "./agent-actions";

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
