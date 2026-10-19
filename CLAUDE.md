# CLAUDE.md

This repo is a spec-driven project. The specs are the source of truth.

## Read before any work
- `specs/constitution.md`: non-negotiable rules. If a task conflicts with it, stop and tell me.
- `specs/spec.md`: what we're building (user stories, acceptance criteria).
- `specs/plan.md`: how (stack, data model, sync protocol, folder layout).
- `specs/tasks.md`: ordered task list. Work on ONE task at a time, the one I name.

## How to work a task
1. Restate the task and the acceptance criteria it touches. List the files you plan to create/change. Wait for my OK.
2. Implement only that task. Don't start the next one, don't refactor unrelated code.
3. Write/update tests for it. Run lint, type-check and tests; fix until green.
4. Don't tick the checkbox; state in the PR that the task is done.
5. Summarize: what changed, how to verify it manually, anything you had to assume.

## If the spec is wrong or unclear
Don't guess silently. Stop and ask, or propose a spec change. Spec changes go into `specs/` in the same commit as the code that needs them.

## Conventions
- Code, comments, commits, tests: English. All user-facing text: Spanish (Costa Rica, "usted"), via i18n keys, never hardcoded.
- TypeScript strict; Python with type hints + mypy.
- Money is integer minor units. Never floats.
- Conventional commits (`feat:`, `fix:`, `test:`, `docs:`, `chore:`), one task per commit/PR, task ID in the message (e.g. `feat(payments): T1.8b payment status helpers`).
- Never commit secrets (`.env` is gitignored; update `.env.example`).
- Never put real client data in tests, fixtures, screenshots or seed files.

## Git workflow
- `main` is the default branch and always works. It is protected (admins included): no direct pushes, and every change, including spec-only and docs edits, goes through a branch and a PR whose `web` and `api` CI checks pass.
- The required checks on `main` are the `web` and `api` jobs in `.github/workflows/ci.yml`. Renaming either job (or adding new required jobs) means updating the branch protection rule for `main` too, or merges will wait on a check that never runs.
- For each task: create a branch `t<id>-<short-name>` from `main` (e.g. `t1.8b-payment-status`), do the work, commit there, push, open a PR. Mariano reviews and merges.
- Commit at the end of the task, once tests are green. Don't merge, don't push to `main`.
- License: MIT.
- When Mariano replies “approved” to a finished task, merge its branch into main (via gh pr merge --merge if a PR exists), delete the branch, pull main, then branch for the next task.

## Parallel work
Other agents may be working in other worktrees at the same time. Only touch files your task needs. Don’t tick checkboxes in specs/tasks.md; say in the PR that the task is done, and Mariano ticks them after merging. Keep plan.md edits minimal and in the section your task owns. Before opening a PR, rebase on the latest main and resolve any conflicts.

## Commands
(fill in as the project grows)
- web: `cd web && npm run dev | npm test | npm run lint | npm run typecheck`
- api: `cd api && pytest | mypy . | ruff check .`
- api commands run inside the uv-managed venv: prefix them with `uv run` (e.g. `uv run pytest`), after `uv sync` once.
