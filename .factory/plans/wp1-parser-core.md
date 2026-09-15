# WP-1 implementation plan — parser core package + spike notes

Implements: `docs/specs/wp1-parser-core.md` (APPROVED — A1–A9, wiring, spike
content, OQs all settled; do not re-open decisions). Protocol:
`docs/statements/AGENTS.md` (additive-only, privacy, gates, docs duties). Scope:
`docs/statements/PLAN.md` §5 WP-1, §8 (Rust absent — TS only). Portage reference
(frozen, read-only): `/home/zied/Projects/portage` @ 92c8eac. Planned:
2026-09-13. Executor: coder (`opencode-go/kimi-k2.7-code`).

## Goal

New workspace package `packages/statement-parsers/` holding the portage parser
core ported faithfully (8 modules + new pure-TS `sha256.ts` + trimmed barrel),
ported tests (5 files + new `text.test.ts`) and synthetic fixtures, the
Desjardins CSV source as a secondary (bytes-based) source, plus
`docs/statements/NOTES.md` spike notes. Root TS gates green. Single upstream
edit: root `test` script. No Rust.

## Success criteria

- `pnpm --filter @wealthfolio/statement-parsers test` green, incl.
  reconciliation hard gate: EOP 400000 + Σ lines = 377622; ES1 100000 + Σ lines
  = 150000 (per product, `eop-clean.csv`).
- Root `pnpm test`, `pnpm lint`, `pnpm type-check`, `pnpm format:check` green.
- `docs/statements/NOTES.md` exists: S1 + S2 + S3 + WP-4 consumption note.
- `PLAN.md`: WP-1 → done; WP-0 locate/document checkbox → checked; §9 Q1+Q2
  resolved; one session-log line (incl. MANUAL-TESTS no-addition rationale).
- Zero real statement/account/balance committed; only portage's synthetic
  fixture set copied, byte-for-byte.
- Upstream diff = root `package.json` test-script line + `pnpm-lock.yaml`.

## Assumptions

- Spec decisions final; this plan reconciles two factual wrinkles without
  re-opening anything (see "Notes — reconciled discrepancies").
- Node 26 + `pnpm@10.33.4` ready; Rust/cargo absent → skip all cargo.
- Portage tree state as researched 2026-09-13 (fixture dir holds 10 CSVs).

## Step 0 — git pre-flight (coder, before any build)

```bash
cd /home/zied/Projects/wealthfolio
git branch --show-current        # MUST be zied/statements, else STOP
git status --short               # MUST be clean, else STOP
git fetch upstream               # remote exists, never yet fetched
git merge-base --is-ancestor upstream/main zied/statements \
  && echo CURRENT || echo MOVED
```

Stop conditions (STOP = report to owner, do not proceed, never auto-rebase):

- Branch is not `zied/statements`.
- `git status --short` shows anything other than this plan file and
  `docs/specs/wp1-parser-core.md` (if uncommitted). Those two are fork-additive
  docs: commit them on `zied/statements` first, then re-check. Any other dirt →
  STOP.
- `merge-base --is-ancestor` prints MOVED (upstream/main has commits not in our
  branch) → STOP and report.

## Slice ① — package scaffold + src port + package configs

Sequentially first; slice ② depends on it.

### Files (all new, under `/home/zied/Projects/wealthfolio/`)

- `packages/statement-parsers/package.json`
- `packages/statement-parsers/tsconfig.json`
- `packages/statement-parsers/vitest.config.ts`
- `packages/statement-parsers/eslint.config.js`
- `packages/statement-parsers/.prettierrc.cjs`
- `packages/statement-parsers/.prettierignore`
- `packages/statement-parsers/src/{types,text,decimal,dates,csv,sha256,hash,common,desjardins,index}.ts`

### Config contents (exact)

`package.json` — vitest devDep range: copy the `vitest` range from
`apps/frontend/package.json` at build time (do not invent a version):

```json
{
  "name": "@wealthfolio/statement-parsers",
  "private": true,
  "type": "module",
  "exports": { ".": "./src/index.ts" },
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "lint": "eslint .",
    "lint:fix": "eslint . --fix",
    "lint:quiet": "eslint . --quiet",
    "format": "prettier --write .",
    "format:check": "prettier --check .",
    "type-check": "tsc --noEmit"
  },
  "devDependencies": {
    "typescript": "^5.9.3",
    "vitest": "<match apps/frontend range>"
  }
}
```

Source-distributed, no build step, unpublished. No `build:types` script (so root
`pnpm -r run build:types` skips us). If package `type-check` later fails on
`node:*` imports or `Buffer` (tests use them), add `"@types/node"` with
apps/frontend's range — type-only devDep, still zero runtime deps; note it in
the session log.

`tsconfig.json` (A5; `composite: false` is required — base sets
`composite: true`, which conflicts with `noEmit`):

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "noEmit": true,
    "composite": false
  },
  "include": ["src/**/*", "tests/**/*"]
}
```

`vitest.config.ts` (spec §5 — node env, both include roots, no globals):

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts", "src/**/*.test.ts"],
    globals: false,
  },
});
```

`eslint.config.js` (addon-sdk pattern, no react; ignore `vitest.config.ts`
because it is outside the tsconfig include — addon-sdk does the same for
`tsup.config.ts`):

```js
import { createBaseConfig } from "../../eslint.base.config.js";

export default [
  {
    ignores: ["node_modules/**", "dist/**", "vitest.config.ts"],
  },
  ...createBaseConfig({
    includeReact: false,
    includeTanstackQuery: false,
    includeReactRefresh: false,
    tsconfigPath: "./tsconfig.json",
  }),
];
```

`.prettierrc.cjs` — TRAP: extend root, do NOT copy addon-sdk's style overrides
(90/singleQuote would fail on portage-styled code; root config is printWidth 100
/ double quotes / semi, which portage code matches):

```js
// Extend the root Prettier configuration.
// No style overrides: ported code is root-style (printWidth 100,
// double quotes, semi). Do not copy addon-sdk's 90/singleQuote overrides.
const baseConfig = require("../../.prettierrc.cjs");

module.exports = {
  ...baseConfig,
};
```

`.prettierignore` (sibling lines + fixtures — fixture bytes and the
portage-attested fixture README must never be reformatted):

```text
# Build outputs
dist/
build/

# Dependencies
node_modules/

# Generated files
*.d.ts

# Package files
package-lock.json
pnpm-lock.yaml

# Fixtures: byte-sensitive test data + portage-attested docs
tests/fixtures/
```

### Src port table (portage @ 92c8eac → package)

| package file        | portage source             | adapt |
| ------------------- | -------------------------- | ----- |
| `src/types.ts`      | `src/import/types.ts`      | A1    |
| `src/text.ts`       | `src/import/text.ts`       | A6    |
| `src/decimal.ts`    | `src/import/decimal.ts`    | A6    |
| `src/dates.ts`      | `src/import/dates.ts`      | none  |
| `src/csv.ts`        | `src/import/csv.ts`        | none  |
| `src/sha256.ts`     | (new, ~80 lines)           | A3    |
| `src/hash.ts`       | `src/import/hash.ts`       | A3    |
| `src/common.ts`     | `src/import/common.ts`     | A1    |
| `src/desjardins.ts` | `src/import/desjardins.ts` | A1+A2 |
| `src/index.ts`      | `src/import/index.ts`      | A7+A1 |

Per-file deltas (everything else verbatim, comments included):

- `src/types.ts` — rename interface `TransactionSource` → `StatementSource` and
  the two doc-comment mentions (header ~line 2, `RawTransaction.sourceId`
  comment ~line 144). `ImportBatch`, `FetchRequest`, `RawTransaction` keep
  names.
- `src/text.ts` — line 15 portage has a raw invisible U+FEFF inside quotes; emit
  `const BOM = "\uFEFF";` (A6).
- `src/decimal.ts` — line 20 portage has raw U+00A0 / U+202F / U+2009 inside the
  character class; emit `const GROUP_CHARS = /[ \u00A0\u202F\u2009']/gu;` (A6).
- `src/dates.ts` — verbatim. No French months (A8; OQ1 resolved: WP-3 adds them
  against real PDF evidence).
- `src/csv.ts` — verbatim.
- `src/sha256.ts` (new) — pure TS, sync, no deps:
  `export function sha256Hex(input: string): string` — TextEncoder UTF-8 → FIPS
  180-4 SHA-256 (K constants, 64-round schedule, padding) → lowercase hex.
  Internal module: NOT re-exported from the barrel; only `hash.ts` imports it.
- `src/hash.ts` — import `sha256Hex` from `./sha256.ts`; `importHash` body
  becomes `return sha256Hex(importHashPreimage(input));` (stays sync, A3).
  Header comment line ~9 ("SHA-256 comes from `Bun.CryptoHasher`") → say SHA-256
  is the pure-TS `sha256.ts`, sync. Comment ~line 169 `TransactionSource` →
  `StatementSource` (A1).
- `src/common.ts` — header comment line 2 `TransactionSource` →
  `StatementSource` (A1). Rest verbatim.
- `src/desjardins.ts` —
  - A1: `import { type StatementSource }` + `implements StatementSource`.
  - A2: options become
    `{ bytes: Uint8Array | ArrayBuffer; name: string; currency: CurrencyCode; layout?: CsvLayout | undefined }`
    (keep portage's currency doc-comment; document `bytes` as the raw export
    bytes and `name` as the file name used for locations — basename stored,
    never a full path). `fetch` reads bytes from options (no `Bun.file`, no fs):
    `const file = basename(name); const raw = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);`
    then the unchanged OFX guard + `readCsv(raw, file, currency, layout)` flow.
  - Trim the now-false header sentence referencing `ofx-source.ts` (~lines 6–9);
    keep the rest of the header (CSV-only, PDF not read, boundary holds).
  - TypeError message: keep "`${file}` is an OFX document; Desjardins publishes
    CSV only." — drop the trailing "Use OfxFileSource for OFX." sentence (class
    not ported, A7). Test regex still matches.
- `src/index.ts` — portage barrel minus the `ofx-source` block and the `write`
  block (A7); `TransactionSource` → `StatementSource` in the type export list
  (A1); header comment updated (seam + desjardins + hash; no ofx/write).
  Exports: types block (incl. `StatementSource`),
  `calendarDate`/`isCalendarDate`/`money`, `detectFormat`, desjardins block
  (`DESJARDINS_EOP_LAYOUT`, `DESJARDINS_SOURCE_ID`, `DesjardinsFileSource`,
  `CsvLayout`, `DesjardinsFileSourceOptions`), hash block
  (`IMPORT_HASH_VERSION`, `accountKey`, `importHash`, `importHashPreimage`,
  `normaliseForHash`, `ImportHashInput`).

### Actions

1. Step 0 pre-flight passed.
2. Create config files (contents above).
3. Port the 10 src files per table + deltas. Keep `.ts`-extension relative
   imports (A9). Keep all other portage doc-comments verbatim.
4. Root `pnpm install` (registers workspace package, installs devDeps, updates
   `pnpm-lock.yaml` — this is upstream edit #2 of 2). If the lockfile diff is
   anything beyond the new importer entry (+ shared-store links), STOP and
   report.

### Done when

- `pnpm --filter @wealthfolio/statement-parsers type-check` green (src only;
  `tests/**/*` include matches nothing yet — fine).
- `pnpm --filter @wealthfolio/statement-parsers lint` green (warnings
  acceptable).
- `pnpm --filter @wealthfolio/statement-parsers format:check` green; if ported
  lines fail, run `... format` (formatting-only rewrap, semantics untouched) and
  note the file count in the session log.

## Slice ② — tests + fixtures port (after ①)

### Files (all new)

- `packages/statement-parsers/tests/{csv,dates,decimal,hash,desjardins,text}.test.ts`
- `packages/statement-parsers/tests/fixtures/desjardins/` — 10 CSVs +
  `README.md` (byte-for-byte from portage): `eop-clean.csv`,
  `eop-clean-ascii.csv`, `eop-quoting.csv`, `eop-invalid.csv`,
  `eop-overlap.csv`, `category-same-merchant.csv`,
  `category-same-merchant-ascii.csv`, `category-same-fold-other-account.csv`,
  `category-transfer-near-miss.csv`, `transfer-near-miss-four-days.csv`,
  `README.md`.

### Test adaptations (per file)

All files: `import { describe, expect, test } from "bun:test"` → `from "vitest"`
(A4). Nothing else unless listed.

- `tests/csv.test.ts` — A6: the BOM literal (portage line 17, raw U+FEFF)
  becomes `parseCsv("\uFEFF00815,0000101\r\n")`.
- `tests/dates.test.ts` — vitest import only.
- `tests/decimal.test.ts` — A6: portage lines 9–10 hold raw U+00A0 and U+202F
  inside two visually identical `"1 987,65"` literals; emit `"1\u00A0987,65"`
  and `"1\u202F987,65"` with a one-line comment saying which is which.
- `tests/hash.test.ts` —
  - Add `import { createHash } from "node:crypto";` and
    `import { sha256Hex } from "../src/sha256.ts";`.
  - "the recipe is pinned": replace the `Bun.CryptoHasher` cross-check with
    `createHash("sha256").update(importHashPreimage(BASE), "utf8").digest("hex")`.
    Keep the pinned preimage literal unchanged (golden test, A3).
  - Add `describe("sha256")` block (A3 — known vectors + node:crypto
    cross-check):
    - `sha256Hex("")` →
      `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`
    - `sha256Hex("abc")` →
      `ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad`
    - `sha256Hex("abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq")` →
      `248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1`
      (two-block padding path)
    - cross-check vs `node:crypto` on `"portage"`,
      `"Épicerie du Coin, 1 234,56 $"`, `"a".repeat(1000)` (non-ASCII +
      multi-block).
- `tests/desjardins.test.ts` —
  - Imports: vitest; `readFile` from `node:fs/promises`; `fileURLToPath` from
    `node:url`; `join` from `node:path`. Drop `node:fs` sync fns + `node:os`
    (temp-file test reworked, see below).
  - `const FIXTURES = join(fileURLToPath(new URL(".", import.meta.url)), "fixtures", "desjardins");`
    (replaces `import.meta.dir` + `..`).
  - Helper (A2):
    `async function source(name, currency = "CAD") { return new DesjardinsFileSource({ bytes: await readFile(join(FIXTURES, name)), name, currency }); }`
    — callers `await source(...)`.
  - Byte-shape tests: `await Bun.file(...).bytes()` → `await readFile(...)`
    (Buffer is a Uint8Array; indexed reads, `includes(0xe9)`, fatal TextDecoder
    all work unchanged).
  - OFX-guard test: ofx fixtures are not ported; use inline synthetic bytes
    (keep portage's explanatory comment):
    `new TextEncoder().encode("OFXHEADER:100\r\n\r\n<OFX>\r\n")` as `bytes`,
    `name: "statement-clean.ofx"`; same
    `rejects.toThrow(/OFX document; Desjardins publishes CSV only/)`.
  - CP1252 test (A2+A4): drop mkdtemp/writeFileSync/rmSync scaffolding — bytes
    come directly from `Buffer.from(row, "latin1")` (that exact expression
    stays); `name: "cp1252.csv"`; same assertions.
  - DROP the test "a missing file rejects rather than returning an empty batch"
    — A2 removed path I/O, the premise is gone. Note in session log.
  - Everything else verbatim (all describes/tests/comments).
- `tests/text.test.ts` (new) — port ONLY `ofx.test.ts` lines 85–96 (the
  `decodeBytes` describe block, comments included); imports: vitest +
  `decodeBytes` from `../src/text.ts`. Do NOT port the rest of ofx.test.ts.

### Fixtures

Copy byte-for-byte with `cp` (never clipboard/editor — CP1252 bytes must
survive; the ported byte-shape tests verify: opens `0d 0a 22`, contains `0xe9`,
fatal UTF-8 decode throws):

```bash
mkdir -p packages/statement-parsers/tests/fixtures/desjardins
cp /home/zied/Projects/portage/tests/fixtures/desjardins/*.csv \
   /home/zied/Projects/portage/tests/fixtures/desjardins/README.md \
   packages/statement-parsers/tests/fixtures/desjardins/
```

Privacy gate: nothing else from portage's `tests/fixtures/` (no ofx fixtures);
nothing from outside portage's synthetic set; no real statement/account
number/balance anywhere in the diff.

### Actions

1. Port the 6 test files per adaptations.
2. Copy fixtures per above; spot-check `eop-clean.csv` first bytes (`0d 0a 22`)
   and that `0xe9` is present.

### Done when

- `pnpm --filter @wealthfolio/statement-parsers test` green — all 6 files, incl.
  reconciliation hard gate (EOP 400000→377622, ES1 100000→150000) and the
  10-problem rejection table on `eop-invalid.csv`.
- `pnpm --filter @wealthfolio/statement-parsers type-check` green (tests now
  included).
- `pnpm --filter @wealthfolio/statement-parsers lint` green.

## Slice ③ — workspace wiring + root gates (after ①+②)

### Files (modify)

- `/home/zied/Projects/wealthfolio/package.json` — the single upstream edit.
  Test script only:

```text
old: "test": "pnpm --filter frontend test && node --test scripts/__tests__/",
new: "test": "pnpm --filter frontend test && pnpm --filter @wealthfolio/statement-parsers test && node --test scripts/__tests__/",
```

- `pnpm-lock.yaml` — already updated by slice ① `pnpm install`; no further
  action (scripts do not affect the lockfile).

Workspace glob (`packages/*`), eslint (`-r`), type-check (`-r`), prettier (root)
pick the package up automatically. Root `tsconfig.json` references are an
explicit list — do NOT add us (we are `composite: false`, `noEmit`).

### Actions

1. Edit root `package.json` test script per above. Touch nothing else.

### Done when (verification ladder — exact commands)

```bash
pnpm test          # frontend + statement-parsers + scripts/__tests__ all green
pnpm lint          # green; warnings acceptable
pnpm type-check    # green (build:types skips us; our tsc --noEmit runs via -r)
pnpm format:check  # green (root prettier + pnpm -r format:check)
```

Rust: SKIP. `cargo test` / `cargo clippy` are NOT run — toolchain absent (PLAN
§8), no Rust touched. Tester: do not attempt cargo.

## Slice ④ — NOTES.md + PLAN.md docs (last)

### Files

- `/home/zied/Projects/wealthfolio/docs/statements/NOTES.md` (new)
- `/home/zied/Projects/wealthfolio/docs/statements/PLAN.md` (edit)

### NOTES.md content

Structure: title + one-paragraph intro (dated spike notes, file:line evidence,
recorded in WP-1), then four sections. Content source: spec §7 — transcribe its
facts; spot-check the file:line refs before writing each (they were verified at
spec time; refs to check: `crates/core/src/accounts/accounts_constants.rs:102`,
`crates/core/src/activities/activities_service.rs:877-896`,
`crates/core/src/activities/idempotency.rs:27`,
`crates/core/src/portfolio/snapshot/holdings_calculator/mod.rs:494-511`,
`apps/frontend/src/features/spending/lib/constants.ts:112-159`,
`apps/tauri/tauri.conf.json:72` + `:84-85`,
`apps/tauri/capabilities/desktop.json:13-24`, `apps/frontend/package.json:60`,
`apps/frontend/vite.config.ts:34-36` + `:42-43`,
`apps/frontend/tsconfig.json:10-11,17-21`,
`apps/frontend/src/adapters/tauri/files.ts`; locate the two frontend mirrors
`activity-import-profile.ts:61-67` and `draft-utils.ts:484-492` via grep).

- `## S1 — CREDIT_CARD sign / spending semantics` (resolves PLAN §9 Q1): card =
  only liability account type; server-enforced card activities (WITHDRAWAL,
  TRANSFER_IN, CREDIT, FEE, INTEREST) + frontend mirrors; spending math
  (WITHDRAWAL/FEE/INTEREST → +|amt|; CREDIT → −|amt| refund; TRANSFER_IN → 0 — a
  payment never spends; card income never counts); balance side (card INTEREST →
  charge/debt up; TRANSFER_IN → payment/debt down); importer mapping rule (D6:
  purchase → WITHDRAWAL "Charge", payment → TRANSFER_IN "Payment", refund →
  CREDIT; Wealthfolio encodes direction in activityType with positive magnitudes
  — differs from portage's signed Money; WP-4/WP-5 importer maps sign → type);
  dedup: `idempotency_key` computed server-side (SHA-256 over
  account|type|date|…| provider_reference_id←source_record_id|description), DB
  upsert on conflict; `ActivityImport` carries no idempotencyKey — our hash
  rides via sourceSystem/sourceRecordId; WP-4 wires it.
- `## S2 — pdfjs-dist worker under Vite/Tauri` (WP-2 input): not installed; Vite
  7.3.6; CSP allows `worker-src 'self' blob:` + `wasm-unsafe-eval` + `blob:` in
  script-src → worker + wasm feasible, no CSP changes; WP-2 approach:
  `pdfjs-dist` + `?worker` import → `GlobalWorkerOptions. workerPort`; add to
  `optimizeDeps.include` (pattern exists); verify under `pnpm tauri dev` (manual
  test); fallback main-thread fake worker; risk: jsdom/vitest needs
  text-layer-only tests or a mock.
- `## S3 — arbitrary-path read via @tauri-apps/plugin-fs` (WP-6 input):
  plugin-fs ~2.5.1 already a dep, used AppData-scoped; capabilities allow
  `fs:allow-read-file` but scope = `$APPDATA/pending-exports/**` only →
  arbitrary paths DENIED today; drag-and-drop needs NO plugin
  (`dragDropEnabled: false` → HTML5 drop → File → arrayBuffer; pattern:
  file-dropzone.tsx) — v1 PDF intake works with zero capability changes; watched
  folder (WP-6) reads Rust-side (notify) — no capability needed; options if JS
  must open paths directly (widen scope `$HOME/**` — security review; scoped
  statements dir; custom Rust command; avoid) — recommendation: avoid for v1.
- `## WP-4 — consumption pattern for packages/statement-parsers`: vite alias +
  tsconfig paths + project references, as addon-sdk does
  (`vite.config.ts:42-43`, `apps/frontend/tsconfig.json:10-11,17-21`).

Write wrapped at 80 / proseWrap-always (root prettier formats md); or run
`pnpm exec prettier --write docs/statements/NOTES.md` after drafting.

### PLAN.md edits (four, surgical)

1. §5 WP table: WP-1 row status `pending` → `**done**`.
2. §5 WP-0 checklist:
   `- [ ] Locate and document the activity/CSV import feature and its interfaces.`
   → `- [x] …` (same text, checked).
3. §9: first bullet (CREDIT_CARD sign/spending semantics) → append "— **resolved
   (WP-1)**: `NOTES.md` S1."; second bullet (activity/CSV import feature
   location/interfaces) → append "— **resolved (WP-1)**: `NOTES.md` S1 + WP-4
   note." Other bullets untouched.
4. §10 session log — append one entry (match existing shape), stating: WP-1 done
   (package ported: 8 modules + `sha256.ts` + trimmed barrel; 6 test files;
   fixtures — spec said 9 CSVs, portage dir holds 10, all synthetic, ported all
   10); NOTES.md S1–S3 + WP-4 note; root test-script edit + lockfile; gates
   green TS-only; MANUAL-TESTS.md no additions — WP-1 has no UI / real-PDF
   surface; dropped portage's "missing file rejects" test (premise removed by A2
   bytes options); **Next:** WP-2 (pdfjs-dist positioned text); **Blocked:**
   Rust toolchain + `libappindicator-gtk3` (sudo).

`MANUAL-TESTS.md`: NOT edited (rationale lives in the session log line).
`docs/specs/wp1-parser-core.md`: NOT edited (approved record). `CONTEXT.md`: NOT
edited (StatementSource seam already glossed).

### Actions

1. Write NOTES.md; spot-check refs; prettier-format it.
2. Apply the four PLAN.md edits.

### Done when

- `pnpm exec prettier --check docs/statements/NOTES.md` green.
- PLAN.md shows: WP-1 done, WP-0 box checked, §9 Q1/Q2 resolved, new session-log
  entry.
- Full ladder re-run green (docs only affect format:check, but cheap):
  `pnpm test && pnpm lint && pnpm type-check && pnpm format:check`.

## Port-fidelity checklist (coder self-check + reviewer)

- A1 rename: `grep -rn "TransactionSource" packages/statement-parsers/` → 0
  hits. `StatementSource` present in types.ts (interface + comments),
  desjardins.ts (import + implements), common.ts header, hash.ts comment,
  index.ts exports. `ImportBatch`/`FetchRequest`/`RawTransaction` unchanged.
- A2 bytes: `src/desjardins.ts` has no `Bun.file`, no `node:fs`; options
  `{ bytes, name, currency, layout? }`; `SourceLocation.file` =
  `basename(name)`; OFX `TypeError` guard kept (message without the
  `OfxFileSource` sentence).
- A3 sha256: `src/sha256.ts` pure TS + sync; `importHash` sync via `sha256Hex`;
  golden preimage literal pinned in hash.test.ts; sha256 describe block: 3 known
  vectors + node:crypto cross-check.
- A4 runner:
  `grep -rn "bun:test\|import\.meta\.dir\|Bun\." packages/statement-parsers/` →
  0 hits. `readFile` + `fileURLToPath` in desjardins.test.ts;
  `Buffer.from(row, "latin1")` kept in CP1252 test.
- A5 tsconfig: extends base; `noUncheckedIndexedAccess` +
  `exactOptionalPropertyTypes` + `noEmit: true` + `composite: false`; include
  src + tests.
- A6 escapes: text.ts `"\uFEFF"`; decimal.ts `/[ \u00A0\u202F\u2009']/gu`;
  csv.test.ts `"\uFEFF…"` literal; decimal.test.ts NBSP/narrow-NBSP literals
  escaped + comment. Fixtures byte-identical to portage (`diff -r` the fixture
  dir against portage's).
- A7 barrel: index.ts exports types + helpers + detectFormat + desjardins + hash
  only; no ofx, no write.
- A8 dates: dates.ts verbatim; no French-month code.
- A9 imports: every relative import in src/ + tests/ ends `.ts`.
- Comments: portage doc-comments verbatim EXCEPT the three forced trims
  (desjardins.ts header ofx sentence; TypeError `OfxFileSource` sentence;
  hash.ts `Bun.CryptoHasher` line) + A1 renames.
- Privacy: committed fixture set = portage's desjardins dir only; all synthetic
  (README attests); no real statement/account/balance in the whole diff.

## Risks & rollback

- Fixture re-encoding (CP1252 → UTF-8 via clipboard/editor): copy with `cp`;
  byte-shape tests catch it (0xE9 present, fatal UTF-8 throws).
- Prettier trap: addon-sdk's `.prettierrc.cjs` values must NOT be copied
  (90/singleQuote vs portage's 100/double). Root-extend config only.
- `pnpm install` lockfile churn beyond the new importer → STOP, report.
- Upstream moved at pre-flight → STOP, report. Never auto-rebase.
- Missing `@types/node` for `node:*`/`Buffer` in tests → add it (frontend's
  range), note in session log; still zero runtime deps.
- Expected lint warning `require-await` on `async fetch` (no await under A2) —
  leave it; the seam stays async. Do not "fix" the interface.
- Rollback: everything is additive.
  `git checkout -- package.json pnpm-lock.yaml`;
  `rm -rf packages/statement-parsers`; revert `docs/statements/NOTES.md` +
  `PLAN.md`. Branch `zied/statements` only.

## Notes — reconciled discrepancies (not re-opened decisions)

1. Fixture count: spec §2/§3 says "9 CSVs"; portage's
   `tests/fixtures/desjardins/` holds 10 (5 `eop-*`, 4 `category-*`,
   `transfer-near-miss-four-days.csv`). Ported tests read only 4; overlap is
   README-documented; category/transfer fixtures serve unported portage suites
   but are synthetic and plausibly useful in WP-4/WP-5. Resolution: port ALL 10
   (satisfies the spec's own `*.csv` glob; all synthetic). State the count in
   the session log. Do not drop one to force 9.
2. Prettier "mirroring siblings" = the extend-root pattern (ui-style), not
   addon-sdk's override values — spec's own "style already matches (printWidth
   100, double quotes, semi)" line confirms root values.
3. A2 test consequences (spec A4 names only the CP1252 technique): OFX-guard
   test → inline synthetic OFX bytes (ofx fixtures not in the port inventory);
   CP1252 test → bytes direct from `Buffer.from(row, "latin1")`, temp-file
   scaffolding dropped; "missing file rejects" test → dropped (no path I/O
   remains). All noted in the session log.
4. eslint ignores `vitest.config.ts` (outside tsconfig include; addon-sdk
   precedent with `tsup.config.ts`).

## Unresolved questions

None — spec approved; the discrepancies above are reconciled facts, not open
decisions.
