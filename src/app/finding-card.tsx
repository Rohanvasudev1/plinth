import { DISPLAY_TIME_ZONE } from "@/app-clock";
import type { FindingOnPage } from "@/bank";
import { formatLocalDate } from "@/calendar";
import { guardrailName } from "@/decisions";
import { describeOption, findingStateLabel, type FindingKind } from "@/findings";
import { FindingOptions } from "./agent-action-controls";

const findingTimeFormat = new Intl.DateTimeFormat("en-GB", {
  weekday: "short",
  day: "numeric",
  month: "short",
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
  timeZone: DISPLAY_TIME_ZONE,
});

const KIND_TAG: Record<FindingKind, string> = {
  sweep: "Your agent is asking",
  mission: "From a Mission you sent",
  subscription_price_rise: "From a Standing search",
};

/**
 * One Finding: its title, each fact with its Source, and, while it is open, its Options with what each does. The
 * Agent's view shows only when the page passes one: behind "What would the agent pick?" or always.
 */
export function FindingCard({
  finding,
  accountName,
}: {
  finding: FindingOnPage;
  accountName: (accountId: number) => string;
}) {
  const headingId = `finding-${finding.id}`;
  const chosen = finding.options.find((option) => option.key === finding.chosenOption);
  return (
    <section className="card finding" aria-labelledby={headingId}>
      <div className="decision-head">
        <span className="finding-tag">{KIND_TAG[finding.kind]}</span>
        <span className={`pill ${finding.state}`}>{findingStateLabel(finding.state)}</span>
      </div>
      <h2 id={headingId}>{finding.title}</h2>
      <p className="muted">
        <time dateTime={finding.at.toISOString()}>{findingTimeFormat.format(finding.at)}</time>
      </p>
      <dl className="facts">
        {finding.facts.map((fact) => (
          <div key={fact.label}>
            <dt>{fact.label}</dt>
            <dd>
              {fact.value}
              <small className="source">Source: {fact.source}</small>
            </dd>
          </div>
        ))}
      </dl>
      {finding.agentsView?.shown === "always" && (
        <div className="agents-view">
          <h3>What the agent would pick</h3>
          <p>{finding.agentsView.text}</p>
        </div>
      )}
      {finding.agentsView?.shown === "on_request" && (
        <details className="agents-view">
          <summary>What would the agent pick?</summary>
          <p>{finding.agentsView.text}</p>
        </details>
      )}
      {finding.state === "open" && (
        <>
          {finding.refusal && (
            <p className="result refused">
              Not moved. The {guardrailName(finding.refusal.guardrail)} guardrail refused it: {finding.refusal.reason}.
            </p>
          )}
          <FindingOptions
            findingId={finding.id}
            options={finding.options.map((option) => ({ key: option.key, ...describeOption(option, accountName) }))}
          />
        </>
      )}
      {chosen && <p className="muted">You chose: {describeOption(chosen, accountName).label}</p>}
      {finding.state === "snoozed" && finding.snoozedUntil && (
        <p className="muted">Put away until {formatLocalDate(finding.snoozedUntil)}. It shows again then.</p>
      )}
      {finding.state === "expired" && (
        <p className="muted">
          {finding.kind === "sweep" ? "A newer paycheck changed the numbers, so this expired." : "This has expired."}
        </p>
      )}
    </section>
  );
}
