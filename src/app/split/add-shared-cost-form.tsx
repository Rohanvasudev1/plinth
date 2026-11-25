"use client";

import { useActionState } from "react";
import { addSharedCostAction } from "./actions";

/** "Add a shared cost": what for, the amount and the Group. The signed-in customer paid it. */
export function AddSharedCostForm({ groups }: { groups: { id: number; name: string }[] }) {
  const [result, action, pending] = useActionState(addSharedCostAction, null);
  return (
    <form action={action} className="stack">
      <label className="field">
        <span>What for</span>
        <input name="description" autoComplete="off" required placeholder="Takeaway on Friday" />
      </label>
      <label className="field">
        <span>Amount in dollars</span>
        <input name="amount" inputMode="decimal" autoComplete="off" required placeholder="48.00" />
      </label>
      <label className="field">
        <span>Group</span>
        <select name="groupId" required>
          {groups.map((group) => (
            <option key={group.id} value={group.id}>
              {group.name}
            </option>
          ))}
        </select>
      </label>
      <button type="submit" className="button" disabled={pending}>
        Add
      </button>
      {result && (
        <p role="status" className={result.ok ? "result" : "result refused"}>
          {result.message}
        </p>
      )}
    </form>
  );
}
