import { getAppBank } from "@/app-bank";
import type { GroupOnPage, SplitSummary } from "@/bank";
import { formatLocalDate } from "@/calendar";
import { formatDollars } from "@/money";
import { requireCustomer } from "@/session";
import { memberBalanceText } from "@/split-text";
import { NavBar } from "../nav-bar";
import { AddSharedCostForm } from "./add-shared-cost-form";

export const dynamic = "force-dynamic";

const SUMMARY: { key: keyof SplitSummary; label: string }[] = [
  { key: "owedToYou", label: "Owed to you" },
  { key: "youOwe", label: "You owe" },
  { key: "net", label: "Net" },
];

function GroupCard({ group }: { group: GroupOnPage }) {
  const headingId = `group-${group.id}`;
  return (
    <section className="card stack" aria-labelledby={headingId}>
      <div>
        <h2 id={headingId}>{group.name}</h2>
        <p className="muted">{group.memberNames.join(", ")}</p>
      </div>
      <ul className="balances" aria-label={`Who owes whom in ${group.name}`}>
        {group.otherMembers.map((member) => (
          <li key={member.memberId} className={member.status}>
            {memberBalanceText(member)}
          </li>
        ))}
      </ul>
      {group.sharedCosts.length === 0 ? (
        <p className="muted">No Shared costs yet.</p>
      ) : (
        <table className="activity" aria-label={`Shared costs in ${group.name}`}>
          <thead>
            <tr>
              <th scope="col">Date</th>
              <th scope="col">Shared cost</th>
              <th scope="col" className="num-col">
                Your Share
              </th>
            </tr>
          </thead>
          <tbody>
            {group.sharedCosts.map((cost) => (
              <tr key={cost.id}>
                <td className="muted date">
                  <time dateTime={cost.date}>{formatLocalDate(cost.date)}</time>
                </td>
                <td>
                  {cost.description}
                  <div className="category">
                    {cost.paidByYou ? "You paid" : `${cost.paidByName} paid`} {formatDollars(cost.amount)}
                  </div>
                </td>
                <td className="num num-col">{formatDollars(cost.yourShare)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

export default async function SplitPage() {
  const customer = await requireCustomer();
  const { groups, summary } = getAppBank().readSplit(customer);
  return (
    <main className="page">
      <NavBar customer={customer} current="split" />
      <header className="top">
        <div>
          <h1>Split</h1>
          <p className="muted">Shared costs with the people you share with. Each Share is equal; leftover cents go to whoever paid.</p>
        </div>
      </header>

      {groups.length === 0 ? (
        <p className="card muted">You aren&rsquo;t in any Groups.</p>
      ) : (
        <>
          <section className="card" aria-label="Where you stand">
            <dl className="stats">
              {SUMMARY.map(({ key, label }) => (
                <div key={key} className="stat">
                  <dt className="stat-label">{label}</dt>
                  <dd className="stat-value num">{formatDollars(summary[key])}</dd>
                </div>
              ))}
            </dl>
          </section>

          {groups.map((group) => (
            <GroupCard key={group.id} group={group} />
          ))}

          <section className="card stack" aria-labelledby="add-shared-cost">
            <div>
              <h2 id="add-shared-cost">Add a shared cost</h2>
              <p className="muted">You paid it. It&rsquo;s split equally across the Group, and no money moves.</p>
            </div>
            <AddSharedCostForm groups={groups.map((group) => ({ id: group.id, name: group.name }))} />
          </section>
        </>
      )}
    </main>
  );
}
