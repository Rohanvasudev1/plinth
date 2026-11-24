import Link from "next/link";
import { getAppBank } from "@/app-bank";
import { PROVIDER_NOTICE } from "@/mission-text";
import { MAX_QUESTION_LENGTH, SUGGESTED_QUESTIONS } from "@/missions";
import { requireCustomer } from "@/session";
import { ADVICE_SETTING_TEXT } from "@/settings-text";
import { FindingCard } from "../finding-card";
import { NavBar } from "../nav-bar";
import { QuestionBox, RefreshWhileRunning } from "./mission-controls";

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

      <QuestionBox
        suggestedQuestions={SUGGESTED_QUESTIONS}
        providerNotice={PROVIDER_NOTICE}
        maxLength={MAX_QUESTION_LENGTH}
      />

      {page.runningMissions.length > 0 && (
        <section className="card" aria-labelledby="in-progress">
          <h2 id="in-progress">In progress</h2>
          <ul className="missions">
            {page.runningMissions.map((mission) => (
              <li key={mission.id} className="mission">
                <b>{mission.question}</b>
                <span className="muted" role="status">
                  {mission.progressLabel}…
                </span>
              </li>
            ))}
          </ul>
          <RefreshWhileRunning everyMs={2000} />
        </section>
      )}

      {page.findings.length === 0 ? (
        <p className="card muted">Your agent hasn&rsquo;t found anything yet.</p>
      ) : (
        page.findings.map((finding) => <FindingCard key={finding.id} finding={finding} accountName={accountName} />)
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
