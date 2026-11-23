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

The scaffolding ticket fills this section in with the install, dev, typecheck, test and end-to-end test commands.

## Implementer sessions

A session that starts with `/implement #<issue>` works that one ticket:

1. Read the issue. If any issue in its "Blocked by" list is still open, stop and say which one.
2. Work on the branch this session created. Don't touch other tickets.
3. When `/code-review` passes, push the branch and open a pull request whose body starts with `Closes #<issue>`.
4. Comment on the issue with the pull request link.

## Agent skills

### Issue tracker

Issues live in GitHub Issues for `Rohanvasudev1/plinth`, reached through `gh api` REST calls. See `docs/agents/issue-tracker.md`.

### Triage labels

The five default labels: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `GLOSSARY.md` and `docs/adr/` at the repo root. See `docs/agents/domain.md`.
