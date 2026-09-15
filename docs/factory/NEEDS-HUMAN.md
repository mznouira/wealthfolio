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

### 2026-09-15 — `zied/statements` branch, issue #3 (WP-3: Desjardins PDF parser)

Two wording/data assumptions in
`packages/statement-parsers/src/desjardins-pdf.ts` and `src/dates.ts` are built
from `docs/statements/NOTES.md` §S4 (a single real 2026-01 EOP statement,
owner-run 2026-09-14) but could not be re-verified this session — the real
sample was already gone before this session started (`ls statements/` → not
found). Full design record: `docs/specs/wp3-desjardins-pdf-parser.md` (W3-D9,
W3-D10).

1. **French month abbreviations beyond January are unverified.**
   `FRENCH_MONTH_ABBREVIATIONS` in `src/dates.ts` only has real confirmation for
   `JAN`; the other eleven (`FÉV`, `MAR`, `AVR`, `MAI`, `JUN`, `JUL`,
   `AOU`/`AOÛT`, `SEP`, `OCT`, `NOV`, `DEC`/`DÉC`) are the standard Québec
   3-letter scheme, invented rather than observed. **Command:** drop a real
   Desjardins statement from a month other than January into the gitignored
   `statements/` folder and load it in the dev probe (`/dev/statements-pdf`,
   MANUAL-TESTS.md WP-3 item 2). **Pass:** every transaction's date parses (no
   `invalid_date` problems). **Failure:** `invalid_date` problems appear — the
   message quotes the exact `D MON` text seen; update
   `FRENCH_MONTH_ABBREVIATIONS` to match and add a test fixture pinning it, per
   `dates.ts`'s existing "extend deliberately" discipline.

2. **The `SJ ###-#####-#` account-reference wording, and which part is "the
   folio", are unverified.** `ACCOUNT_REF_REGEX` in `desjardins-pdf.ts` masks
   the _whole_ matched reference to its last four characters rather than
   guessing which sub-group is the true folio (W3-D9) — deliberately
   conservative, but unverified this session. **Command:** same real-PDF probe
   run as item 1. **Pass:** every product's `accountRef` is non-null and ends in
   `-<PRODUCT>` (e.g. `-EOP`). **Failure:** `accountRef` is `null` for a product
   that should have one — the regex didn't match the real letterhead wording;
   capture the real wording (with digits redacted before sharing) and update
   `ACCOUNT_REF_REGEX` accordingly. Never paste the real reference itself here
   or into any commit.

---

---

## Cleared

(none yet)
