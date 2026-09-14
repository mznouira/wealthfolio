---
description: Review changes for spec compliance and quality
agent: reviewer
subtask: true
---

Review the current diff.

Diff summary: !`git diff --stat`

Scope: $ARGUMENTS

Run the spec-compliance pass, then the quality pass. Report findings by severity
with file:line and a concrete fix.
