# CONTEXT.md — statements glossary

The shared language for the statements feature in this fork. This file is a
**glossary only**: no implementation details, no specs, no scratch pad.

## Terms

- **Statement** — a PDF account statement published by an institution (the
  owner's banks label it a _relevé_; the code and docs call it a statement). One
  file may describe more than one account or product.

- **Statement line** — a single dated row within a statement: a description, an
  amount and (usually) a running balance. A statement line is not yet an
  activity.

- **Account key** — the statement's own name for the account, masked to the last
  four digits: for Desjardins, the folio plus product code; for a card, the
  card's last four digits. It is mapped to exactly one Wealthfolio account.

- **Product / section** — a subdivision of one statement that carries its own
  balance chain (for example a chequing section versus a savings section on one
  Desjardins statement). Each product reconciles independently.

- **Activity** — Wealthfolio's atomic record of a money or asset movement. The
  unit this feature creates.

- **Expense** — an activity of type `WITHDRAWAL` that has been assigned to the
  `expense` taxonomy. It is not a distinct activity type.

- **Income** — money in, represented as a `DEPOSIT` (or `CREDIT`) and assigned
  to the `income` taxonomy.

- **Transfer pair** — two activities that move money between two accounts the
  owner owns: a `TRANSFER_OUT` on the source and a `TRANSFER_IN` on the
  destination. A credit-card payment is a transfer pair, never an expense.

- **Reconciliation** — the assertion that a statement's parsed lines are
  trustworthy: the opening balance plus the signed sum of its lines equals the
  closing balance printed on the statement. A statement that does not reconcile
  is not imported.

- **Import hash** — a deterministic fingerprint of a statement line's content,
  used to recognise the same line across two downloads of the same statement so
  a re-import creates no duplicate. It is a property of the transaction, never
  of the file or the download.

- **Idempotency key** — the value Wealthfolio stores to enforce that an import
  hash is inserted at most once.

- **Source** — one institution's parser, behind a single seam. Adding an
  institution adds a source; it does not change the seam.

- **Statement source (the seam)** — the interface that reads bytes and yields
  validated statement lines plus per-line problems. It does not hash, classify,
  or touch the database.
