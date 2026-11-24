import type { Forecast } from "@/bank";
import { formatLocalDate } from "@/calendar";
import { cents, formatDollars, formatDollarsBriefly, type Cents } from "@/money";
import { coordinate, linePath } from "./chart-drawing";

// Drawing units, not pixels: the SVG scales to its card's width, so it fits a 390px screen.
const WIDTH = 360;
const HEIGHT = 170;
const PAD = { left: 52, right: 8, top: 14, bottom: 24 };

/** The lowest balance and its date, and how it sits against the Buffer, for screen readers and everyone else. */
function summaryText(forecast: Forecast): string {
  const { lowest, buffer } = forecast;
  const low = `Lowest balance in the next 30 days: ${formatDollars(lowest.balance)} on ${formatLocalDate(lowest.date)}.`;
  if (buffer === null) return low;
  const gap = cents(lowest.balance - buffer);
  return gap < 0
    ? `${low} That is ${formatDollars(cents(-gap))} below your ${formatDollars(buffer)} Buffer.`
    : `${low} It stays above your ${formatDollars(buffer)} Buffer.`;
}

/** The 30-day Forecast of the checking balance as a server-rendered SVG line, with the Buffer and a text summary. */
export function ForecastChart({ forecast }: { forecast: Forecast }) {
  const points = [forecast.start, ...forecast.days];
  const balances: number[] = points.map((point) => point.balance);
  const marks = forecast.buffer === null ? [0] : [0, forecast.buffer];
  const low = Math.min(...balances, ...marks);
  const high = Math.max(...balances, ...marks);
  const span = high - low || 1;
  const x = (index: number) => PAD.left + (index * (WIDTH - PAD.left - PAD.right)) / (points.length - 1);
  const y = (amount: number) => PAD.top + ((high - amount) * (HEIGHT - PAD.top - PAD.bottom)) / span;
  const line = linePath(balances, x, y);
  const lowestIndex = points.findIndex((point) => point.date === forecast.lowest.date);
  const lastDate = points[points.length - 1]?.date ?? forecast.start.date;
  const axisLabel = (amount: Cents) => (
    <text x={PAD.left - 6} y={coordinate(y(amount)) + 4} textAnchor="end" className="chart-axis">
      {formatDollarsBriefly(cents(Math.round(amount / 100) * 100))}
    </text>
  );

  return (
    <section className="card" aria-labelledby="forecast-heading">
      <h2 id="forecast-heading">30-day Forecast</h2>
      <svg
        className="forecast-chart"
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        role="img"
        aria-labelledby="forecast-heading forecast-summary"
      >
        {axisLabel(cents(high))}
        <line x1={PAD.left} x2={WIDTH - PAD.right} y1={coordinate(y(0))} y2={coordinate(y(0))} className="chart-zero" />
        {axisLabel(cents(0))}
        {forecast.buffer !== null && (
          <g className="chart-buffer">
            <line x1={PAD.left} x2={WIDTH - PAD.right} y1={coordinate(y(forecast.buffer))} y2={coordinate(y(forecast.buffer))} />
            <text x={WIDTH - PAD.right} y={coordinate(y(forecast.buffer)) - 5} textAnchor="end">
              Buffer {formatDollarsBriefly(forecast.buffer)}
            </text>
          </g>
        )}
        <path d={line} className="chart-line" />
        <circle cx={coordinate(x(lowestIndex))} cy={coordinate(y(forecast.lowest.balance))} r={4} className="chart-lowest" />
        <text x={PAD.left} y={HEIGHT - 6} className="chart-axis">
          {formatLocalDate(forecast.start.date)}
        </text>
        <text x={WIDTH - PAD.right} y={HEIGHT - 6} textAnchor="end" className="chart-axis">
          {formatLocalDate(lastDate)}
        </text>
      </svg>
      <p id="forecast-summary">{summaryText(forecast)}</p>
      <p className="muted">
        Counts your paychecks, Scheduled bills, the sweeps your agent would make on its own, and a Daily allowance of{" "}
        {formatDollars(forecast.dailyAllowance)} for usual spending.
      </p>
    </section>
  );
}
