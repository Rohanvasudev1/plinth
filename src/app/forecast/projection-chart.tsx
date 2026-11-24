"use client";

import { useState } from "react";
import { cents, formatDollars, formatDollarsBriefly, type Cents } from "@/money";
import { MAX_CUT_PERCENT, PROJECTION_MONTHS, projectionLines, type Projection } from "@/projection";
import { coordinate, linePath } from "../chart-drawing";

// Drawing units, not pixels: the SVG scales to its card's width, so it fits a 390px screen.
const WIDTH = 360;
const HEIGHT = 190;
const PAD = { left: 52, right: 8, top: 14, bottom: 24 };

/** The cut the slider starts at, as in the demo. */
const STARTING_CUT = 20;
const CUT_STEP = 5;

/**
 * The 3-year Projection of the sweep target at three paces, drawn as SVG lines with a text summary of each. The
 * slider recomputes only the "with your changes" line, in the browser. It saves nothing.
 */
export function ProjectionChart({ projection, month }: { projection: Projection; month: string }) {
  const [cut, setCut] = useState(STARTING_CUT);
  const lines = projectionLines(projection, cut);
  // The scale fits the largest cut, so moving the slider moves the line, not the axis.
  const widest = projectionLines(projection, MAX_CUT_PERCENT);
  const high = Math.max(
    projection.balance,
    ...[widest.usualMonth, widest.onPace, widest.withChanges, lines.withChanges].flatMap((line) => line.balances),
    1,
  );
  const x = (index: number) => PAD.left + (index * (WIDTH - PAD.left - PAD.right)) / PROJECTION_MONTHS;
  const y = (amount: number) => PAD.top + ((high - amount) * (HEIGHT - PAD.top - PAD.bottom)) / high;
  const path = (balances: Cents[]) => linePath([projection.balance, ...balances], x, y);
  // The top label is the highest balance rounded down to a whole $1,000, drawn at its own height.
  const topLabel = cents(Math.floor(high / 100_000) * 100_000);
  const cutCategories = projection.cutCategories.join(" and ");
  const finalOf = (balances: Cents[]) => formatDollars(balances[balances.length - 1] ?? projection.balance);
  const cutAmount = cents(lines.withChanges.monthlySaving - lines.onPace.monthlySaving);

  return (
    <section className="card" aria-labelledby="projection-heading">
      <div className="card-head">
        <h2 id="projection-heading">3-year Projection of your {projection.goalAccountName}</h2>
        <p className="muted">
          Assumes everything you save goes to your {projection.goalAccountName}, with no interest. Starts from{" "}
          {formatDollars(projection.balance)} today.
        </p>
      </div>
      <svg
        className="forecast-chart"
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        role="img"
        aria-labelledby="projection-heading projection-summary-heading"
      >
        {topLabel > 0 && (
          <>
            <line x1={PAD.left} x2={WIDTH - PAD.right} y1={coordinate(y(topLabel))} y2={coordinate(y(topLabel))} className="chart-zero" />
            <text x={PAD.left - 6} y={coordinate(y(topLabel)) + 4} textAnchor="end" className="chart-axis">
              {formatDollarsBriefly(topLabel)}
            </text>
          </>
        )}
        <line x1={PAD.left} x2={WIDTH - PAD.right} y1={coordinate(y(0))} y2={coordinate(y(0))} className="chart-zero" />
        <text x={PAD.left - 6} y={coordinate(y(0)) + 4} textAnchor="end" className="chart-axis">
          $0
        </text>
        <path d={path(lines.usualMonth.balances)} className="projection-line usual" />
        <path d={path(lines.onPace.balances)} className="projection-line on-pace" />
        <path d={path(lines.withChanges.balances)} className="projection-line with-changes" />
        <text x={PAD.left} y={HEIGHT - 6} className="chart-axis">
          Today
        </text>
        <text x={WIDTH - PAD.right} y={HEIGHT - 6} textAnchor="end" className="chart-axis">
          3 years
        </text>
      </svg>

      <h3 id="projection-summary-heading" className="projection-summary-heading">
        Your {projection.goalAccountName} after 3 years
      </h3>
      <ul className="projection-summary">
        <li>
          <i className="usual" aria-hidden="true" />
          Your usual month, saving {formatDollars(lines.usualMonth.monthlySaving)} a month:{" "}
          <b className="num">{finalOf(lines.usualMonth.balances)}</b>
        </li>
        <li>
          <i className="on-pace" aria-hidden="true" />
          Every month like {month}, saving {formatDollars(lines.onPace.monthlySaving)} a month:{" "}
          <b className="num">{finalOf(lines.onPace.balances)}</b>
        </li>
        <li aria-live="polite" data-testid="with-changes">
          <i className="with-changes" aria-hidden="true" />
          {month} with your changes, saving {formatDollars(lines.withChanges.monthlySaving)} a month:{" "}
          <b className="num">{finalOf(lines.withChanges.balances)}</b>
        </li>
      </ul>

      <div className="try-it">
        <label htmlFor="projection-cut">
          Try it: cut {cutCategories} by <span className="num">{cut}%</span>
        </label>
        <input
          id="projection-cut"
          type="range"
          min={0}
          max={MAX_CUT_PERCENT}
          step={CUT_STEP}
          value={cut}
          onChange={(event) => setCut(Number(event.currentTarget.value))}
        />
        <p className="muted">
          That cuts {formatDollars(cutAmount)} a month from {month}&rsquo;s pace. Trying this changes nothing in your
          account or Rules.
        </p>
      </div>
    </section>
  );
}
