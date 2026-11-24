import { getAppBank } from "@/app-bank";
import type { ForecastFigures } from "@/bank";
import type { LocalDate } from "@/calendar";
import { cents, formatDollars, type Cents } from "@/money";
import { requireCustomer } from "@/session";
import { NavBar } from "../nav-bar";

export const dynamic = "force-dynamic";

/** A LocalDate is already in the bank's time zone, so it is formatted as a UTC date. */
const monthFormat = new Intl.DateTimeFormat("en-US", { month: "long", timeZone: "UTC" });

function monthName(month: LocalDate): string {
  return monthFormat.format(new Date(`${month}T12:00:00Z`));
}

/** How far On pace is from the Usual month, such as "$782.00 more than usual". */
function differenceFromUsual(onPace: Cents, usual: Cents): string {
  const difference = cents(onPace - usual);
  if (difference === 0) return "The same as usual";
  return `${formatDollars(cents(Math.abs(difference)))} ${difference > 0 ? "more" : "less"} than usual`;
}

/** A Category's change from usual, signed, such as "+$240.00", or "same". */
function signedDifference(onPace: Cents, usual: Cents): string {
  const difference = cents(onPace - usual);
  if (difference === 0) return "same";
  return `${difference > 0 ? "+" : "−"}${formatDollars(cents(Math.abs(difference)))}`;
}

/** A bar's width as a whole percent of the widest amount on the page. */
function widthOf(amount: Cents, widest: Cents): string {
  return `${widest === 0 ? 0 : Math.round((amount * 100) / widest)}%`;
}

function Stat({ id, label, children, note }: { id: string; label: string; children: React.ReactNode; note: string }) {
  return (
    <section className="card stat" aria-labelledby={id}>
      <h2 id={id} className="stat-label">
        {label}
      </h2>
      <p className="stat-value num">{children}</p>
      <p className="muted stat-note">{note}</p>
    </section>
  );
}

function Figures({ page }: { page: ForecastFigures }) {
  const month = monthName(page.month);
  const widest = cents(Math.max(...page.categories.flatMap((row) => [row.usualMonth, row.onPace])));
  return (
    <>
      <div className="stats">
        <Stat id="stat-income" label="Comes in each month" note="Your paychecks in a Usual month">
          {formatDollars(page.usualMonth.income)}
        </Stat>
        <Stat id="stat-usual" label="Usual spending" note={`Average of the last ${page.fullMonths === 1 ? "full month" : `${page.fullMonths} full months`}`}>
          {formatDollars(page.usualMonth.spending)}
        </Stat>
        <Stat id="stat-on-pace" label={`${month}, on pace for`} note={differenceFromUsual(page.onPace.spending, page.usualMonth.spending)}>
          <span className={page.onPace.spending > page.usualMonth.spending ? "over" : undefined}>
            {formatDollars(page.onPace.spending)}
          </span>
        </Stat>
        <Stat id="stat-left-to-save" label="Left to save" note={`In a Usual month, then at ${month}'s pace`}>
          {formatDollars(page.leftToSave.usualMonth)} <span className="then">→ {formatDollars(page.leftToSave.onPace)}</span>
        </Stat>
      </div>

      <section className="card">
        <div className="card-head">
          <h2>{month} compared with your Usual month</h2>
          <p className="muted">Grey bars are usual, colored bars are {month}&rsquo;s pace.</p>
        </div>
        <table className="categories" aria-label={`${month} compared with your Usual month`}>
          <thead>
            <tr>
              <th scope="col">Category</th>
              <th scope="col" className="num-col">
                Usual
              </th>
              <th scope="col" className="num-col">
                On pace
              </th>
            </tr>
          </thead>
          <tbody>
            {page.categories.map((row) => (
              <tr key={row.category}>
                <th scope="row">
                  {row.category}
                  <div className="category-bars" aria-hidden="true">
                    <div className="usual" style={{ width: widthOf(row.usualMonth, widest) }} />
                    <div
                      className={row.onPace > row.usualMonth ? "on-pace over" : "on-pace"}
                      style={{ width: widthOf(row.onPace, widest) }}
                    />
                  </div>
                </th>
                <td className="num num-col">{formatDollars(row.usualMonth)}</td>
                <td className="num num-col">
                  {formatDollars(row.onPace)}
                  <div className={`difference${row.onPace > row.usualMonth ? " over" : ""}`}>
                    {signedDifference(row.onPace, row.usualMonth)}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </>
  );
}

export default async function ForecastPage() {
  const customer = await requireCustomer();
  const page = getAppBank().readForecastPage(customer);
  return (
    <main className="page">
      <NavBar customerName={customer.name} current="forecast" />
      <header className="top">
        <div>
          <h1>Forecast</h1>
          <p className="muted">What comes in, what goes out, and where this month&rsquo;s pace leads.</p>
        </div>
      </header>

      {page.kind === "not_enough_history" ? (
        <section className="card">
          <h2>Not enough history yet</h2>
          <p className="muted">
            Your Usual month and this month&rsquo;s pace show here once you have a full calendar month of paychecks and
            spending.
          </p>
        </section>
      ) : (
        <Figures page={page} />
      )}
    </main>
  );
}
