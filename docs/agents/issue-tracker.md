# Issue tracker: GitHub

Issues and specs for this repo live as GitHub issues in `Rohanvasudev1/plinth`.

Cloud sessions can't reach GitHub GraphQL, so `gh issue create`, `gh issue view`, `gh issue list`, `gh pr create` and `gh repo view` fail with HTTP 403. Use `gh api` with REST routes instead. The commands below all work from a cloud session.

## Conventions

Set `R=repos/Rohanvasudev1/plinth` first.

- **Create an issue**: `gh api $R/issues -f title='...' -f body="$(cat body.md)" -f 'labels[]=ready-for-agent'`. Write multi-line bodies to a file first.
- **Read an issue**: `gh api $R/issues/<n> --jq '{number,title,state,body,labels:[.labels[].name]}'`, then `gh api $R/issues/<n>/comments --jq '.[].body'`.
- **List issues**: `gh api "$R/issues?state=open&labels=ready-for-agent&per_page=100" --jq '.[] | select(.pull_request|not) | {number,title}'`. The issues route also returns pull requests, so filter them out.
- **Make an issue a sub-issue of a parent**: `gh api -X POST $R/issues/<parent>/sub_issues -F sub_issue_id=<child-db-id>`, where the database id comes from `gh api $R/issues/<child> --jq .id`.
- **Blocking**: use GitHub's native issue dependencies. Add an edge with `gh api -X POST $R/issues/<child>/dependencies/blocked_by -F issue_id=<blocker-db-id>`. The database id is `gh api $R/issues/<blocker> --jq .id`, not the issue number. A ticket is unblocked when every blocker is closed.
- **List blockers**: `gh api $R/issues/<n>/dependencies/blocked_by --jq '.[] | {number,state}'`.
- **Count open blockers**: `gh api $R/issues/<n> --jq .issue_dependencies_summary.blocked_by`. A result of 0 means the ticket can start.
- **Comment on an issue**: `gh api $R/issues/<n>/comments -f body='...'`.
- **Apply or remove labels**: `gh api $R/issues/<n>/labels -f 'labels[]=...'` and `gh api -X DELETE $R/issues/<n>/labels/<name>`.
- **Close**: post the explanation as a comment, then `gh api -X PATCH $R/issues/<n> -f state=closed -f state_reason=completed`.
- **Open a pull request**: push the branch, then `gh api $R/pulls -f title='...' -f head='<branch>' -f base=main -f body="$(cat body.md)"`.

File issues only into `Rohanvasudev1/plinth`. Never file into `mattpocock/skills`.

## Pull requests as a triage surface

**PRs as a request surface: no.** _(Set to `yes` if this repo treats external PRs as feature requests; `/triage` reads this flag.)_

## When a skill says "publish to the issue tracker"

Create a GitHub issue.

## When a skill says "fetch the relevant ticket"

Read it as in **Read an issue** above.
