import Link from "next/link";
import type { ReactNode } from "react";
import { DISPLAY_TIME_ZONE } from "@/app-clock";
import { getAppBank } from "@/app-bank";
import type { BillsBeforePayday, HomeAccount, SafeToSpend } from "@/bank";
import { formatLocalDate, type LocalDate } from "@/calendar";
import { cents, formatDollars } from "@/money";
import { requireCustomer } from "@/session";

export const dynamic = "force-dynamic";

const dateFormat = new Intl.DateTimeFormat("en-GB", {
  weekday: "long",
  day: "numeric",
  month: "long",
  timeZone: DISPLAY_TIME_ZONE,
});

function SafeToSpendLine({ safe, nextPayday }: { safe: SafeToSpend; nextPayday: LocalDate | null }) {
  return (
    <div className="safe-to-spend">
      {safe.amount < 0 ? (
        <p>
          Heads up: you&rsquo;ll dip <strong>{formatDollars(cents(-safe.amount))}</strong> below your buffer before payday
        </p>
      ) : (
        <p>
          Safe to spend: <strong>{formatDollars(safe.amount)}</strong>
          {nextPayday && <> before payday on {formatLocalDate(nextPayday)}</>}
        </p>
      )}
      <p className="muted">
        {formatDollars(safe.checking)} in checking, less your {formatDollars(safe.buffer)} Buffer and{" "}
        {formatDollars(safe.billsBeforePayday)} of bills before payday
      </p>
    </div>
  );
}

function BillsCard({ bills }: { bills: BillsBeforePayday }) {
  return (
    <section className="card" aria-labelledby="bills-before-payday">
      <h2 id="bills-before-payday">Bills before payday</h2>
      {bills.bills.length === 0 ? (
        <p className="muted">
          {bills.nextPayday
            ? `No bills due before payday on ${formatLocalDate(bills.nextPayday)}.`
            : "No payday is scheduled, so no bills are counted."}
        </p>
      ) : (
        <>
          <ul className="bills">
            {bills.bills.map((bill) => (
              <li key={`${bill.billId}:${bill.dueDate}`}>
                <span>
                  <span className="muted bill-date">{formatLocalDate(bill.dueDate)}</span> {bill.payee}
                </span>
                <span className="num">{formatDollars(bill.amount)}</span>
              </li>
            ))}
          </ul>
          <p className="bills-total">
            <span>Total before {bills.nextPayday && formatLocalDate(bills.nextPayday)}</span>
            <span className="num">{formatDollars(bills.total)}</span>
          </p>
        </>
      )}
    </section>
  );
}

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
          {home.customerName} · <Link href="/sign-in">Switch</Link> · <Link href="/decision-log">Decision log</Link> ·{" "}
          <Link href="/simulator">Simulator</Link>
        </p>
      </header>

      {home.checking && (
        <AccountCard account={home.checking}>
          {home.safeToSpend && <SafeToSpendLine safe={home.safeToSpend} nextPayday={home.billsBeforePayday.nextPayday} />}
        </AccountCard>
      )}

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

      <BillsCard bills={home.billsBeforePayday} />
    </main>
  );
}
