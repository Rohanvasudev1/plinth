# Plinth

Plinth is a consumer bank web app built around one agent per customer. The agent acts only within rules the customer sets, and every action can be explained and undone. All money is imaginary. The product is described in `docs/product-brief.md`, and `prototypes/plinth-demo.html` is a clickable demo of the target experience.

## Hard rules

- Use imaginary money only. Never call a real bank, card, payment, brokerage or credit API. Every outside institution is a simulated adapter inside this repo.
- Store money as integer cents. Never use floating-point numbers for money.
- Every change to a balance is a pair of ledger entries that sum to zero, written with an idempotency key.
- An agent moves money only under a Rule or a Mandate the customer created. Every agent action writes a Decision log entry with its trigger, the rule it used, and the result.
- Agents report findings with options. They don't tell the customer what to do unless the customer's advice setting allows it.
- Seed data uses fictional people and companies only.
- Code that reads the current time or calls a language model does it through an interface, so tests can use a fixed clock and a fake model.

## Commands

- Install: `pnpm install`
- Dev server: `pnpm dev`, then open http://localhost:3000. The app's database is `data/plinth.db`, or the file named by `PLINTH_DB_PATH`.
- Missions run on the scripted fake model unless `ANTHROPIC_API_KEY` is set. With the key, the dev server runs them on the Anthropic SDK adapter, using the model named by `PLINTH_MODEL`, or `claude-opus-5-5` when it is unset. Unit tests and the end-to-end suite always use the fake.
- Typecheck: `pnpm typecheck`
- Unit tests: `pnpm test` (Vitest, `src/**/*.test.ts`). Run one file with `pnpm test src/money.test.ts`.
- End-to-end tests: `pnpm test:e2e` (Playwright, `e2e/`). It starts its own dev server on port 3100 with a fresh database and `PLINTH_E2E=1`. Every test calls `restoreSeed(page)` from `e2e/restore-seed.ts` first, which posts to the test-only `/e2e/reset` route to restore the seed and the simulated clock, so tests pass in any order. A test that needs a far-off date posts to `/e2e/clock` to set the simulated clock. Without `PLINTH_E2E=1`, or in a production build, both routes answer 404.
- New migration after editing `src/db/schema.ts`: `pnpm db:generate --name <change>`. Migrations in `drizzle/` apply automatically whenever a database opens.

If `pnpm typecheck` reports a missing module under `.next/`, delete `.next` and run it again. Next.js keeps type stubs for deleted routes there.

Tests get a fresh, migrated in-memory database from `openTestDatabase()` and a pinned time from `fixedClock()`. The app reads time from the simulated clock stored in the database (`getAppClock()`).

## Implementer sessions

An implementer session works one ticket:

1. Read the issue, its comments, and the comments on its parent spec. Review decisions are recorded there. If any issue blocking it is still open, stop and say which one.
2. Work on the branch this session created. Don't touch other tickets.
3. When `/code-review` passes, merge `origin/main` into the branch. Other sessions merge while you work. If both sides added a migration, regenerate yours with the next free number. Then push and open a pull request whose body starts with `Closes #<issue>`.
4. Comment on the issue with the pull request link.

## Where things live

- `src/bank.ts` is the domain API that pages and tests call.
- `src/customer-data.ts` is the only place that reads or writes customer-owned rows (ADR 0004).
- `src/simulator.ts` holds the simulated employer, billers and merchants.
- `CODING_STANDARDS.md` lists the judgement-call rules the reviewer applies. `src/hard-rules.test.ts` checks the mechanical rules.

## Agent skills

### Issue tracker

Issues live in GitHub Issues for `Rohanvasudev1/plinth`, reached through `gh api` REST calls. See `docs/agents/issue-tracker.md`.

### Triage labels

The five default labels: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `GLOSSARY.md` and `docs/adr/` at the repo root. See `docs/agents/domain.md`.
