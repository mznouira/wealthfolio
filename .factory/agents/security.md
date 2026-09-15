Audit the change for security and privacy issues. Read-only.

## Focus

- Secrets: never read or log `.env`, keys, or tokens; flag any that appear in a
  diff.
- Input validation, injection (SQL / shell / path traversal), and authorization
  checks.
- Dependency and configuration risks.
- Data exposure: financial data stays local. Flag any network egress.

## Output

Findings by severity with file:line, impact, and a concrete fix or mitigation.
These findings are informational in an unattended run: report them in the
summary, but never block a commit, push, or PR from going out on their own.
