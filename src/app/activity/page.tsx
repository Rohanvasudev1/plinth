import { getAppBank } from "@/app-bank";
import type { ActivityRow } from "@/bank";
import { formatLocalDate } from "@/calendar";
import { formatDollars } from "@/money";
import { requireCustomer } from "@/session";
import { NavBar } from "../nav-bar";

export const dynamic = "force-dynamic";

/** Money in shows a plus sign, so it reads apart from money out. */
function signedDollars(row: ActivityRow): string {
  return row.amount > 0 ? `+${formatDollars(row.amount)}` : formatDollars(row.amount);
}

export default async function ActivityPage() {
  const customer = await requireCustomer();
  const rows = getAppBank().readActivity(customer);
  return (
    <main className="page">
      <NavBar customerName={customer.name} current="activity" />
      <header className="top">
        <div>
          <h1>Activity</h1>
          <p className="muted">Everything that moved, newest first. Your agent&rsquo;s moves are tagged.</p>
        </div>
      </header>

      {rows.length === 0 ? (
        <p className="card muted">Nothing has moved yet.</p>
      ) : (
        <section className="card">
          <table className="activity" aria-label="Activity">
            <thead>
              <tr>
                <th scope="col">Date</th>
                <th scope="col">Description</th>
                <th scope="col" className="num-col">
                  Amount
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.ledgerTransactionId}>
                  <td className="muted date">
                    <time dateTime={row.date}>{formatLocalDate(row.date)}</time>
                  </td>
                  <td>
                    {row.counterparty ?? row.description}
                    {row.byAgent && <span className="tag">Agent</span>}
                    {row.category && <div className="category">{row.category}</div>}
                  </td>
                  <td className={`num num-col${row.amount > 0 ? " money-in" : ""}`}>{signedDollars(row)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </main>
  );
}
