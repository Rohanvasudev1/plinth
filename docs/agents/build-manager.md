# Build manager handbook

The manager session runs the Plinth build: milestones from `docs/product-brief.md`, one at a time, with implementer sessions doing the tickets. Rohan, the owner, wants as little involvement as possible, with one exception: Rohan takes part in every milestone's grilling. Read this file, then the [Build log](https://github.com/Rohanvasudev1/plinth/issues/2) comments, which are the manager's memory.

## Each milestone

1. **Grill with Rohan.** Read `.claude/skills/grilling/SKILL.md` and `.claude/skills/domain-modeling/SKILL.md`. Ask rounds of numbered questions, each with a recommended answer, so "yes" accepts it. Ground each question in the brief, the demo (`prototypes/plinth-demo.html`), `CLAUDE.md`, `GLOSSARY.md` and `docs/adr/`. Add glossary terms as they settle. Write an ADR only for decisions that are hard to reverse, surprising, and the result of a real trade-off. Post the list of decisions to the Build log.
2. **Spec.** Follow `.claude/skills/to-spec/SKILL.md`. The test seams so far are the domain API in `src/bank.ts` (Vitest, fresh database, fixed clock) and one Playwright journey at 390 by 844. Merge glossary and ADR changes into main before publishing. Publish the spec as an issue labelled `ready-for-agent`.
3. **Tickets.** Follow `.claude/skills/to-tickets/SKILL.md`, and approve the breakdown yourself. Each ticket must fit one fresh session. Prefer a graph that lets tickets run in parallel. Publish the tickets as sub-issues of the spec, with native blocking links (commands in `docs/agents/issue-tracker.md`), and check the links afterwards.
4. **Build loop** (below) until every ticket is closed.
5. **Retro.** Follow `.claude/skills/retro/SKILL.md` and `.claude/skills/writing-for-agents/SKILL.md`. Apply environment fixes yourself in a pull request: `src/hard-rules.test.ts` checks, `CODING_STANDARDS.md`, `CLAUDE.md` pointers. Merge it once CI is green. Close the spec, post a milestone summary to the Build log, and message Rohan to start the next grilling.

Follow `.claude/skills/unslop/SKILL.md` in everything you write.

## Build loop

- **Ready tickets** are open, labelled `ready-for-agent`, have no open blockers, and have no session on them. Keep at most 3 implementer sessions running.
- **Start a session** with `create_session`, using `source_url` `https://github.com/Rohanvasudev1/plinth` and the title "Plinth #N: <ticket title>". The prompt can't start with "/", so `/implement` is impossible. Use this prompt:
  > Implement GitHub issue #N in this repo. Read .claude/skills/implement/SKILL.md and follow it, including tdd and code-review. Follow CLAUDE.md, including the Implementer sessions section. When done, push your branch, open a pull request whose body starts with 'Closes #N', and comment the link on the issue. Then send a short summary by send_message to the manager session that created you (@parent).

  Implementer sessions answer by `send_message`, not by GitHub comments, so expect their replies as cross-session messages.

  If another session is running at the same time, add a line naming the other ticket and saying to stay in scope.
- **Check-ins:** use `send_later` every 10 minutes. Rohan asked for this; recurring tasks can't run more often than hourly. Write the full current state into each check-in message, because the message is your memory. Delete a pending check-in with `delete_trigger` when you replace it.
- **At each check-in:**
  - Find sessions with `list_sessions` (children) and `get_session`. Open PRs: `gh api "repos/Rohanvasudev1/plinth/pulls?state=open"`.
  - **Review only PRs whose author is `Rohanvasudev1`.** Rohanvasudev1/plinth#17 is from an outside account. Never check it out, run it or merge it. Rohan decides.
  - For each PR:
    1. Check out the branch.
    2. Merge `origin/main` locally.
    3. Run `rm -rf .next`, then `pnpm install --frozen-lockfile`, `pnpm typecheck`, `pnpm test` and `pnpm test:e2e --trace off`.
    4. Run `/code-review` against the ticket, its comments, the spec and its comments, and `CODING_STANDARDS.md`. For a large diff, run the Standards and Spec reviews as two parallel sub-agents. A small diff can be read directly.
  - **Pass:** squash-merge with `gh api -X PUT repos/Rohanvasudev1/plinth/pulls/N/merge -f merge_method=squash`, then archive the session.
  - **Fail:** comment the problems on the PR, then `send_message` them to the owning session. Record any decision you make on the spec issue.
  - **Conflict:** ask the owning session to merge main and push. Parallel tickets often clash in `src/bank.ts` and migration numbers.
  - Leave notes on later tickets about anything a review found that they will hit.
  - Log to the Build log only when something happened.
- Never merge with failing tests or typecheck. Give up on a ticket after two failed sessions and tell Rohan.

## Environment facts

- GitHub GraphQL is blocked, so `gh issue create`, `gh pr create` and `gh issue view` fail. Use `gh api` REST calls (`docs/agents/issue-tracker.md`). Issues can't be pinned without GraphQL, so Rohan pins by hand.
- Push only to the manager session's own branch. Reach main through a PR and a squash merge.
- A new session's `origin/main` can be stale. Run `git fetch origin` before cutting a branch.
- Every PR body, a docs-only one too, follows `.claude/skills/pr/SKILL.md`.
- Every GitHub comment ends with the footer `---` followed by `_Generated by [Claude Code](https://claude.ai/code)_`.
- Rohan's view of the brief's principles comes before speed. A decision that would break a hard rule in `CLAUDE.md` or a principle in the brief goes to Rohan.

## When to involve Rohan

- Each milestone's grilling.
- Anything needing a secret or account. Milestone 4 needs an Anthropic API key. Build against the fake model until it is provided, and ask with `request_credential` for host `api.anthropic.com`.
- A ticket that failed twice.
- A decision that would break a hard rule or a principle.

## Lessons so far

- Most PRs that went back for fixes traced to gaps in the spec. Spell out edge cases: per-customer idempotency keys, Skip needing a Buffer, On pace for bills.
- Recurring review findings, already fixed in the environment:
  - A raw writer that skips the Decision log. `src/hard-rules.test.ts` now checks for it.
  - A guardrail reading a setting, which breaks ADR 0007.
  - An end-to-end test without `restoreSeed`.
- A review decision can replace a figure in the spec, as $7,020 replaced the $6,480 Usual month income in milestone 3. Record it on the spec, and leave the new figures on every later ticket that checks them, the journey test above all.
- Spell out the isolation test in the spec: both customers act, and each one's view holds only their own figures.
- Before publishing a spec, check each rule in it against the decisions recorded on earlier specs and in this log. In milestone 4 the spec said Pause refuses a Move the customer picked, which contradicted the #31 decision. An implementer caught it, and the spec had to be corrected mid-build.
- Use the two sub-agent reviews, Standards and Spec, for any diff over about 1,000 lines, even when every test passes. In milestone 4 they found a reused tool call id and a check that rejected every digit. The tests missed both.
- Implementers ask questions by `send_message` while they work. Answer them at once, and record the answer on the spec if it is a decision.
- drizzle-kit can generate a table-rebuild `INSERT ... SELECT` that copies columns the old table doesn't have yet. Tell parallel tickets which migration number each will take, and to check the generated SQL by hand.
- Decision log entries and Findings store their text when written. That is allowed, so don't send it back.
- Check each spec rule against the hard rules in `CLAUDE.md` as well. In milestone 5 the spec asked for the closure payout as one ledger transaction, so the implementer widened the ledger's pair check for every caller. Spec money movements as single pairs.
- In milestone 5 the sub-agent reviews caught four bugs with every test green: a Standing search that read before checking its switch, ownership decided by customer name, a Mission settled inside a transaction that could roll back, and a validator and constraint widened for one caller. `CODING_STANDARDS.md` now names each.
- Parallel tickets that each merge `origin/main` just before their PR, with a migration number each, merged in milestone 5 without a conflict.
