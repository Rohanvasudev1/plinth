import Link from "next/link";
import { getAppBank } from "@/app-bank";
import { ACCESS_READER_TEXT } from "@/access-log-text";
import type { AccessLogEntry } from "@/bank";
import { DATA_CHOICE_KEYS, type DataChoice } from "@/settings";
import { DATA_CHOICE_TEXT } from "@/settings-text";
import { requireCustomer } from "@/session";
import { NavBar } from "../nav-bar";
import { entryTimeFormat } from "../time-format";
import { DataChoiceSwitch } from "./privacy-forms";

export const dynamic = "force-dynamic";


/** A note on what a Data choice means today, where the card's intro doesn't say. */
const DATA_CHOICE_DETAIL: Partial<Record<DataChoice, string>> = {
  keepChatHistory: "Applies once Ask Plinth exists. There is no chat to keep yet.",
};

function AccessLogItem({ entry }: { entry: AccessLogEntry }) {
  return (
    <li className="access-entry">
      <p>
        <strong>{ACCESS_READER_TEXT[entry.who]}</strong> · <time dateTime={entry.at.toISOString()}>{entryTimeFormat.format(entry.at)}</time>
      </p>
      <dl className="access-detail">
        <div>
          <dt>What</dt>
          <dd>{entry.what}</dd>
        </div>
        <div>
          <dt>Why</dt>
          <dd>{entry.why}</dd>
        </div>
      </dl>
    </li>
  );
}

export default async function PrivacyPage() {
  const customer = await requireCustomer();
  const { dataChoices, accessLog } = getAppBank().readPrivacy(customer);

  return (
    <main className="page">
      <NavBar customer={customer} current="privacy" />
      <header className="top">
        <div>
          <h1>Privacy</h1>
          <p className="muted">Your Data choices, and every time anything other than you read your data.</p>
        </div>
      </header>

      <section className="card" aria-labelledby="data-choices">
        <h2 id="data-choices">Data choices</h2>
        <p className="muted">
          Plinth doesn&rsquo;t train models on your data or share it with partners today. These record what you&rsquo;d
          allow. Each change is kept in the Decision log.
        </p>
        <ul className="rules">
          {DATA_CHOICE_KEYS.map((choice) => (
            <li key={choice} className="rule">
              <div>
                <b>{DATA_CHOICE_TEXT[choice]}</b>
                {DATA_CHOICE_DETAIL[choice] && <p className="muted">{DATA_CHOICE_DETAIL[choice]}</p>}
              </div>
              {dataChoices ? (
                <DataChoiceSwitch choice={choice} on={dataChoices[choice]} label={DATA_CHOICE_TEXT[choice]} />
              ) : (
                <span className="muted">Off</span>
              )}
            </li>
          ))}
        </ul>
        {!dataChoices && (
          <p>
            You haven&rsquo;t finished setup, so each choice is off. <Link href="/setup">Set them in the Setup survey</Link>
          </p>
        )}
      </section>

      <section className="card" aria-labelledby="access-log">
        <h2 id="access-log">Access log</h2>
        <p className="muted">
          Who read your data, what and why, newest first. Your own page views aren&rsquo;t listed. Nothing is ever removed.
        </p>
        {accessLog.length === 0 ? (
          <p className="muted">Nothing has read your data yet.</p>
        ) : (
          <ol className="access-log">
            {accessLog.map((entry) => (
              <AccessLogItem key={entry.id} entry={entry} />
            ))}
          </ol>
        )}
      </section>

      <section className="card" aria-labelledby="export">
        <h2 id="export">Export</h2>
        <p className="muted">
          One JSON file of everything Plinth holds about you: accounts, Linked accounts, transactions, the Decision log,
          Findings, Missions, settings, Rules, Goals and this access log. Each Export is added to the access log.
        </p>
        <form method="post" action="/privacy/export">
          <button type="submit" className="button">
            Export my data
          </button>
        </form>
      </section>

      <section className="card" aria-labelledby="close-and-delete">
        <h2 id="close-and-delete">Close and delete</h2>
        <p className="muted">
          Pay out your balances, delete your working data and stop signing in. You&rsquo;ll see what Plinth keeps and
          deletes before anything happens.
        </p>
        <Link href="/privacy/close" className="button danger">
          Close and delete
        </Link>
      </section>
    </main>
  );
}
