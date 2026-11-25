import { randomUUID } from "node:crypto";
import { DISPLAY_TIME_ZONE } from "@/app-clock";
import { getAppBank } from "@/app-bank";
import { formatDollars } from "@/money";
import { requireCustomer } from "@/session";
import { MERCHANTS } from "@/simulator";
import { NavBar } from "../nav-bar";
import { CardPurchaseForm, ClockControls, OutsideContactSharedCostForm } from "./simulator-forms";

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
  const outsideContacts = bank.listOutsideContactsInGroups(customer);
  const now = bank.clock.now();
  return (
    <main className="page">
      <NavBar customer={customer} current="simulator" />
      <header className="top">
        <div>
          <h1>Simulator</h1>
          <p className="muted">
            Testing only. Plays the employer, the billers, the merchants and Outside contacts. All money is imaginary.
          </p>
        </div>
      </header>

      <section className="card simulator" aria-labelledby="simulated-time">
        <h2 id="simulated-time">Simulated time</h2>
        <p className="amount small">
          <time dateTime={now.toISOString()}>{timeFormat.format(now)}</time> New York time
        </p>
        <p className="muted">
          &ldquo;Post paycheck&rdquo; posts paychecks due today. Advancing the clock posts every paycheck and
          Scheduled bill whose date it passes.
        </p>
        <ClockControls />
      </section>

      <section className="card simulator" aria-labelledby="card-purchase">
        <h2 id="card-purchase">Card purchase</h2>
        <p className="muted">Spend from one of {customer.name}&rsquo;s accounts at a simulated Merchant.</p>
        <CardPurchaseForm
          purchaseId={randomUUID()}
          merchants={Object.entries(MERCHANTS).map(([key, merchant]) => ({
            key,
            label: `${merchant.name} (${merchant.category})`,
          }))}
          accounts={accounts.map((account) => ({
            id: account.id,
            label: `${account.name} (${formatDollars(account.balance)})`,
          }))}
        />
      </section>

      {outsideContacts.length > 0 && (
        <section className="card simulator" aria-labelledby="outside-contact-shared-cost">
          <h2 id="outside-contact-shared-cost">Shared cost from an Outside contact</h2>
          <p className="muted">An Outside contact in one of your Groups adds a Shared cost they paid. No money moves.</p>
          <OutsideContactSharedCostForm
            members={outsideContacts.map((contact) => ({
              value: contact.key,
              label: `${contact.name} in ${contact.groupName}`,
            }))}
          />
        </section>
      )}
    </main>
  );
}
