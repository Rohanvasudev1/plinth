import Link from "next/link";
import type { ReactNode } from "react";
import { DISPLAY_TIME_ZONE } from "@/app-clock";
import { getAppBank } from "@/app-bank";
import type { HomeAccount } from "@/bank";
import { formatDollars } from "@/money";
import { requireCustomer } from "@/session";

export const dynamic = "force-dynamic";

const dateFormat = new Intl.DateTimeFormat("en-GB", {
  weekday: "long",
  day: "numeric",
  month: "long",
  timeZone: DISPLAY_TIME_ZONE,
});

function AccountCard({ account, children }: { account: HomeAccount; children?: ReactNode }) {
  const headingId = `account-${account.id}`;
  return (
    <section className="card" aria-labelledby={headingId}>
      <h2 id={headingId}>{account.name}</h2>
      <p className="amount">{formatDollars(account.balance)}</p>
      {children}
    </section>
  );
}

export default async function HomePage() {
  const customer = await requireCustomer();
  const home = getAppBank().readHome(customer);
  return (
    <main className="page">
      <header className="top">
        <div>
          <h1>Home</h1>
          <p className="muted">{dateFormat.format(home.today)}</p>
        </div>
        <p className="muted signed-in">
          {home.customerName} · <Link href="/sign-in">Switch</Link>
        </p>
      </header>

      {home.checking && <AccountCard account={home.checking} />}

      {home.savings.map((account) => (
        <AccountCard key={account.id} account={account}>
          {account.goal && (
            <>
              <div
                className="goal-bar"
                role="progressbar"
                aria-label={`${account.name} Goal progress`}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={account.goal.percentReached}
              >
                <div style={{ width: `${account.goal.percentReached}%` }} />
              </div>
              <p className="muted">
                Goal: {account.goal.percentReached}% of {formatDollars(account.goal.target)}
              </p>
            </>
          )}
        </AccountCard>
      ))}
    </main>
  );
}
