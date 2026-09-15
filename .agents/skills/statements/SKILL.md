---
name: statements
description: >
  Work on the statements feature in this Wealthfolio fork — parsing the owner's
  Desjardins and CIBC PDF statements, reconciling them, and importing them into
  Wealthfolio's Spending module. Use at the start of any statements work package,
  when asked to continue the statements work, when implementing a PDF parser or
  importer, or when touching packages/statement-parsers or
  apps/frontend/src/features/statements.
---

# statements (Wealthfolio fork)

Do not start from code. Read these first, in order:

1. `docs/statements/PLAN.md` — the canonical plan, locked decisions, work-package
   table, and session log. The session log's "Next" line is where to resume.
2. `docs/statements/AGENTS.md` — the fork protocol: rebase onto `upstream/main`,
   privacy rules, gates.
3. `docs/statements/CONTEXT.md` — the vocabulary (statement, statement line,
   activity, expense, account key, reconciliation, transfer pair).

Then:

- Confirm the current branch is `zied/statements` and it is rebased on a recent
  `upstream/main` (`git fetch upstream && git log --oneline upstream/main -1`).
- Pick the next work package from the plan's table. One work package per session,
  one commit series.
- Keep new code in `packages/statement-parsers/` and
  `apps/frontend/src/features/statements/`; keep edits to upstream files minimal
  and scoped so a rebase stays cheap.
- Run the gates in `docs/statements/AGENTS.md` §3 before calling a work package
  done, and append a dated section to `docs/statements/MANUAL-TESTS.md` for
  anything CI cannot reach.
- Update `PLAN.md`'s work-package table and session log before finishing.

Never commit a real statement, account number, or balance; derive synthetic
fixtures and delete the real file.
