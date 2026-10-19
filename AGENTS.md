# AGENTS.md — homebreweryWiki project rules

## Git workflow (per story)

- For every story/task card worked, **automatically create a feature branch**
  named `story/<card-id>` (e.g. `story/E1S1T1`, `story/E1S1`) off `main`
  before editing.
- Commit the work on that branch when the task is code-complete, with a
  concise message referencing the card ID.
- **Do not push or open pull requests unless explicitly asked.** Leave the
  branch local for human review; report branch name + commit hash + changed
  files.
- Never commit secrets. Stage only intended files.
- One branch per card; do not mix multiple cards on one branch.

This overrides the default "commit only when asked" posture for this project:
branches are created automatically per story, but commits/PRs still wait for
explicit go-ahead unless the user says otherwise.

## Target platform

MediaWiki 1.14.1 / PHP 5.2.12-2 (Suhosin-Patch 0.9.7). Extension code must
stay PHP 5.2 compatible: no namespaces, no closures, no short array syntax
(`[]`), no `__DIR__`, no late static binding, no `new Foo()->bar()`.

## Verification

Prefer verifying against a real MediaWiki 1.14.1 install when available
(see `.sandbox/install-1.14.md` for the working SQLite harness). Otherwise
syntax-check with `php -l` and state the caveat.

## Board workflow

Follow `.marv/TRELLO.md` (lists, runner rules, kill-word).
