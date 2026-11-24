import Link from "next/link";
import { getAppBank } from "@/app-bank";
import { requireCustomer } from "@/session";
import { ADVICE_SETTING_TEXT, STANDING_SEARCH_TEXT } from "@/settings-text";
import { StandingSearchSwitch } from "../agent-action-controls";
import { FindingCard } from "../finding-card";
import { NavBar } from "../nav-bar";

export const dynamic = "force-dynamic";

export default async function DiscoveriesPage() {
  const customer = await requireCustomer();
  const bank = getAppBank();
  const page = bank.readDiscoveries(customer);
  const accounts = bank.customerData.listAccounts(customer);
  const accountName = (accountId: number) => accounts.find((account) => account.id === accountId)?.name ?? "an account";
  return (
    <main className="page narrow">
      <NavBar customer={customer} current="discoveries" />
      <header className="top">
        <div>
          <h1>Discoveries</h1>
          <p className="muted">
            Your agent reports back with facts and Options. Nothing changes unless you choose.
          </p>
        </div>
      </header>

      {page.findings.length === 0 ? (
        <p className="card muted">Your agent hasn&rsquo;t found anything yet.</p>
      ) : (
        page.findings.map((finding) => <FindingCard key={finding.id} finding={finding} accountName={accountName} />)
      )}

      {page.standingSearches.length > 0 && (
        <section className="card" aria-labelledby="standing-searches">
          <h2 id="standing-searches">Standing searches</h2>
          <p className="muted">Your agent runs these by itself as new data arrives.</p>
          <ul className="rules">
            {page.standingSearches.map(({ search, on }) => (
              <li key={search} className="rule">
                <div>
                  <b>{STANDING_SEARCH_TEXT[search].name}</b>
                  <p className="muted">{STANDING_SEARCH_TEXT[search].description}</p>
                </div>
                <StandingSearchSwitch search={search} on={on} label={STANDING_SEARCH_TEXT[search].name} />
              </li>
            ))}
          </ul>
        </section>
      )}

      {page.adviceSetting && (
        <section className="card" aria-labelledby="advice-setting">
          <h2 id="advice-setting">Advice setting</h2>
          <p>{ADVICE_SETTING_TEXT[page.adviceSetting]}</p>
          <p className="muted">
            Change it when you <Link href="/setup">run setup again</Link>.
          </p>
        </section>
      )}
    </main>
  );
}
