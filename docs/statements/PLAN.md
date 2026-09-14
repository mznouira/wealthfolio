# Statements — tailored PDF import for Wealthfolio (fork)

Status: **WP-0 in progress** (fork bootstrapped; docs persisted). Owner: Zied
Nouira (`mznouira`). Fork: `git@github.com:mznouira/wealthfolio.git`, branch
`zied/statements`. Upstream: `wealthfolio/wealthfolio` (remote `upstream`).

This is the durable plan for a thin, upstream-tracking fork of Wealthfolio whose
purpose is to parse the owner's PDF account statements, reconcile them against
the statement's own printed balances, and import them into Wealthfolio's
**Spending** module. It is written so a fresh agent session in this repository
can pick the work up with no other context.

> Naming: the feature and every artifact is called **statements** (English).
> "Relevé" is only how the owner's banks label the PDF; it is never used as a
> code or doc name.

---

## 1. Goal

- Parse a statement PDF (starting with the Desjardins deposit statement),
  reconcile it, and import its lines as Wealthfolio activities.
- Reuse Wealthfolio's expense/income/saving taxonomies; enrich with a custom
  vocabulary **later**.
- Automate ingestion: start from a local folder the owner copies files into; add
  Google Drive intake later.

## 2. Non-goals

- No OCR. The statements carry a real text layer.
- No bank-login scraping, no aggregator/brokerage sync, no
  `Wealthfolio Connect`.
- Not an addon (the addon sandbox cannot read local files); not an external tool
  that emits CSV or writes the SQLite DB directly.
- No Google Drive API in v1.
- No rewrite of Wealthfolio core.

## 3. Locked decisions

| #   | Decision                                                                                                                     | Rationale                                                                                                    |
| --- | ---------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| D1  | **Thin fork**, rebased onto upstream; aim to propose the generic seam upstream.                                              | Keep upstream features; own the whole ingestion path.                                                        |
| D2  | Parser is **TypeScript, framework-free**, in `packages/statement-parsers`.                                                   | Reuses the portage parser, matches the frontend, and is the only realistic path to an upstream contribution. |
| D3  | PDF text via `pdfjs-dist`, reconstructed into **positioned columns**.                                                        | Statements are right-aligned tables; whitespace alone is unreliable.                                         |
| D4  | **PDF for every account**; the portage Desjardins **CSV** parser is kept as a secondary source.                              | Owner's intake is PDF, but the verified CSV path should not be thrown away.                                  |
| D5  | **Reconciliation is a hard gate**: opening + Σ(± lines) = closing per product/section, else reject with a visible reason.    | Only check that catches parser drift and a hash collision silently merging rows.                             |
| D6  | A credit-card **payment** is a **transfer pair** (chequing out ↔ card in); a card purchase is an expense.                    | Prevents double-counting spend.                                                                              |
| D7  | Dedup via the portage **content hash** mapped to Wealthfolio's `idempotency_key`, plus `source_system` / `source_record_id`. | Re-importing the same statement must insert zero rows.                                                       |
| D8  | Reuse Wealthfolio's `expense` taxonomy; the parser **proposes** merchant→category rules the user confirms.                   | One vocabulary in one place; enrich later.                                                                   |
| D9  | v1 intake: **watched local folder** + drag-and-drop. Google Drive OAuth is parked for a later WP.                            | Fastest path to near-zero touch; Drive needs a GCP project and consent screen.                               |
| D10 | Real statements are **never committed**; synthetic fixtures only; a local `statements/` folder is gitignored.                | Repo can go public; upstream is public.                                                                      |

## 4. Architecture

- **Fork layout** (all our code stays in existing upstream seams + one new
  package and one new frontend feature):
  - `packages/statement-parsers/` — new workspace package: the `StatementSource`
    seam, text/decimal/date/hash helpers, and one parser per institution.
  - `apps/frontend/src/features/statements/` — the import flow that consumes the
    package and produces Wealthfolio `ActivityImport[]`.
- **Flow**: PDF bytes → pdfjs text layer → positioned lines → institution parser
  → `RawTransaction[]` (+ reconciliation) → account mapping → `ActivityImport[]`
  → Wealthfolio check → review grid → import.
- **Dedup**: `import_hash` (accent-folded, versioned) → `idempotency_key`.
- **Isolation**: keep the patch series small and additive; no edits to upstream
  files unless required, and when required, minimal and clearly scoped.

## 5. Work packages

| WP   | Title                                                                   | Status   | Depends on         |
| ---- | ----------------------------------------------------------------------- | -------- | ------------------ |
| WP-0 | Fork bootstrap + persist docs                                           | **done** | —                  |
| WP-1 | Parser core package (port from portage) + spike notes                   | **done** | WP-0               |
| WP-2 | PDF → positioned text (`pdfjs-dist`)                                    | pending  | WP-1               |
| WP-3 | Desjardins deposit statement parser + reconciliation                    | pending  | WP-2               |
| WP-4 | Wealthfolio import integration (frontend)                               | pending  | WP-3               |
| WP-5 | Credit-card parsers (Desjardins Visa, CIBC Costco MC) + payment pairing | pending  | WP-4, card samples |
| WP-6 | Intake automation: watched folder (v1), Drive OAuth (parked)            | pending  | WP-4               |
| WP-7 | Upstream readiness: generic seam behind a flag, design issue/PR         | pending  | WP-5               |

### WP-0 — Fork bootstrap (current)

- [x] Fork `wealthfolio/wealthfolio` → `mznouira/wealthfolio`.
- [x] Clone to `/home/zied/Projects/wealthfolio`.
- [x] `upstream` remote added; tags fetched.
- [x] Branch `zied/statements` created.
- [x] `pnpm@10.33.4` installed; `pnpm install` green.
- [x] Persist `docs/statements/` (this plan, glossary, protocol, manual tests)
      and the `statements` skill.
- [x] Rust toolchain + Tauri system deps (installed 2026-09-14; `pnpm tauri dev`
      owner-verified; see §8).
- [x] Locate and document the activity/CSV import feature and its interfaces.

### WP-1 — Parser core + spike

Port from `/home/zied/Projects/portage` (frozen reference):

- `types.ts` — `StatementSource` seam, `RawTransaction`, `CalendarDate`,
  `Money`, `ImportProblem`, `ImportBatch`.
- `text.ts` — CP1252/ASCII detection + decode, whitespace collapse, account
  masking.
- `decimal.ts`, `dates.ts` (incl. French month abbreviations and the year taken
  from the statement period), `csv.ts`, `hash.ts`.
- Port the verified Desjardins **CSV** source as a secondary source.
- Spike notes (`docs/statements/NOTES.md`): (1) Wealthfolio sign/spending
  semantics for `CREDIT_CARD` accounts; (2) `pdfjs-dist` worker under
  Vite/Tauri; (3) arbitrary-path read via `@tauri-apps/plugin-fs`.

### WP-2 — PDF → positioned text

Load bytes with `pdfjs-dist`; reconstruct
`PageLine[] { page, y, cells: {x,text}[] }` from text items so right-aligned
money lands in the correct column; handle multi-page output. Tested against the
local sample (outside the repo) plus a synthetic fixture.

### WP-3 — Desjardins deposit statement parser

Sections/products `EOP`, `ET`, `CS`, `ES`; columns
`Date | Code | Description | Frais | Retrait | Dépôt | Solde`; wrapped
descriptions; `Solde reporté` opening line. **Reconciliation gate per product.**
Golden tests; cross-check against the CSV parser where the same month exists.

### WP-4 — Wealthfolio import integration

Add a "Statement (PDF)" source to the import flow; resolve the parsed account
key (masked folio+product, or card last-4) to a Wealthfolio account and persist
the mapping; map to `ActivityImport`; set `source_system` / `source_record_id` /
`idempotency_key`; surface reconcile status and rejects in the review grid;
reuse the spending taxonomy and propose merchant→category rules. Verify
re-import inserts zero.

### WP-5 — Credit-card parsers

Desjardins Visa statement and CIBC Costco Mastercard statement (samples
pending). Card purchase = expense; card payment = transfer pair; per-statement
reconciliation; assert no double-count in spending.

### WP-6 — Intake automation

v1: watch a local folder (Rust `notify`) + drag-and-drop, settings for folder
and account mapping, rescan dedup. **Parked**: Google Drive OAuth (needs Google
Cloud project + consent screen; tokens in the OS keyring).

### WP-7 — Upstream readiness

Isolate a generic `StatementSource` seam plus one reference parser behind a
flag; write it up; open an upstream design issue/PR proposing a statement-import
extension point. Gate: the patch rebases onto a newer upstream tag.

## 6. Domain vocabulary

See [`CONTEXT.md`](CONTEXT.md). Summary: a **statement** is the PDF; a
**statement line** is a row in it; an **activity** is the Wealthfolio record we
create; an **expense** is a `WITHDRAWAL` assigned to the `expense` taxonomy (not
a separate type); the **account key** is the institution's masked account
identity; **reconciliation** is `opening + Σ lines = closing`; a **transfer
pair** links a chequing debit to a card credit.

## 7. Verification / gates

- TypeScript: `pnpm test` (vitest), `pnpm lint`, `pnpm type-check`.
- Rust (toolchain installed 2026-09-14): `cargo test`, `cargo clippy` — run when
  Rust is touched.
- Parser package: unit tests + **golden fixtures** (synthetic) + a hard
  reconciliation assertion.
- Manual: anything CI cannot reach (real PDFs, folder intake, review grid) is
  recorded in [`MANUAL-TESTS.md`](MANUAL-TESTS.md). The first item of any change
  that can capture a terminal/screen/focus must be how to leave it and recover.
- Privacy: never commit a real statement, account number, or balance.

## 8. Environment / toolchain notes

Checked 2026-09-13 on Omarchy/Arch; Rust updated 2026-09-14:

- `gh` authenticated as `mznouira` (`repo` scope) — fork and PRs are possible.
- Node 26.8.1 via mise; **corepack is absent** on this Node; `pnpm@10.33.4` was
  installed with `npm install -g pnpm@10.33.4` (user prefix under mise).
- **Rust installed 2026-09-14** (owner): rustc 1.95.0 (59807616e 2026-04-14),
  cargo 1.95.0 (f2d3ce0bd 2026-03-21), clippy 0.1.95 (59807616e1 2026-04-14);
  `rust-toolchain.toml` pins `1.95.0`. Owner verified `pnpm tauri dev` works
  end-to-end (Tauri system deps OK).
- `pnpm install` warns that `@swc/core` build scripts were skipped; run
  `pnpm approve-builds` if a build needs them.
- Frontend-only work (parser package + vitest) does **not** need Rust; the
  import backend and desktop app do.

## 9. Open questions / risks

- Wealthfolio sign and spending semantics for `CREDIT_CARD` accounts (WP-1
  spike) — **resolved (WP-1)**: `NOTES.md` S1.
- Exact location/interfaces of the activity/CSV import feature (WP-1) —
  **resolved (WP-1)**: `NOTES.md` S1 + WP-4 note.
- `pdfjs-dist` worker bundling under Vite/Tauri settings (WP-2).
- French dates + wrapped descriptions + one file carrying several products
  (WP-3).
- Overlap/dedup across monthly statements (WP-3/WP-4).
- Card statement grammars — need the Desjardins Visa and CIBC Costco Mastercard
  PDFs (WP-5).
- Google Drive OAuth effort (WP-6, parked).
- Upstream AGPL-3.0 and whether the maintainer accepts the seam (WP-7).

## 10. Session log

- **2026-09-13** — Planning complete (grilling + domain modeling). Decided: thin
  fork, TS parser package, PDF for all accounts, reconciliation as a hard gate,
  card payments as transfer pairs, local-folder intake then Drive. Bootstrapped
  the fork and persisted these docs. **Next:** install the Rust toolchain +
  Tauri deps (with the owner, needs sudo), then WP-1 (port the parser core from
  portage and write the spike notes). **Broken/blocked:** Rust and
  `libappindicator-gtk3` not installed.
- **2026-09-14** — WP-1 done: parser core ported to
  `packages/statement-parsers/` (8 modules + `sha256.ts` + trimmed barrel),
  Desjardins source converted to bytes-based `StatementSource`, 84 tests across
  6 test files, reconciliation hard gate green, 10 synthetic fixtures ported
  byte-for-byte (spec said 9; portage held 10); dropped portage's "missing file
  rejects" test because A2 removed path I/O; the CP1252 test row is
  byte-identical to portage's (14 fields — an earlier report miscounted and
  claimed an adaptation that did not occur). `docs/statements/NOTES.md` written
  (S1–S3 + WP-4 consumption note), `PLAN.md` updated. Root test gate wired
  (`package.json` test script + `.prettierignore` fixture-dir exclusion).
  `MANUAL-TESTS.md`: no additions — WP-1 has no UI / real-PDF / folder-intake
  surface. **Next:** WP-2 (pdfjs-dist → positioned text). **Broken/blocked:**
  pre-existing frontend test debt — 29 deterministic failures
  (`window.localStorage` undefined in jsdom: performance-page 14,
  holdings-toolbar-order 7, spending-insights-page 8) plus variable timeout
  flake (total fluctuates 33–44 across runs); verified pre-existing at `69fedca`
  via baseline worktree rerun; environmental, needs its own ticket. Rust
  toolchain still absent.
- **2026-09-14 (later)** — Owner installed the Rust toolchain; `pnpm tauri dev`
  verified working. §8 + WP-0 updated (WP-0 now fully done); cargo gates
  available from here on (run when Rust is touched; a one-time `cargo check`
  baseline is queued for the WP-2 session). `docs/specs/wp2-session-prompt.md`
  updated to match. **Next:** WP-2 (pdfjs-dist → positioned text), prompt ready.
