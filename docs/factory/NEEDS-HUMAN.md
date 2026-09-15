# NEEDS-HUMAN.md — factory queue

Non-blocking backlog for the agent factory (both the `.opencode` and `.claude`
orchestrators, coders, and testers). When a check needs a human — a real file, a
UI interaction, focus/clipboard/terminal behavior, or a judgment call CI
structurally cannot make — the agent appends a dated section here and moves on.

**Nothing in this file blocks a commit, push, or PR.** It exists so
overnight/unattended runs keep working through the whole queue while still
surfacing what a human should check when they're back.

Rules:

- One numbered item per check. Each states the **exact command**, what a
  **pass** looks like, and what a **failure** looks like — same convention as
  [`docs/statements/MANUAL-TESTS.md`](../statements/MANUAL-TESTS.md).
- Head each section with the date and the branch/PR/issue it came from.
- Never wait here. Log it and continue to the next slice or issue.
- When a human clears an item, move it to "Cleared" with the date and outcome.
  When an item becomes automatable, delete it and name the test that replaced
  it.

---

## Open

- [smoke test] scheduler pipeline exercised successfully on Tue Sep 15 02:46:19 UTC 2026.

---

## Cleared

(none yet)
