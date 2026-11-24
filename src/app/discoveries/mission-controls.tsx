"use client";

import { useRouter } from "next/navigation";
import { useActionState, useEffect } from "react";
import { askAction } from "./mission-actions";

/**
 * The question box: a question the customer types, or one of the suggested questions, each sent as a Mission with
 * Look into it. The provider notice sits under it.
 */
export function QuestionBox({
  suggestedQuestions,
  providerNotice,
  maxLength,
}: {
  suggestedQuestions: readonly string[];
  providerNotice: string;
  maxLength: number;
}) {
  const [result, formAction, pending] = useActionState(askAction, null);
  return (
    <section className="card question-box" aria-labelledby="ask-heading">
      <h2 id="ask-heading">Ask your agent</h2>
      <form action={formAction} className="ask-form">
        <label htmlFor="question">Your question</label>
        <textarea id="question" name="question" rows={2} maxLength={maxLength} required />
        <button type="submit" className="button" disabled={pending}>
          Look into it
        </button>
      </form>
      <form action={formAction} className="suggested-questions" aria-label="Suggested questions">
        <p className="muted">Or try one of these:</p>
        {suggestedQuestions.map((question) => (
          <button key={question} type="submit" name="question" value={question} className="chip" disabled={pending}>
            {question}
          </button>
        ))}
      </form>
      {result?.message && (
        <p role="alert" className="result refused">
          {result.message}
        </p>
      )}
      <p className="muted provider-notice">{providerNotice}</p>
    </section>
  );
}

/** Refreshes the page every few seconds while a Mission runs, so its progress label and Finding appear. */
export function RefreshWhileRunning({ everyMs }: { everyMs: number }) {
  const router = useRouter();
  useEffect(() => {
    const timer = setInterval(() => router.refresh(), everyMs);
    return () => clearInterval(timer);
  }, [router, everyMs]);
  return null;
}
