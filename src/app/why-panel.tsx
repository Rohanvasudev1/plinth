import type { WhyRow } from "@/decisions";

/** The Why panel of one Decision log entry: its recorded rows, behind a "Why?" toggle. */
export function WhyPanel({ rows }: { rows: WhyRow[] }) {
  return (
    <details className="why">
      <summary>Why?</summary>
      <dl>
        {rows.map((row) => (
          <div key={row.label}>
            <dt>{row.label}</dt>
            <dd>{row.value}</dd>
          </div>
        ))}
      </dl>
    </details>
  );
}
