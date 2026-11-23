import { randomUUID } from "node:crypto";
import Link from "next/link";
import { DISPLAY_TIME_ZONE } from "@/app-clock";
import { getAppBank } from "@/app-bank";
import { formatDollars } from "@/money";
import { requireCustomer } from "@/session";
import { CardPurchaseForm, ClockControls } from "./simulator-forms";

export const dynamic = "force-dynamic";

const timeFormat = new Intl.DateTimeFormat("en-GB", {
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
  timeZone: DISPLAY_TIME_ZONE,
});

export default async function SimulatorPage() {
  const customer = await requireCustomer();
  const bank = getAppBank();
  const accounts = bank.customerData.listAccounts(customer);
  const now = bank.clock.now();
  return (
    <main className="page">
      <header className="top">
        <div>
          <h1>Simulator</h1>
          <p className="muted">Testing only. Plays the employer and the merchants. All money is imaginary.</p>
        </div>
        <p className="muted signed-in">
          {customer.name} · <Link href="/">Home</Link>
        </p>
      </header>

      <section className="card simulator" aria-labelledby="simulated-time">
        <h2 id="simulated-time">Simulated time</h2>
        <p className="amount small">
          <time dateTime={now.toISOString()}>{timeFormat.format(now)}</time> New York time
        </p>
        <p className="muted">
          &ldquo;Post paycheck&rdquo; posts paychecks due today. Advancing the clock posts every paycheck whose date
          it passes.
        </p>
        <ClockControls />
      </section>

      <section className="card simulator" aria-labelledby="card-purchase">
        <h2 id="card-purchase">Card purchase</h2>
        <p className="muted">Spend from one of {customer.name}&rsquo;s accounts at a simulated merchant.</p>
        <CardPurchaseForm
          purchaseId={randomUUID()}
          accounts={accounts.map((account) => ({
            id: account.id,
            label: `${account.name} (${formatDollars(account.balance)})`,
          }))}
        />
      </section>
    </main>
  );
}
