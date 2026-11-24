import Link from "next/link";
import { getAppBank } from "@/app-bank";
import { CLOSURE_DELETES, CLOSURE_KEEPS, payoutText } from "@/closure-text";
import { requireCustomer } from "@/session";
import { NavBar } from "../../nav-bar";
import { closeAccountAction } from "./actions";

export const dynamic = "force-dynamic";

/** The Close and delete confirmation: nothing closes until the customer presses the button here. */
export default async function CloseAndDeletePage() {
  const customer = await requireCustomer();
  const { payout } = getAppBank().readClosureSummary(customer);

  return (
    <main className="page">
      <NavBar customer={customer} current="privacy" />
      <header className="top">
        <div>
          <h1>Close and delete</h1>
          <p className="muted">Closing your Plinth account can&rsquo;t be undone. Afterwards you can&rsquo;t sign in.</p>
        </div>
      </header>

      <section className="card" aria-labelledby="payout">
        <h2 id="payout">Payout</h2>
        <p>
          <b>{payoutText(payout)}</b>
        </p>
        <p className="muted">Your agent stops, and any running Mission is stopped first.</p>
      </section>

      <section className="card" aria-labelledby="keeps">
        <h2 id="keeps">What Plinth keeps</h2>
        <p className="muted">Kept as records, so the bank&rsquo;s books still balance and can be audited.</p>
        <ul>
          {CLOSURE_KEEPS.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </section>

      <section className="card" aria-labelledby="deletes">
        <h2 id="deletes">What Plinth deletes</h2>
        <ul>
          {CLOSURE_DELETES.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </section>

      <form action={closeAccountAction} className="button-row">
        <button type="submit" className="button danger">
          Close and delete my account
        </button>
        <Link href="/privacy" className="button secondary">
          Keep my account
        </Link>
      </form>
    </main>
  );
}
