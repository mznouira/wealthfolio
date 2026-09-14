# Statements — spike notes

Dated spike notes recorded during WP-1. Every claim below is tied to a file:line
in the repo as of 2026-09-14.

## S1 — CREDIT_CARD sign / spending semantics

Card semantics resolve PLAN §9 Q1.

- **Card = only liability account type.**
  `crates/core/src/accounts/accounts_constants.rs:102`
  `is_liability_account_type` matches only `account_types::CREDIT_CARD`.

- **Server-enforced allowed activities.**
  `crates/core/src/activities/activities_service.rs:877-896`
  `account_activity_validation_message` rejects any activity type other than
  `WITHDRAWAL`, `TRANSFER_IN`, `CREDIT`, `FEE`, or `INTEREST` for `CREDIT_CARD`.
  Frontend mirrors:
  `apps/frontend/src/pages/activity/import/utils/activity-import-profile.ts:61-67`
  defines `CREDIT_CARD_ACTIVITY_TYPES`, and `:136-144` publishes the card
  profile with labels (`Charge`, `Payment`, `Refund / Credit`,
  `Interest Charge`).
  `apps/frontend/src/pages/activity/import/utils/draft-utils.ts:484-492` rejects
  disallowed types for card accounts in import validation.

- **Spending math.**
  `apps/frontend/src/features/spending/lib/constants.ts:112-159`
  `getActivitySpendingAmount`: for a card account, `WITHDRAWAL`/`FEE`/`INTEREST`
  contribute `+|amt|`; `CREDIT` contributes `-|amt|` (a refund); `TRANSFER_IN`
  contributes `0` because a payment never spends. Card income never counts as
  spending.

- **Balance-side handling.**
  `crates/core/src/portfolio/snapshot/holdings_calculator/mod.rs:494-511`
  `INTEREST` on a card dispatches to `handle_charge` (debt up); `TRANSFER_IN`
  dispatches to `handle_transfer_in` (debt down).

- **Importer mapping rule (D6).** `activity-import-profile.ts:140-142` encodes
  direction in `activityType` with positive magnitudes: purchase → `WITHDRAWAL`
  "Charge", payment → `TRANSFER_IN` "Payment", refund → `CREDIT`. This differs
  from portage's signed `Money`; the WP-4/WP-5 importer will map statement sign
  → Wealthfolio activity type.

- **Dedup.** `crates/core/src/activities/idempotency.rs:27` computes
  `idempotency_key` server-side with SHA-256 over account, type, date,
  asset/quantity/price/amount, fee, currency, `provider_reference_id`, and
  description. `crates/core/src/activities/activities_service.rs:6201-6206`
  exposes `check_existing_duplicates`; `:6220-6259` performs
  `upsert_activities_bulk`. `ActivityImport`
  (`crates/core/src/activities/activities_model.rs:962-1049`) carries no
  `idempotency_key` field. Today `build_import_idempotency_key`
  (`activities_service.rs:1841-1904`) passes `None` for `provider_reference_id`,
  so our content hash must ride via `source_system`/`source_record_id` once WP-4
  wires the importer to the existing upsert path.

## S2 — pdfjs-dist worker under Vite/Tauri

Input for WP-2.

- `pdfjs-dist` is not installed today. Frontend uses Vite `^7.3.6`
  (`apps/frontend/package.json:114`). No worker usage exists in the frontend
  bundle.

- CSP already permits the worker path. `apps/tauri/tauri.conf.json:84-85` sets
  `worker-src 'self' blob:` and includes `'wasm-unsafe-eval' blob:` in
  `script-src`. No CSP changes are needed for a `pdfjs-dist` worker.

- WP-2 approach: install `pdfjs-dist`; import its worker with `?worker` and
  assign it to `GlobalWorkerOptions.workerPort`; add `pdfjs-dist` to
  `optimizeDeps.include` following the existing pattern at
  `apps/frontend/vite.config.ts:34-36`. Verify under `pnpm tauri dev` as a
  manual test.

- Fallback: force the main-thread fake worker if bundling the real worker fails.

- Test risk: jsdom/vitest cannot run the real PDF worker. WP-3 tests should use
  text-layer-only fixtures or a `pdfjs-dist` mock.

## S3 — Arbitrary-path read via @tauri-apps/plugin-fs

Input for WP-6 and v1 intake design.

- `@tauri-apps/plugin-fs` ~2.5.1 is already a dependency
  (`apps/frontend/package.json:60`). Current usage is AppData-scoped:
  `apps/frontend/src/adapters/tauri/files.ts` reads and writes only under
  `BaseDirectory.AppData` (`pending-exports/**`, `pending-restores/**`).

- Capabilities deny arbitrary paths today.
  `apps/tauri/capabilities/desktop.json:13-24` grants `fs:allow-read-file` but
  scopes it to `$APPDATA/pending-exports/**`. Reading a user-selected path
  outside that tree is denied.

- Drag-and-drop needs no plugin. `apps/tauri/tauri.conf.json:72` sets
  `dragDropEnabled: false`, so the HTML5 drop event fires normally. The frontend
  receives a `File`, calls `arrayBuffer()`, and passes bytes to the parser. This
  pattern is already used in
  `apps/frontend/src/pages/activity/import/components/file-dropzone.tsx`. v1 PDF
  intake works with zero capability changes.

- Watched folder reads (WP-6) will run Rust-side using `notify`, not
  `@tauri-apps/plugin-fs`, so no capability expansion is required.

- If JS-side direct path reads ever become necessary, options are: widen the
  `fs:scope` (security review needed), introduce a scoped `statements/` dir, add
  a custom Rust command, or avoid the need entirely. Recommendation for v1:
  avoid; rely on HTML5 drag-and-drop and the Rust watcher.

## WP-4 — Consumption pattern for packages/statement-parsers

The frontend will consume `packages/statement-parsers` the same way it consumes
`@wealthfolio/addon-sdk` and `@wealthfolio/ui`: a Vite `resolve.alias`
(`apps/frontend/vite.config.ts:42-43`) plus a `tsconfig.json` path and project
reference (`apps/frontend/tsconfig.json:10-11,17-21`). When WP-4 adds the
statement import feature, the alias entry for `@wealthfolio/statement-parsers`
will be added alongside the existing two.
