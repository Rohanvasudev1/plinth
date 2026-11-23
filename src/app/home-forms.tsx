"use client";

import { useActionState, useEffect, useState } from "react";
import { markAgentActionsSeen, undoAgentAction } from "./home-actions";

/**
 * The Undo button for one agent action, and what Undo did or why it was refused. It stays mounted after
 * the action can no longer be undone, so the answer is still on screen once the button has gone.
 */
export function UndoControls({ decisionId, canUndo }: { decisionId: number; canUndo: boolean }) {
  const [result, action, pending] = useActionState(undoAgentAction, null);
  return (
    <form action={action} className="undo">
      <input type="hidden" name="decisionId" value={decisionId} />
      {canUndo && (
        <button type="submit" className="button small" disabled={pending}>
          Undo
        </button>
      )}
      {result && (
        <p role="status" className={result.ok ? "result" : "result refused"}>
          {result.message}
        </p>
      )}
    </form>
  );
}

/** Tells the customer what their agent did while they were away, once: showing it marks it seen. */
export function AgentToast({ message }: { message: string }) {
  const [shown, setShown] = useState(true);
  useEffect(() => {
    void markAgentActionsSeen();
  }, []);
  if (!shown) return null;
  return (
    <div className="toast" role="status">
      <span>{message}</span>
      <button type="button" className="toast-dismiss" onClick={() => setShown(false)}>
        Dismiss
      </button>
    </div>
  );
}
