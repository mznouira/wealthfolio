---
description: Capture a request as a reviewable spec
agent: planner
subtask: true
---

Turn the request below into a spec. Write it to `docs/specs/<slug>.md` (ask before writing), then summarize.

Request:
$ARGUMENTS

Recent commits:
!`git log --oneline -10`

Working tree:
!`git status --short`

Include: problem, scope (in / out), acceptance criteria, affected areas (frontend / tauri / server / crates / packages), test plan, risks, and open questions.
