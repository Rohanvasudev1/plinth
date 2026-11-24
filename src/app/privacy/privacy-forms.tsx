"use client";

import { useActionState } from "react";
import type { DataChoice } from "@/settings";
import { setDataChoiceAction } from "./actions";

/** The on/off switch for one Data choice. Pressing it asks for the opposite of the state the page showed. */
export function DataChoiceSwitch({ choice, on, label }: { choice: DataChoice; on: boolean; label: string }) {
  const [result, action, pending] = useActionState(setDataChoiceAction, null);
  return (
    <form action={action} className="rule-switch">
      <input type="hidden" name="choice" value={choice} />
      <input type="hidden" name="on" value={String(!on)} />
      <button type="submit" className="switch" role="switch" aria-checked={on} aria-label={label} disabled={pending}>
        <span aria-hidden="true">{on ? "On" : "Off"}</span>
      </button>
      {result && !result.ok && (
        <p role="status" className="result refused">
          {result.message}
        </p>
      )}
    </form>
  );
}
