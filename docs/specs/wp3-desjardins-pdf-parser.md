---

# WP-3 Spec — Desjardins deposit statement parser + reconciliation

Status: **implemented**. Scope source: `docs/statements/PLAN.md` §3 (D3-D5, D7),
§4, §5 WP-3/WP-4; `docs/statements/NOTES.md` S1-S4;
`docs/specs/wp2-pdf-positioned-text.md` (the `./pdf` layer this builds on).
Real-sample geometry: NOTES §S4 (2026-01 EOP, owner-run 2026-09-14). The sample
file itself is gone before this session started (`ls statements/` → not found) —
everything below is derived from the S4 notes, not from a fresh read of the
file.

## 1. Goal

A Desjardins deposit-statement PDF parser on top of the WP-2 `./pdf` layer:
`PageLine[]` in, validated `RawTransaction[]` (+ `ImportProblem[]`) out, one
balance chain per product/section, reconciliation as a **hard gate** (D5).
Institution-specific; the WP-7 seam (`types.ts`, `src/pdf/`) stays generic.

## 2. Design decisions

### W3-D1 — Where the PDF source attaches

New module `src/desjardins-pdf.ts`, **not** re-exported from the zero-dep main
`"."` entry and **not** added to `src/pdf/` (which stays Desjardins-free, per
W2-D1/D7). It gets its own subpath export, mirroring `./pdf`:

```json
"./desjardins-pdf": "./src/desjardins-pdf.ts"
```

`src/desjardins-pdf.ts` imports `extractPageLines` from `./pdf/index.ts` —
that's the only file allowed to depend on both the PDF layer and Desjardins
grammar. The existing CSV `DesjardinsFileSource` (`src/desjardins.ts`) is
untouched and still exported from `"."`; consumers who only need CSV still pay
nothing for pdfjs.

No frontend upstream edits are needed for module resolution: WP-2 already
aliased `@wealthfolio/statement-parsers` → the package's `src/` directory (a
directory-level alias, not a per-subpath allowlist) in `vite.config.ts`, and
added the wildcard `"@wealthfolio/statement-parsers/*"` path in `tsconfig.json`.
Both already cover any new subpath transparently (proven by the existing
`.../pdf` import in the WP-2 probe page). Naming the new file
`desjardins-pdf.ts` (flat, matching the package.json subpath `./desjardins-pdf`
exactly) keeps Node/vitest resolution and the frontend's raw-filesystem alias in
agreement — a nested subpath like `./desjardins/pdf` would require a folder that
doesn't exist and would only work by accident under one of the two resolution
mechanisms.

### W3-D2 — `RawTransaction` / `ImportBatch` seam: two minimal, declared edits to `types.ts`

1. `SourceFormat` widens from `"csv" | "ofx"` to `"csv" | "ofx" | "pdf"`. This
   is a format identifier, not an institution identifier — generic, and needed
   by any future PDF source (WP-5 cards).
2. `ImportProblemCode` gains `"reconciliation_failed"` — D5 is stated as a
   generic locked decision (not Desjardins-specific), so a shared code belongs
   in the shared type, the same place `"malformed_record"` etc. already live.
   Used only when a product's `opening + Σlines ≠ closing`.

Both are additive union-member changes; no existing member changes shape or
meaning. Nothing else in `types.ts` changes, and no Desjardins wording, grammar,
or masking rule appears there.

### W3-D3 — Column assignment: derive geometry from the header row, not hardcoded x's

For every header line found in the input
(`Date|Code|Description|Frais|Retrait|Dépôt|Solde`, exact 7-cell match), record
the 7 cells' own x positions and rebuild a 7-bucket classifier: 6 boundaries at
the midpoints between consecutive header x's, with `-Infinity`/`+Infinity` outer
bounds. Any cell on a data line is assigned to the bucket whose midpoint-defined
interval contains its x. Geometry is recomputed on every header occurrence
(cheap, and tolerant of any per-page jitter) — nothing from the WP-2 synthetic
generator's or S4's literal x-values is hardcoded in the parser.

This single mechanism replaces what would otherwise be two separate rules (one
for text columns, one for right-aligned money columns): money cells land
correctly because their x always falls inside their column's half-open interval
regardless of how many digits the amount has (S4: "money columns are nearly
exact" — the column gaps, ~67-75pt, comfortably exceed the width variance
between the shortest and longest realistic amount).

### W3-D4 — Date/Code/Description: split by content, not by geometry

S4's finding: at the WP-2 tolerances, Date+Code always merge into one `PageLine`
cell, and Description merges in too whenever Code is 3 letters. Rather than
retuning `Y_TOLERANCE`/`CELL_GAP_FACTOR` in `src/pdf/lines.ts` (general-purpose,
WP-7-owned — tuning it for one institution's spacing would risk every other
consumer), all cells whose bucket is `date`, `code`, or `description` (per
W3-D3) are joined into one string regardless of how the PDF happened to merge or
split them, and a single regex peels off the leading `D MON CODE` prefix:

```
^(\d{1,2})\s+(<month-abbrev-alternation>)\s+([A-Z]{2,4})\s+(.*)$
```

If the joined text does not match this shape, the line is not a transaction row.

### W3-D5 — Wrapped-description continuation, also by bucket

A line is a continuation of the previous transaction iff every cell on it is in
the `description` bucket (W3-D3) and there is an open transaction in the current
product. This falls out of W3-D3 for free and also solves a real risk: a page
footer at the left margin (e.g. "Page 2 de 2") lands in the `date` bucket
geometrically, not `description`, so it is correctly rejected as a continuation
candidate rather than corrupting the previous row's description. (Known residual
gap: a footer positioned exactly at the description x — not observed, not ruled
out — would still be misread as a continuation. Flagged in §7; not fixable
without a real sample showing footer geometry.)

### W3-D6 — Section/product detection

Recognized product codes: `EOP`, `ET`, `CS`, `ES` (PLAN §5 WP-3). A line (not a
header, not a transaction-regex match) whose full joined text starts with one of
these codes as a whole token (`/^(EOP|ET|CS|ES)\b/`, case-sensitive — real
descriptions are mixed-case, so an all-caps product code can't collide) sets a
pending marker. The next header line consumes it: a pending marker means a
**new** product/balance chain starts (previous product finalized — see W3-D8);
no pending marker means the header is a same-product repeat (e.g. page 2) and
transactions resume against the already-open chain.

Right after a header starts a _new_ product, the next content line must be the
opening line: its `description` bucket, folded (NFD + strip diacritics, matching
`hash.ts`'s existing `normaliseForHash` approach) and case-insensitively
compared, must start with `solde report` (covers generator `SOLDE REPORTÉ` and
S4's observed mixed-case `Solde reporté`). If it doesn't match, the product is
flagged `malformed_record` ("no opening balance line found for product <code>")
and its opening balance is treated as unknown — every printed balance for that
product becomes unreconcilable (see W3-D7), but transaction rows are still
parsed and still contribute problems/rows on their own merits.

### W3-D7 — Reconciliation (D5, hard gate)

Per product:
`openingBalance + Σ(signed transaction amounts) === lastPrintedSolde`, where
`lastPrintedSolde` is the Solde-bucket value on the most recent row (opening,
transaction, or otherwise) that had one — not assumed to be present on literally
every row, since S4's probe only confirmed the first 25 lines and didn't have to
rule that out. If the check fails (or the opening/closing balance is unknown),
every successful row for that product is **replaced** by a single
`reconciliation_failed` problem, anchored at the product's header line — never
included as a warning alongside the transactions (D5: "reject ... never a
warning"). Per-row problems already raised while scanning that product (bad
date, bad amount, etc.) are kept regardless — they are independent visible
reasons.

Date-parse failure is decoupled from the reconciliation sum: a row whose amount
parses but whose date does not (`invalid_date`) still contributes its amount to
the running balance and the reconciliation sum, but does not produce a
`RawTransaction` of its own. Rationale: reconciliation validates that the parser
is reading the statement's own printed arithmetic correctly; a date-format
surprise on one row doesn't invalidate that check for the rest of the product.

### W3-D8 — One row = one transaction, net amount

A row can populate more than one of Frais/Retrait/Dépôt (S4/PLAN's grammar; the
generator's WP-2 fixture already had a "frais+retrait on one row" case). Rather
than fabricating two transactions the statement doesn't itself separate, one row
produces **one** `RawTransaction` whose signed amount is the row's net effect:
`deposit − withdrawal − frais`. Retrait and Dépôt both populated on the same row
is rejected as `invalid_amount` (ambiguous, mirrors the CSV source's same-shaped
rule). `institutionRef` carries the row's Code (VWW/DI/PWW/RA/...) — not a
sequence number like the CSV source (the PDF grammar has none), but still "the
institution's own reference for this line" in spirit.

### W3-D9 — Account key

`accountRefOf(rawRef, productCode)` mirrors the CSV source's
`maskAccountRef(...) + "-" + productCode` exactly, using `text.ts`'s existing
`maskAccountRef`. The one open question is what `rawRef` is: S4 observed an
"account ref `SJ ###-#####-#`" token in the letterhead, but not which sub-group
is "the folio" versus a transit or check digit. Rather than guess a semantic
decomposition unverified against a real file, the **whole matched reference
string** is masked to its last four characters (`/\bSJ\s*\d{3}-\d{5}-\d\b/` in
the letterhead lines preceding the first header). This is deliberately not
derived from the CSV layout's folio semantics — it doesn't need to be, since
masking only needs a value that's stable per account and never exposes more than
four characters. **Flagged assumption**, recorded in
`docs/factory/NEEDS-HUMAN.md`: confirm the `SJ ###-#####-#` wording on the next
real-statement run; if the reference format differs, this regex needs updating.

### W3-D10 — French dates

`src/dates.ts` gains:

- `FRENCH_MONTH_ABBREVIATIONS` (JAN, FÉV, MAR, AVR, MAI, JUN, JUL, AOU/AOÛT,
  SEP, OCT, NOV, DEC) — **only January (`JAN`) is confirmed against the real
  sample** (S4); the rest are the standard Québec 3-letter scheme, unverified.
  Flagged in `docs/factory/NEEDS-HUMAN.md`.
- `FRENCH_MONTH_NAMES` (full lowercase names, `janvier`..`décembre`) for the
  period line, which S4 shows in full words, not abbreviations — real, low-risk
  (no regional variation).
- `parseFrenchDayMonth(raw: string, year: number): CalendarDate | null` — pure,
  year-agnostic (matches the existing `parseDeclaredDate` philosophy: format
  parsing here, business logic — i.e. _which_ year — in the source that owns
  it).

Year selection (which calendar year a `D MON` date belongs to) is Desjardins-PDF
business logic, not a `dates.ts` concern: `desjardins-pdf.ts` parses the
letterhead period line (`"Pour la période du <D> <mois> au <D> <mois> <AAAA>"`)
once per document into `{ startMonth, endMonth, year }`, then for each
transaction: if the month is later in the calendar than `endMonth`, the
transaction is in `year - 1` (handles a December→January period crossing a year
boundary); otherwise `year`. If the period line isn't found at all, every date
in the document is unparseable (`invalid_date` on every row) — amounts still get
read and reconciliation still runs (W3-D7).

### W3-D11 — Synthetic fixture: a new, separate generator

`docs/specs/wp2-pdf-positioned-text.md`'s `generate.ts` produces the WP-2 golden
test's exact literal, byte-for-byte pinned. Upgrading it in place to the full
Desjardins grammar (multiple products, per-line balance chains, period decimals)
would silently break that frozen, semantically-reviewed test. Per the "additive
only" constraint, WP-3 adds a **second**, Desjardins-specific generator instead:
`tests/fixtures/pdf/generate-desjardins.ts`, exporting
`generateDesjardinsStatementPdf(options)`. `generate.ts` and its golden test are
untouched. This is a deliberate, recorded deviation from the session prompt's
literal "upgrade the generator" wording — the spirit (fixtures that exercise and
reconcile against the full grammar) is met without re-doing WP-2's frozen
review.

The new generator uses the S4-derived real geometry (row pitch 11.95,
description x≈107.85, money right edges ≈353/420/490/560.75) rather than the
WP-2 synthetic values, period-decimal amounts with space thousands (`2 485.06`,
not `2 485,06`), `D MON` dates, and prints a running Solde on every row (the
strongest test of W3-D7). It supports 1+ products in one document, each with its
own opening/closing and a deliberately reconciling balance chain; a
`reconcile: false` per-product option exists for the hard-gate-rejection test.

### W3-D12 — Probe extension

`pdf-worker-probe-page.tsx` (WP-2, dev-only, already forked-in — not an upstream
file) gets a second action: after `extractPageLines`, also run
`parseDesjardinsPdfLines` (imported from
`@wealthfolio/statement-parsers/desjardins-pdf`) and render `RawTransaction[]`
grouped by `accountRef`, plus `problems`. Per-product reconcile status is
derived from `problems` (`reconciliation_failed` names the product in its
message) rather than inventing a bespoke return shape — the `ImportBatch` seam
already carries everything the probe needs. No new route; same dev-only page,
same `import.meta.env.DEV` gating, so pdfjs stays out of the production bundle
exactly as WP-2 established.

## 3. Cross-check against the CSV source (D4)

A dedicated pair of small synthetic fixtures — one CSV (`DESJARDINS_EOP_LAYOUT`
shape), one PDF-grammar page — describing the _same_ transactions (same dates,
amounts, descriptions), asserts both sources agree on
`(occurredOn, amount, accountRef suffix)` tuples. Not a comparison against a
real overlapping month (none exists this session); the CSV and PDF fixtures are
deliberately paired rather than independent, so the test is a genuine
cross-check of the two parsers' arithmetic and dating agreeing on the same
events, not just two unrelated green test files.

## 4. Test plan

- `tests/dates.test.ts` — `parseFrenchDayMonth` for all 12 months, invalid
  strings, and the day/month shape boundary.
- `tests/desjardins-pdf.test.ts` — pure `parseDesjardinsPdfLines(lines, ...)`
  unit tests with hand-built `PageLine[]` (no pdfjs): column-bucket assignment
  including the merged-cell cases from S4 (date+code merged;
  date+code+description merged); wrapped-description continuation vs. a
  footer-shaped false-continuation; product marker + header → new chain vs.
  repeat header → same chain; masking; every `ImportProblemCode` this parser can
  raise; the reconciliation hard gate passing and (deliberately) failing; the
  year-wraparound heuristic.
- `tests/pdf-golden-desjardins.test.ts` — `generateDesjardinsStatementPdf()` →
  real pdfjs → `parseDesjardinsPdfLines` → expected `RawTransaction[]` + empty
  `problems`, for a 2-product, multi-page, wrapped-description fixture.
- Cross-check test per §3.
- WP-2's `tests/pdf-golden.test.ts` and `tests/pdf-lines.test.ts` are untouched
  and must stay green (proves W3-D3-D5 didn't need to touch `src/pdf/`).

## 5. Privacy

No real statement data anywhere: the new generator's account reference,
folio-like tokens, merchant descriptions and amounts are all invented. The real
sample that informed S4 was already deleted before this session (confirmed:
`statements/` does not exist in the working tree). Geometry and wording
assumptions that could not be re-verified this session are flagged in
`docs/factory/NEEDS-HUMAN.md` for the next real-PDF manual run, not silently
shipped as fact.

## 6. Out of scope (unchanged from the WP-3 prompt)

Hashing/idempotency (WP-4), account-to-Wealthfolio-account mapping (WP-4), card
statements (WP-5), any Rust change, any change to `src/pdf/lines.ts`'s
tolerances.

## 7. Known limitations / risks recorded for later

1. French month abbreviations beyond January are unverified (W3-D10).
2. The `SJ ###-#####-#` account-reference wording and which part is "the folio"
   are unverified (W3-D9).
3. A footer/letterhead line positioned exactly at the description-column x would
   be misread as a wrapped-description continuation (W3-D5) — not observed, not
   ruled out, no real sample available this session to check against.
4. Per-line printed-balance cross-validation (beyond the opening+Σ=closing gate)
   is not implemented — D5 only requires the aggregate check.
