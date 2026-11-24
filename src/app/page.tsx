import Link from "next/link";
import type { ReactNode } from "react";
import { DISPLAY_TIME_ZONE } from "@/app-clock";
import { getAppBank } from "@/app-bank";
import type { AgentActionOnHome, BillsBeforePayday, HomeAccount, SafeToSpend } from "@/bank";
import { formatLocalDate, type LocalDate } from "@/calendar";
import { cents, formatDollars } from "@/money";
import type { Decision } from "@/decisions";
import { requireCustomer } from "@/session";
import { STANDARD_SETUP } from "@/setup-answers";
import { SetupSurvey } from "./setup/setup-survey";
import { AgentActionsToast, UndoButton } from "./agent-action-controls";
import { FindingCard } from "./finding-card";
import { ForecastChart } from "./forecast-chart";
import { NavBar } from "./nav-bar";
import { WhyPanel } from "./why-panel";

export const dynamic = "force-dynamic";

const dateFormat = new Intl.DateTimeFormat("en-GB", {
  weekday: "long",
  day: "numeric",
  month: "long",
  timeZone: DISPLAY_TIME_ZONE,
});

const actionTimeFormat = new Intl.DateTimeFormat("en-GB", {
  weekday: "short",
  day: "numeric",
  month: "short",
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
  timeZone: DISPLAY_TIME_ZONE,
});

function AgentActionsCard({ actions }: { actions: AgentActionOnHome[] }) {
  return (
    <section className="card" aria-labelledby="what-your-agent-did">
      <h2 id="what-your-agent-did">What your agent did</h2>
      {actions.length === 0 ? (
        <p className="muted">Your agent hasn&rsquo;t done anything yet.</p>
      ) : (
        <ol className="agent-actions">
          {actions.map(({ decision, state }) => (
            <li key={decision.id}>
              <article className="decision" aria-labelledby={`agent-action-${decision.id}`}>
                <div className="decision-head">
                  <h3 id={`agent-action-${decision.id}`} className={state === "Reversed" ? "undone" : undefined}>
                    {decision.action}
                  </h3>
                  <span className={`pill ${state.toLowerCase()}`}>{state}</span>
                </div>
                <p className="muted">
                  <time dateTime={decision.at.toISOString()}>{actionTimeFormat.format(decision.at)}</time> ·{" "}
                  {decision.trigger.description}
                </p>
                <div className="agent-action-controls">
                  <WhyPanel rows={decision.why} />
                  {state === "Done" && <UndoButton decisionId={decision.id} action={decision.action} />}
                </div>
              </article>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function toastText(decision: Decision): string {
  return decision.result === "Refused"
    ? `Your agent didn’t act: ${decision.action} was refused`
    : `Your agent: ${decision.action}`;
}

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
  const bank = getAppBank();
  if (!bank.readSettings(customer)) {
    // A customer with no settings record hasn't finished setup, so the agent waits for the Setup survey.
    return (
      <main className="page narrow">
        <NavBar customer={customer} current="home" />
        <header className="top">
          <div>
            <h1>Before your agent does anything, tell it how you want to be looked after</h1>
            <p className="muted">
              Six questions. Your answers become the rules your agent can&rsquo;t break. You can change any of them later in
              Agent &amp; limits.
            </p>
          </div>
        </header>
        <SetupSurvey initial={STANDARD_SETUP} firstRun />
      </main>
    );
  }
  const home = bank.readHome(customer);
  const accounts = [...(home.checking ? [home.checking] : []), ...home.savings];
  const accountName = (accountId: number) => accounts.find((account) => account.id === accountId)?.name ?? "an account";
  return (
    <main className="page">
      <NavBar customer={customer} current="home" />
      <header className="top">
        <div>
          <h1>Home</h1>
          <p className="muted">{dateFormat.format(home.today)}</p>
        </div>
      </header>

      {home.agentPaused && (
        <section className="card paused-banner" aria-labelledby="agent-paused">
          <h2 id="agent-paused">Your agent is paused</h2>
          <p className="muted">
            It takes no automatic actions until you unpause it on <Link href="/agent">Agent &amp; limits</Link>.
          </p>
        </section>
      )}

      {home.findings.map((finding) => (
        <FindingCard key={finding.id} finding={{ ...finding, agentsView: null }} accountName={accountName} />
      ))}

      {home.openFindingCount > 0 && (
        <Link href="/discoveries" className="card link-card">
          <strong>
            Your agent found {home.openFindingCount} {home.openFindingCount === 1 ? "thing" : "things"}.
          </strong>{" "}
          <span className="muted">Nothing changes unless you choose.</span>
        </Link>
      )}

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

      <Link href="/accounts" className="card link-card">
        <strong>All accounts</strong> <span className="muted">See your Net worth, with the accounts you linked from Institutions.</span>
      </Link>

      {home.forecast && <ForecastChart forecast={home.forecast} />}

      <AgentActionsCard actions={home.agentActions} />

      <BillsCard bills={home.billsBeforePayday} />

      <AgentActionsToast
        actions={home.unseenAgentActions.map((decision) => ({ id: decision.id, text: toastText(decision) }))}
      />
    </main>
  );
}
