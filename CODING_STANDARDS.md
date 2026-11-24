# Coding standards

The reviewer applies these during `/code-review`. The hard rules in `CLAUDE.md` come first. `src/hard-rules.test.ts` checks the mechanical ones, so this file holds the judgement calls.

## Agent actions

- Every path through an agent action ends in a Decision log entry or in "no action taken". A guard that stops an action halfway, for example a missing or unowned account, writes a Refused entry naming the guardrail.
- Decision log entries name only the customer's own accounts.

## Domain language

- A new domain concept gets a `GLOSSARY.md` entry in the same pull request. Code, copy and test names use the glossary term, never a word listed under its _Avoid_.
- Error types match their module. A check on Rules or Scheduled bills throws that module's error, not `LedgerError`.

## Shapes

- A status with several values, such as Done, Refused or Reversed, is worked out in one function that every page and module calls. Pages don't re-derive it from raw fields.
- Display text lives in pages and in `*-text.ts` formatter modules. One exception: a Decision log entry or a Finding stores its action, trigger and Why text when it is written, so the record shows what the customer was told at the time. Build that text with a formatter, not inline.
- A customer change, such as a Rule, a setting, a Goal target or Pause, goes through its change module (`rule-changes.ts`, `settings-changes.ts`, `goal-changes.ts`, `pause.ts` or `setup.ts`), which writes the Decision log entry in the same transaction. `src/hard-rules.test.ts` checks this.
- Ids that are easy to swap get a branded type, as `Cents` and `LocalDate` already do.

## Tests

- Each end-to-end test sets up the state it needs and doesn't depend on another test running first.
- A test that one customer can't see another's data gives both customers data of their own, then reads each customer's view and checks it holds only their own figures. Checking that one customer's view doesn't change when the other acts is not enough.
- An idempotency key names everything that makes the movement unique for that customer: `payroll:<employer>:<pay date>`, `bill:<bill id>:<due date>`, `sweep:<ledger event id>`, `finding:<finding id>`, `undo:<decision id>`.
