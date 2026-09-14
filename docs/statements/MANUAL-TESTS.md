# MANUAL-TESTS.md — statements

Manual checks for the statements feature. Append a dated section per work
package, covering **only what the gates structurally cannot reach**. Do not
re-list what `pnpm test` already asserts.

Rules:

- One numbered item per check. Each states three things: the **exact command**,
  what a **pass** looks like, and what **failure** looks like.
- "Verify it renders correctly" is not an item.
- Order by risk, not by feature. Say plainly when a known past failure makes an
  item likely.
- If a change can capture a terminal, screen, or focus, the **first** item is
  how to leave it and how to recover if leaving fails.
- When a manual item later becomes automatable, delete it and name the test that
  replaced it.

---

## WP-0 — fork bootstrap

No manual tests. Bootstrap is verified by `git remote -v`, the current branch,
and a green `pnpm install`.

---

<!-- Add new sections below, most recent first. -->
