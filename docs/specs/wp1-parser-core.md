---

# WP-1 Spec — Parser core package + spike notes

Status: **draft for review**. Scope source: `docs/statements/PLAN.md` §5 WP-1,
§8. Reference: `/home/zied/Projects/portage` @ `92c8eac` (frozen).

## 1. Goal

New workspace package `packages/statement-parsers/` containing the portage
parser core (ported faithfully), the verified Desjardins CSV source, ported
tests + synthetic fixtures. Plus `docs/statements/NOTES.md` with three spike
notes. Gates green (TS only; Rust untouched — toolchain absent per PLAN §8).

## 2. In scope / out

In:

- Package scaffold + 8 ported modules + trimmed barrel.
- Ported tests (5 files) + `text.ts` coverage extracted into its own test file.
- 9 synthetic CSV fixtures + fixture README (portage-attested synthetic).
- Desjardins CSV source ported as a secondary source (bytes-based).
- `NOTES.md` spikes (3).
- Root `test` script edit (the single upstream edit).
- `PLAN.md` updates (WP table, session log, WP-0 checkbox, §9 Q1/Q2).

Out (later WPs): `pdfjs-dist` install/usage (WP-2), PDF parser (WP-3), frontend
wiring/consumption (WP-4), card parsers (WP-5), folder watching (WP-6), French
month parsing (WP-3 — see OQ1).

## 3. Port inventory (portage @ 92c8eac)

| portage file               | lines | → package                       |
| -------------------------- | ----- | ------------------------------- |
| `src/import/types.ts`      | 247   | `src/types.ts`                  |
| `src/import/text.ts`       | 85    | `src/text.ts`                   |
| `src/import/decimal.ts`    | 153   | `src/decimal.ts`                |
| `src/import/dates.ts`      | 96    | `src/dates.ts`                  |
| `src/import/csv.ts`        | 117   | `src/csv.ts`                    |
| `src/import/hash.ts`       | 214   | `src/hash.ts`                   |
| `src/import/common.ts`     | 104   | `src/common.ts`                 |
| `src/import/desjardins.ts` | 280   | `src/desjardins.ts`             |
| (new)                      | —     | `src/sha256.ts` (A3)            |
| `src/import/index.ts`      | 63    | `src/index.ts` (trimmed barrel) |

Tests: `tests/import/{csv,dates,decimal,hash,desjardins}.test.ts` (~726 lines) +
new `text.test.ts` (decodeBytes block from portage `ofx.test.ts:85-96`).
Fixtures: `tests/fixtures/desjardins/*.csv` (9) + `README.md`.

Zero npm runtime deps. Only Bun-specific lines in the closure: `hash.ts:194`
(`Bun.CryptoHasher`), `desjardins.ts:242` (`Bun.file`).

## 4. Adaptation decisions

- **A1 Seam rename**: `TransactionSource` → `StatementSource` (fork vocabulary,
  `CONTEXT.md`). Rename across types/desjardins/tests/doc-comments.
  `ImportBatch`, `FetchRequest`, `RawTransaction` keep their names.
- **A2 Bytes-based source**: `DesjardinsFileSourceOptions`
  `{ path, currency, layout? }` →
  `{ bytes: Uint8Array | ArrayBuffer, name, currency, layout? }`.
  `SourceLocation.file` = basename of `name` (unchanged semantics). OFX guard
  (`TypeError`) kept.
- **A3 Sync SHA-256**: new internal `src/sha256.ts` (pure TS, ~80 lines)
  replaces `Bun.CryptoHasher`. `importHash` stays sync. Golden preimage test
  pins framing; digest tested against known vectors + `node:crypto` cross-check.
- **A4 Test runner**: `bun:test` → `vitest` imports; `import.meta.dir` →
  `fileURLToPath(new URL(...))` + `node:fs/promises`; CP1252 temp-file test
  keeps `Buffer.from(row, "latin1")` (fine in vitest node env).
- **A5 Package tsconfig**: extends `../../tsconfig.base.json`; adds
  `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes` (portage is written
  against both); `noEmit: true`, `composite: false`; includes `src` + `tests`.
- **A6 Invisible codepoints → explicit escapes + comments**: `text.ts` BOM
  `"\uFEFF"`; `decimal.ts` `GROUP_CHARS = /[ \u00A0\u202F\u2009']/gu`. (Portage
  literals contain raw NBSP / narrow NBSP / thin space; ported tests catch
  loss.)
- **A7 Barrel**: re-export core + desjardins only. No ofx/write.
- **A8 `dates.ts` ported as-is** (no French months — portage deliberately omits;
  see OQ1).
- **A9 Keep `.ts`-extension relative imports** (base config allows; noEmit).

## 5. Package wiring

- `packages/statement-parsers/package.json`: name
  `@wealthfolio/statement-parsers`, private, `type: module`,
  `exports: { ".": "./src/index.ts" }` (source-distributed, no build step,
  unpublished). Scripts: `test` (vitest run), `test:watch`, `lint`, `lint:fix`,
  `lint:quiet`, `format`, `format:check`, `type-check` (tsc --noEmit). devDeps:
  typescript, vitest. No dependencies.
- `vitest.config.ts` (package-level): environment `node`, include
  `tests/**/*.test.ts` + `src/**/*.test.ts`, explicit imports (no globals).
- `eslint.config.js`: addon-sdk pattern (`createBaseConfig`, no react plugins).
- `.prettierrc.cjs` + `.prettierignore` mirroring siblings. Style already
  matches (printWidth 100, double quotes, semi).
- Layout keeps portage structure: `src/`, `tests/`,
  `tests/fixtures/desjardins/`.

## 6. Upstream edits (exhaustive)

1. Root `package.json` `test` script: insert
   `pnpm --filter @wealthfolio/statement-parsers test && ` before the
   `node --test scripts/__tests__/` step. (Only way the `pnpm test` gate covers
   package tests; `packages/*` has no test wiring today — ui/addon-sdk ship no
   test scripts.)
2. `pnpm-lock.yaml` (via `pnpm install`).

Nothing else. Workspace glob, eslint (`-r`), type-check (`-r`), prettier (root)
pick the package up automatically.

## 7. Spike notes (`docs/statements/NOTES.md`)

**S1 — CREDIT_CARD sign/spending semantics** (evidence: file:line in repo):

- Card = only liability account type
  (`crates/core/src/accounts/accounts_constants.rs:102`).
- Server-enforced card activities: WITHDRAWAL, TRANSFER_IN, CREDIT, FEE,
  INTEREST (`crates/core/src/activities/activities_service.rs:877-896`; frontend
  mirror `activity-import-profile.ts:61-67`, `draft-utils.ts:484-492`).
- Spending math
  (`apps/frontend/src/features/spending/lib/constants.ts:112-159`):
  WITHDRAWAL/FEE/INTEREST → +|amt|; CREDIT → −|amt| (refund); TRANSFER_IN → 0 (a
  payment never spends); card income never counts.
- Balance side
  (`crates/core/src/portfolio/snapshot/holdings_calculator/mod.rs:494-511`):
  card INTEREST → charge (debt up); TRANSFER_IN → payment (debt down).
- Importer mapping rule (D6): purchase → WITHDRAWAL "Charge"; payment →
  TRANSFER_IN "Payment"; refund → CREDIT. Wealthfolio encodes direction in
  activityType with positive magnitudes — differs from portage's signed-Money;
  the WP-4/WP-5 importer maps sign → type.
- Dedup: `idempotency_key` computed server-side
  (`crates/core/src/activities/idempotency.rs:27` — SHA-256 over
  account|type|date|…|provider_reference_id←source_record_id|description); DB
  upsert on conflict + `check_existing_duplicates`. `ActivityImport` carries no
  idempotencyKey — our hash rides via sourceSystem/sourceRecordId. WP-4 wires
  it.

**S2 — pdfjs-dist worker under Vite/Tauri:**

- Not installed; Vite 7.3.6; no worker usage today.
- CSP (`apps/tauri/tauri.conf.json:84-85`): `worker-src 'self' blob:` ✓;
  `wasm-unsafe-eval` + `blob:` in script-src ✓ → worker + wasm feasible with no
  CSP changes.
- WP-2 approach: `pdfjs-dist` + `?worker` import →
  `GlobalWorkerOptions.workerPort`; add to `optimizeDeps.include` (pattern
  exists `vite.config.ts:34-36`); verify under `pnpm tauri dev` (manual test).
  Fallback: main-thread fake worker. Risk: jsdom/vitest needs text-layer-only
  tests or a mock.

**S3 — arbitrary-path read via `@tauri-apps/plugin-fs`:**

- plugin-fs ~2.5.1 already a dep (`apps/frontend/package.json:60`); used
  AppData-scoped (`apps/frontend/src/adapters/tauri/files.ts`).
- Capabilities (`apps/tauri/capabilities/desktop.json:13-24`):
  `fs:allow-read-file` ✓ but `fs:scope` = `$APPDATA/pending-exports/**` only →
  arbitrary paths DENIED today.
- Drag-and-drop needs NO plugin: `dragDropEnabled: false` (`tauri.conf.json:72`)
  → HTML5 drop → File → arrayBuffer (pattern:
  `pages/activity/import/components/file-dropzone.tsx`). v1 PDF intake works
  with zero capability changes.
- Watched folder (WP-6) reads Rust-side (notify) — no capability needed.
- plugin-fs arbitrary read only if JS must open paths directly. Options: widen
  scope (`$HOME/**` — needs security review), a scoped statements dir, a custom
  Rust command, or avoid (dnd + Rust watcher). Recommendation: avoid for v1.

Plus: WP-4 consumption-pattern note (vite alias + tsconfig paths + project
references — as addon-sdk does: `vite.config.ts:42-43`,
`apps/frontend/tsconfig.json:10-11,17-21`).

## 8. Verification

- `pnpm --filter @wealthfolio/statement-parsers test` — ported unit tests,
  golden fixtures, reconciliation hard gate (EOP 400000→377622, ES1
  100000→150000 balance chain, per product).
- Root: `pnpm test`, `pnpm lint`, `pnpm type-check`, `pnpm format:check`.
- Rust skipped: toolchain absent (PLAN §8), no Rust touched.
- `MANUAL-TESTS.md`: no additions (no UI / real-PDF surface in WP-1) — stated
  explicitly in the session log.

## 9. Privacy

Fixtures synthetic (portage `tests/fixtures/desjardins/README.md` attests). No
real statements, account numbers, or balances committed. Nothing copied from
outside portage's synthetic set.

## 10. Open questions

1. French months: PLAN §5 says `dates.ts` "incl. French month abbreviations";
   portage deliberately omits them (CSV dates are numeric; "don't ship untested
   code against an invented shape"). Proposal: port without; add in WP-3 against
   real PDF evidence. OK?
2. Seam rename `TransactionSource` → `StatementSource`. OK?
3. Root `test`-script edit (the single upstream edit). OK?
4. Pure-TS sync SHA-256 vs async Web Crypto (API change). Proposal: pure-TS. OK?
5. Package name / source-distribution / unpublished. OK?
6. Git pre-flight: `upstream` remote exists but has never been fetched (no
   `refs/remotes/upstream/*`). Coder runs `git fetch upstream` + verifies branch
   currency before build; if upstream moved → flag, don't auto-rebase. OK?
