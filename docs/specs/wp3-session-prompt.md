---
# WP-3 session prompt (autonomous)

Paste everything below the line into a fresh orchestrator session.
---

Continue the statements work: WP-3 — Desjardins deposit statement parser +
reconciliation. This session runs autonomously: you are pre-authorized to make
every decision until WP-3 is done. Do not wait for approval between phases — run
your full loop (spec → plan → build → verify → review → docs) and document each
decision and its rationale in the spec and the PLAN.md session log. Stop only if
blocked on something only the owner can do (sudo for system packages,
credentials/network, or a missing real statement sample that proves essential —
see the real-sample bullet below).

Load the `statements` skill, then read docs/statements/PLAN.md (§3 locked
decisions D3–D5 and D7, §4 architecture, §5 WP-3 and WP-4, §10 session log),
docs/statements/AGENTS.md, docs/statements/CONTEXT.md, docs/statements/NOTES.md
(S1 sign semantics, S2 including the WP-2 update, the WP-4 consumption note),
and docs/specs/wp2-pdf-positioned-text.md (the `./pdf` layer you build on). Then
read the build-on source: packages/statement-parsers/src/pdf/index.ts and
src/pdf/lines.ts, src/desjardins.ts (the verified CSV source — field semantics,
masking, problem codes), src/dates.ts, src/decimal.ts, src/hash.ts.

Scope:

- Build the Desjardins deposit-statement parser on the WP-2 `./pdf` layer:
  consume `PageLine[]`, emit validated `RawTransaction[]` per product/section
  (EOP, ET, CS, ES), behind the unchanged `StatementSource` seam (bytes in →
  `ImportBatch` out). Design decision to make early (in the spec): how the PDF
  source attaches — a new source beside the CSV one vs extending it; keep the
  WP-7 upstream seam clean (nothing Desjardins-specific leaks into `src/pdf/` or
  `types.ts`).
- Grammar per PLAN §5 WP-3: columns Date | Code | Description | Frais | Retrait
  | Dépôt | Solde; `Solde reporté` opening line per product; wrapped
  descriptions (continuation lines carry description text only); one file may
  carry several products, each with its own balance chain; account key = folio
  - product code masked to the last four (CONTEXT.md). Derive column assignment
    from the header row's cell positions where the grammar allows — do not
    hardcode the synthetic generator's x values into the parser (record this
    decision).
- Reconciliation is a HARD gate per product (D5): opening + Σ(± lines) =
  closing, else reject with a visible reason, never a warning. Synthetic
  fixtures must reconcile — the WP-2 fixture deliberately does not; upgrade the
  generator to the full grammar (sections, `Solde reporté`, wrapped
  descriptions, reconciling balance chains per product).
- French dates: add French month abbreviations to `dates.ts` against the
  grammar's date format, pinned by tests (WP-1 OQ1 deliberately deferred this —
  do not ship an untested month table).
- Cross-check against the verified Desjardins CSV source where the same month
  exists in both (D4).
- Golden tests: generated synthetic PDF → expected `ImportBatch` (transactions
  - problems), plus unit tests for the grammar rules (column assignment,
    wrapping, section detection, masking, problem codes, reconciliation
    arithmetic).
- Real-sample evidence — check FIRST: the owner may have run MANUAL-TESTS WP-2
  item 4 and left a real PDF in the gitignored `statements/` folder and/or
  geometry notes in PLAN/NOTES. If present: measure locally (page size, column
  x-positions, fonts, row pitch, exact section-header wording, date format),
  encode into the generator, use the file for local manual verification only,
  never commit it. If absent: build from the recorded grammar + CSV-verified
  semantics, record wording assumptions in the spec, flag the gap in the session
  log (tolerances and geometry remain synthetic).
- Probe extension (decide in the spec): extend the dev-only probe page to run
  the new parser on a dropped PDF and show `RawTransaction[]` + per-product
  reconcile status — the manual surface for real-statement verification
  (dev-only, additive; prod builds must stay free of pdfjs chunks).
- MANUAL-TESTS.md: add a dated WP-3 entry (real-PDF parse + reconcile via the
  probe under `pnpm tauri dev` and/or `pnpm run dev:web`; leave/recover is
  already WP-2 item 1 — reference it unless you introduce a new
  terminal-capturing step).
- If new vocabulary stabilizes (e.g. balance chain), add it to CONTEXT.md.

Constraints: additive-only; minimal upstream edits, each declared in the spec
and session log; synthetic fixtures only — never commit a real statement,
account number, or balance; one work package this session; no Rust changes (no
cargo gates — the WP-2 baseline passed and nothing Rust-side moves).

Environment facts (do not re-derive):

- Branch `zied/statements` at `924480045` (WP-2 done, pushed). Pre-flight per
  fork protocol: confirm branch + clean tree, `git fetch upstream`, rebase only
  if behind and clean.
- The `./pdf` layer (WP-2):
  `extractPageLines(bytes: Uint8Array): Promise<PageLine[]>` from
  `@wealthfolio/statement-parsers/pdf` —
  `PageLine { page, y, cells: { x, text }[] }`, pages 1-based, ordered page-asc
  then y-desc, no options; tolerances are exported constants in
  `src/pdf/lines.ts` (`Y_TOLERANCE = 2`, `CELL_GAP_FACTOR = 0.5`) —
  synthetic-derived, revisit against a real sample. pdfjs-dist 6.3.289
  exact-pinned; the package vitest aliases it to the legacy build for Node (real
  pdfjs, no mocking). Worker verified by dev-server smoke; the Tauri/dev:web
  runtime checks are MANUAL-TESTS WP-2 items the owner may not have run yet — do
  not block on them.
- Synthetic generator:
  `packages/statement-parsers/tests/fixtures/pdf/generate.ts` (pdf-lib devDep;
  CLI `node …/generate.ts [out]`, default `/tmp/wf-synthetic-statement.pdf`).
  Geometry is synthetic (US Letter; Date@40 left, Code@90 left, Description@130
  left wrap ~180, Frais right-edge 350, Retrait 420, Dépôt 490, Solde 565;
  Helvetica 8; row pitch 14).
- Package state: 98 tests green across 8 files; strict tsconfig
  (`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`); vitest node env,
  explicit imports; prettier printWidth 100 double quotes; `tests/fixtures/`
  prettier-ignored but tsc+eslint covered; root .gitignore blocks
  `tests/fixtures/**/*.pdf` and `/statements/`.
- The Desjardins CSV source (WP-1) is the verified secondary source
  (`DESJARDINS_EOP_LAYOUT`, bytes-based `DesjardinsFileSource`, 10 synthetic CSV
  fixtures, reconciliation hard gate green). `dates.ts` has NO French months yet
  (deliberate, WP-1 OQ1). `decimal.ts` already parses fr-CA amounts ("1 234,56",
  NBSP/narrow-NBSP group separators).
- Frontend wiring exists from WP-2: vite alias + tsconfig paths for
  `@wealthfolio/statement-parsers`; dev-only probe route `/dev/statements-pdf`
  (lazy, DEV-gated; prod builds emit zero pdfjs chunks — keep it that way).
- `pnpm test`'s frontend portion still has the 29 pre-existing jsdom failures
  (performance-page 14, holdings-toolbar-order 7, spending-insights-page 8) plus
  timeout flake — environmental, out of scope; do not chase. Your gates: the
  statement-parsers package tests, `pnpm lint`, `pnpm type-check`,
  `pnpm format:check`.
- Carried forward from the WP-2 security pass: input size/page cap deferred to
  the WP-4 import seam; pdf-lib is unmaintained since 2022 (test-only devDep —
  fine, monitor advisories).

Finish by: updating PLAN.md's WP table (WP-3 → done) + session log (done / next
/ blocked) per the fork protocol; appending the MANUAL-TESTS.md entry; gates
green (package tests + lint + type-check + format:check); a privacy/security
pass (no real statement data anywhere); then push `zied/statements` to origin.
