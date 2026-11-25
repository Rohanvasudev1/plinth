"use client";

import { useActionState } from "react";
import { cardPurchase, outsideContactSharedCost, runClock, type SimulatorResult } from "./actions";

function Result({ result }: { result: SimulatorResult | null }) {
  if (!result) return null;
  return (
    <p role="status" className={result.ok ? "result" : "result refused"}>
      {result.message}
    </p>
  );
}

export function ClockControls() {
  const [result, action, pending] = useActionState(runClock, null);
  return (
    <form action={action} className="stack">
      <div className="button-row">
        <button type="submit" name="button" value="paycheck" className="button" disabled={pending}>
          Post paycheck
        </button>
        <button type="submit" name="button" value="advance" className="button" disabled={pending}>
          Advance clock one day
        </button>
      </div>
      <Result result={result} />
    </form>
  );
}

export function CardPurchaseForm(props: {
  merchants: { key: string; label: string }[];
  accounts: { id: number; label: string }[];
  /** Fresh on every render of the page, so a double click or resubmit posts the purchase once. */
  purchaseId: string;
}) {
  const [result, action, pending] = useActionState(cardPurchase, null);
  return (
    <form action={action} className="stack">
      <input type="hidden" name="purchaseId" value={props.purchaseId} />
      <label className="field">
        <span>Merchant</span>
        <select name="merchant" required>
          {props.merchants.map((merchant) => (
            <option key={merchant.key} value={merchant.key}>
              {merchant.label}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>Account</span>
        <select name="accountId" required>
          {props.accounts.map((account) => (
            <option key={account.id} value={account.id}>
              {account.label}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>Amount in dollars</span>
        <input name="amount" inputMode="decimal" autoComplete="off" required placeholder="25.00" />
      </label>
      <button type="submit" className="button" disabled={pending}>
        Spend
      </button>
      <Result result={result} />
    </form>
  );
}

/** An Outside contact, such as Jordan Reyes, adds a Shared cost they paid to one of the signed-in customer's Groups. */
export function OutsideContactSharedCostForm(props: { members: { value: string; label: string }[] }) {
  const [result, action, pending] = useActionState(outsideContactSharedCost, null);
  return (
    <form action={action} className="stack">
      <label className="field">
        <span>Who, in which Group</span>
        <select name="member" required>
          {props.members.map((member) => (
            <option key={member.value} value={member.value}>
              {member.label}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>What for</span>
        <input name="description" autoComplete="off" required placeholder="Cleaning supplies" />
      </label>
      <label className="field">
        <span>Amount in dollars</span>
        <input name="amount" inputMode="decimal" autoComplete="off" required placeholder="36.00" />
      </label>
      <button type="submit" className="button" disabled={pending}>
        Add shared cost
      </button>
      <Result result={result} />
    </form>
  );
}
