# Desjardins AccèsD fixtures — synthetic

Every byte in this directory is invented. No real account number, balance, merchant or
date from any real statement appears here, and none ever may: this repo goes public
(`AGENTS.md`, Conventions; `PRIOR-ART.md`, the mistake this rule exists to avoid).

The folio is `123456`, the caisse is `Montréal`, the descriptions are written from
Desjardins' own generic transaction vocabulary, and the balances are arithmetic on the
invented amounts.

> **Never stage a real export under `tests/fixtures/`.** `.gitignore` re-includes
> `!tests/fixtures/**`, which used to make this the one directory where a real statement
> could be committed by accident. `tests/fixtures/**/tmp/`, `**/releves/` and
> `**/*.pdf` are now re-excluded, but the right home for a real download is still
> `releves/`, or somewhere outside the repo entirely.

## ✅ The CSV column layout is VERIFIED

Derived 2026-08-31 from a real AccèsD "opérations" export (one month, 40 records, two
products on one folio), read outside the repo and never copied into it.

**The map is not merely plausible, it balances.** Chaining
`previous_balance − withdrawal + deposit` across the sample reproduces column 13 exactly
for all 38 consecutive same-product pairs, and the one discontinuity falls precisely
where the product code changes. A column map that is off by one does not reconcile.
Running the importer over the real file yields 40 transactions and 0 problems, and both
accounts reconcile to the cent against the statement's own closing balance.

### What the earlier *inferred* layout got wrong

Kept as a record of what guessing costs. Five of the nine facts below were wrong, and
four of them would have rejected or corrupted every row of a real export.

| | Inferred | Actual |
|---|---|---|
| Field count | 11 | **14** |
| Date format | `YYYY-MM-DD` | **`YYYY/MM/DD`** — would have rejected every row |
| Decimal separator | `,` (fr-CA) | **`.`**, with no thousands separator at all |
| Column 0 | transit (digits) | **caisse name** (text) |
| Column 2 | account number | **product code** (`EOP`, `ES1`) |
| Account identity | account number alone | **account number + product code** — the account number *is* there (col 1, the folio), but one folio carries several products |
| Balance column | 10 | **13** |
| Leading blank line | not expected | **present** |
| Encoding | UTF-8 with BOM | **CP1252, no BOM** |

### Verified layout — `eop-clean.csv`, `eop-invalid.csv`, `eop-quoting.csv`, `eop-overlap.csv`

No header row. The file opens with a blank line. CP1252, CRLF. Comma-separated,
RFC 4180 quoting: **text and empty fields are quoted, numeric values are bare.**
Fourteen fields:

| # | Field | Notes |
|---|---|---|
| 0 | caisse name | text, e.g. `Montréal`; not carried into `RawTransaction` |
| 1 | folio — **the account number** | → masked to last 4, first half of `accountRef` |
| 2 | product code | `EOP`, `ES1`; second half of `accountRef` |
| 3 | date | **`YYYY/MM/DD`** → `occurredOn` |
| 4 | sequence number | 5 digits, resets per product → `institutionRef` |
| 5 | description | → `description` |
| 6 | *(empty in the whole sample)* | presumed cheque number; not read |
| 7 | withdrawal (débit) | populated ⇒ **negative** amount |
| 8 | deposit (crédit) | populated ⇒ **positive** amount |
| 9–12 | *(empty in the whole sample)* | meaning unknown; not read |
| 13 | running balance | not carried; reserved for the reconciliation check in `PARKING-LOT.md` |

Exactly one of fields 7 and 8 is populated on every record of the sample. Both, or
neither, is an `invalid_amount` / `zero_amount` problem, not a guess.

There is **no currency column**. Currency is supplied to the source at construction and
is never defaulted — `AGENTS.md`, "every amount carries its currency".

**The account number alone is not the account.** Column 1 is the account number (the
folio, the last component of the `institution-transit-folio` coordinates on the
statement), but the sample carries two products on it — `EOP` (39 records) and `ES1`
(1) — each with its own independent balance chain. `accountRef` is therefore
`<masked folio>-<product>` (`3456-EOP`). Masking the folio alone would collapse two
accounts into one and interleave their balances into nonsense.

## What each fixture exercises

### `eop-clean.csv` — 11 records, all must parse

Byte-shaped like the real export: CP1252, no BOM, CRLF, leading blank line, 14 fields.
Ten `EOP` records and one `ES1` on the same folio.

Running balances are internally consistent per product: `EOP` runs 4 000,00 → 3 776,22
and `ES1` runs 1 000,00 → 1 500,00. The test that sums the parsed integers against those
figures is the one that would catch a column-map regression.

### `eop-clean-ascii.csv` — 11 records, the accent-folded variant

AccèsD offers the same export in two charsets, and both were checked against real
downloads:

| | default | variant |
|---|---|---|
| Encoding | CP1252 | **ASCII** |
| Caisse | `Montréal` | `Montreal` |
| Descriptions | `Épicerie`, `Prêt`, `Intérêt` | `Epicerie`, `Pret`, `Interet` |

**It is the same layout** — same fourteen columns, same `YYYY/MM/DD`, same dot decimals,
same leading blank line — so it needed no parser change. Encoding detection is per-file
and ASCII is valid UTF-8, so it was already read correctly. The fixture exists to keep
that true. Desjardins' folding is 1:1, so the two files are the same byte length.

> ⚠ **The two variants describe the same transaction with two different strings.**
> SCOPE item 3 hashes the description, so downloading the accented file one month and
> the ASCII file the next would produce a duplicate row for every accented transaction —
> import would stop being idempotent *across variants*. Item 2 deliberately does not
> paper over this: folding the description in the parser would be inventing data. There
> is a test pinning the fact that the two descriptions differ *only* by accent folding,
> which is what makes a normalising hash a viable fix rather than a guess.
>
> **✅ RESOLVED by SCOPE item 3, 2026-08-31.** `src/import/hash.ts` hashes an
> accent-folded, uppercased, whitespace-collapsed description and stores the original
> verbatim in `txn.description`. The parser is unchanged — the fold is a property of the
> hash, not of the ledger's data. `tests/import/write.test.ts` imports both variants of
> this month into one database and asserts the row count stays at 11.

### `eop-overlap.csv` — 10 records, the overlapping statement

18 January – 5 February, so it **repeats seven records of `eop-clean.csv`** (six `EOP`,
one `ES1`) and adds three that are genuinely new. AGENTS.md says to assume statements
overlap in date range; this is that assumption made executable.

The load-bearing detail is the sequence numbers. AccèsD numbers records **per product,
per statement**, so the 20 January withdrawal that is `00006` in the January export is
`00002` here — same account, same date, same amount, same description, different
reference. That is the fixture's whole reason to exist: it is what would duplicate every
overlapping row if `institution_ref` were an input to item 3's hash, and it is why it is
not (`src/import/hash.ts`, DECISION 2). A test asserts the two references really do
differ, so the idempotency test above cannot pass for the wrong reason.

Balances continue the `eop-clean.csv` chains rather than restarting: `EOP` 5 302,15 →
5 844,82 and `ES1` 1 500,00 → 1 500,42.

### `eop-quoting.csv` — 4 records, all must parse

RFC 4180 cases that are legal in the format but happen **not** to occur in the July
sample. They are kept in a separate file so nothing in `eop-clean.csv` is embellished
beyond what a real export contains.

| Seq | Edge case |
|---|---|
| `00001` | comma inside a quoted description |
| `00002` | escaped `""` quote |
| `00003` | CRLF inside a quoted field — the case a naive `split("\n")` destroys |
| `00004` | comma decimal (`84,20`). The verified export is dot-decimal; a comma is still unambiguous here, so it is read rather than rejected, and a locale change at the bank does not silently drop every row. |

### `eop-invalid.csv` — 10 records, all must be rejected

One record per `ImportProblemCode`, plus the two date traps. Records start at **line 2**,
because line 1 is the blank line a real export begins with.

| Line | Expected |
|---|---|
| 2 | `malformed_record` — 8 fields, not 14 |
| 3 | `invalid_date` — `2026/02/30`, shaped correctly, does not exist |
| 4 | `invalid_date` — `2026/13/01` |
| 5 | `invalid_date` — `01/02/2026`. **Not** silently read as DD/MM or MM/DD. The layout declares one date format and the parser refuses to guess; ambiguity is a rejection, never a coin flip. |
| 6 | `invalid_amount` — withdrawal *and* deposit both populated |
| 7 | `invalid_amount` — `ABC` |
| 8 | `zero_amount` — `0.00`; schema `CHECK (amount_minor <> 0)` |
| 9 | `zero_amount` — neither column populated |
| 10 | `missing_description` — schema `CHECK (description <> '')` |
| 11 | `malformed_record` — unterminated quote |

## There are no OFX fixtures here

**Desjardins publishes no OFX/QFX**, for any account type. Fixtures for it used to live
in this directory (`eop-clean.ofx`, `eop-invalid.ofx`) and were wrong to: they asserted
an export that cannot exist. They now live in `tests/fixtures/ofx/`, belong to the
institution-neutral `OfxFileSource`, and are named after a synthetic bank.

Desjardins offers **CSV** for deposit accounts (verified above, two charset variants) and
**PDF only** for credit cards (see `PARKING-LOT.md`).
