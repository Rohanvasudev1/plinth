import { DISPLAY_TIME_ZONE } from "@/app-clock";
import { getAppBank } from "@/app-bank";
import type { Decision } from "@/decisions";
import { formatDollars } from "@/money";
import { requireCustomer } from "@/session";
import { NavBar } from "../nav-bar";
import { WhyPanel } from "../why-panel";

export const dynamic = "force-dynamic";

const timeFormat = new Intl.DateTimeFormat("en-GB", {
  weekday: "short",
  day: "numeric",
  month: "short",
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
  timeZone: DISPLAY_TIME_ZONE,
});

function DecisionEntry({ decision }: { decision: Decision }) {
  const headingId = `decision-${decision.id}`;
  return (
    <li>
      <article className="card decision" aria-labelledby={headingId}>
        <div className="decision-head">
          <h2 id={headingId}>{decision.action}</h2>
          <span className={`pill ${decision.result.toLowerCase()}`}>{decision.result}</span>
        </div>
        <p className="muted">
          <time dateTime={decision.at.toISOString()}>{timeFormat.format(decision.at)}</time> ·{" "}
          {decision.actor === "agent" ? "Your agent" : "You"}
          {decision.rule && (
            <>
              {" "}
              · Rule #{decision.rule.id} v{decision.rule.version}
            </>
          )}
          {decision.amount > 0 && (
            <>
              {" "}
              · <span className="num">{formatDollars(decision.amount)}</span>
            </>
          )}
          {decision.reversedByDecisionId !== null && <> · Reversed by you</>}
        </p>
        <WhyPanel rows={decision.why} />
      </article>
    </li>
  );
}

export default async function DecisionLogPage() {
  const customer = await requireCustomer();
  const decisions = getAppBank().readDecisionLog(customer);
  return (
    <main className="page">
      <NavBar customer={customer} current="decision-log" />
      <header className="top">
        <div>
          <h1>Decision log</h1>
          <p className="muted">Every action your agent took or tried to take, every change you made to it, the Rule behind each, and what happened.</p>
        </div>
      </header>

      {decisions.length === 0 ? (
        <p className="card muted">Your agent hasn&rsquo;t done anything yet.</p>
      ) : (
        <ol className="decisions">
          {decisions.map((decision) => (
            <DecisionEntry key={decision.id} decision={decision} />
          ))}
        </ol>
      )}
    </main>
  );
}
