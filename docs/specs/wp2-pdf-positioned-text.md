---

# WP-2 Spec — PDF → positioned text (pdfjs-dist)

Status: **approved for implementation**. Design decisions W2-D1..W2-D12 are
locked — the coder implements them, resolves the marked "coder verifies"
build-time unknowns against the installed package, and does not re-open
decisions. Scope source: `docs/statements/PLAN.md` §4, §5 WP-2, §8. Inputs:
`docs/statements/NOTES.md` S2 (worker feasibility),
`docs/specs/wp2-session-prompt.md`. Facts below verified 2026-09-14.

## 1. Goal

Institution-agnostic PDF → positioned-text layer in
`packages/statement-parsers`: load PDF bytes with `pdfjs-dist`, reconstruct
`PageLine[] { page, y, cells: { x, text }[] }` from text items so right-aligned
money lands in the correct column, and handle multi-page documents. Plus a
deterministic synthetic PDF fixture generator (pdf-lib), a golden end-to-end
test, unit tests for the reconstruction rules, and a dev-only frontend probe
page that verifies the real browser worker under `pnpm tauri dev` and
`pnpm run dev:web`. No Desjardins grammar in `src/` (that is WP-3); the WP-7
upstream seam stays clean.

## 2. In scope / out

In:

- `src/pdf/` module (5 files) + `./pdf` subpath export; `pdfjs-dist` dep.
- Pure reconstruction (`lines.ts`) + unit tests (`tests/pdf-lines.test.ts`).
- Synthetic PDF generator (committed script, never a binary) + golden test
  (`tests/pdf-golden.test.ts`).
- Frontend dev-only probe page + conditional dev route (5 upstream edits).
- `MANUAL-TESTS.md` entry (owner-run).
- One-time `cargo check` baseline (recorded, not a gate).
- `PLAN.md` / `CONTEXT.md` updates.

Out (later WPs): Desjardins grammar and `ImportProblem` mapping (WP-3);
tolerance tuning against real statements (WP-3); import-flow UI (WP-4); card
parsers (WP-5); folder intake (WP-6); any Rust change; any CSP change (verified
unnecessary — `worker-src 'self' blob:` already in both `csp` and `devCsp`,
`apps/tauri/tauri.conf.json:84-85`).

## 3. Design decisions

### W2-D1 — pdfjs-dist placement: `./pdf` subpath export

`packages/statement-parsers/package.json` gains `"./pdf": "./src/pdf/index.ts"`
beside the existing `"."` export. `pdfjs-dist` becomes a package **dependency**,
imported ONLY under `src/pdf/*`. `src/index.ts` is untouched — the main entry
stays zero-dep; the `StatementSource` seam is unchanged.

Rationale: consumers that don't parse PDF pay nothing (nothing pdfjs-related
enters their graph through `.`); the WP-7 upstream seam stays clean — proposing
a PDF layer upstream never forces `pdfjs-dist` on the CSV-only path.

### W2-D2 — Versions

`pdfjs-dist` exact-pinned `"6.3.289"` (no caret). `pdf-lib` `"^1.17.1"` as
devDependency (fixture generator only).

Rationale: the worker entry path, the exports map, and the fake-worker global
are version-coupled pdfjs internals — a floating range could silently shift them
under a lockfile refresh. Upgrades must be deliberate: re-verify the worker
path + fake-worker mechanism, and re-review the golden dump. `pdf-lib` is
test-only, so a caret is fine. Facts checked 2026-09-14: 6.3.289 is the current
stable on npm; engines `>=22.13.0 || >=24` (local Node 26.8.1 OK); ships types
(`types/src/pdf.d.ts`); Apache-2.0; optional `@napi-rs/canvas` is only needed
for rendering, not text extraction.

### W2-D3 — Browser worker strategy

`src/pdf/worker.ts` is a browser-only module with a STATIC import:

```ts
import PdfWorker from "pdfjs-dist/build/pdf.worker.min.mjs?worker";
```

(coder verifies the exact worker file path against the installed package's
`build/` dir and exports map; use whichever minified worker entry exists). It
exports `installPdfWorker(): Promise<PdfWorkerMode>` which assigns
`GlobalWorkerOptions.workerPort = new PdfWorker()` exactly once — a module-level
singleton promise; concurrent calls await the same promise — and records the
mode on success (`"worker-port"`; `"main-thread"` if the fallback ran;
`"not-configured"` until then). `src/pdf/index.ts` calls it before
`getDocument`, guarded by

```ts
typeof window !== "undefined" &&
  typeof document !== "undefined" &&
  typeof Worker !== "undefined";
```

(true only in a real browser; node-env vitest and jsdom both skip it — jsdom has
`window`/`document` but no `Worker`). **The guard wraps a dynamic
`import("./worker.ts")`** — deliberate: a static import would put the `?worker`
specifier into node-env vitest's module graph, where it cannot resolve; the
dynamic import keeps `worker.ts` (and its worker bundle) out of non-browser
programs entirely, while Vite still bundles it as a lazy chunk in the browser.

If worker construction fails (e.g. CSP), fallback per NOTES S2: main-thread fake
worker via
`globalThis.pdfjsWorker = await import("pdfjs-dist/build/pdf.worker.mjs")` —
coder verifies the actual v6 fake-worker global mechanism by reading the
installed pdfjs-dist source and adapts if the name changed.

Mode state lives in a tiny `src/pdf/worker-mode.ts` (no pdfjs imports):
`type PdfWorkerMode = "worker-port" | "main-thread" | "not-configured"`,
`setPdfWorkerMode`, `pdfWorkerMode`. `worker.ts` sets it; the `./pdf` entry
re-exports the getter — the dev probe displays it. (The separate state module is
what lets `index.ts` re-export the getter without statically importing
`worker.ts`.)

A local ambient declaration `src/pdf/worker-types.d.ts` declares
`module "*?worker"` (the package tsconfig has no vite/client). The frontend
program already references vite/client (`apps/frontend/src/vite-env.d.ts`), so
the same import type-checks there; the two declarations never coexist in one
program (frontend include is `src` only; package include is the package dir
only).

Rationale: NOTES S2 approach — `workerPort` + blob-worker CSP already allowed,
zero CSP edits; singleton because pdfjs takes one worker port and repeated
parses must reuse it (manual test re-parses the same file); the mode getter
because the manual test's pass/fail criterion is which strategy actually ran —
invisible without it.

### W2-D4 — Node/vitest strategy: real pdfjs, no mocking

In node-env vitest no worker is configured → pdf.js auto-detects Node and runs
the fake worker on the main thread; text-layer only (no canvas, no rendering —
`@napi-rs/canvas` never needed). The golden test is therefore a true end-to-end
test: pdf-lib bytes → real pdfjs text extraction → reconstruction → assertions.

Plan B (only if the standard build fails in Node): add a `resolve.alias` in
`packages/statement-parsers/vitest.config.ts` mapping `"pdfjs-dist"` →
`"pdfjs-dist/legacy/build/pdf.mjs"`.

Rationale: mocking pdfjs would test our mock, not the extraction — the whole
point of the golden test is that real pdfjs item geometry flows through real
reconstruction. NOTES S2's jsdom/mock risk is avoided by keeping pdfjs out of
jsdom entirely (package tests are node-env; no frontend test imports the pdf
layer — the probe page is lazy and dev-routed).

### W2-D5 — Public API

`src/pdf/index.ts`:

```ts
export interface PageCell {
  readonly x: number;
  readonly text: string;
}

export interface PageLine {
  readonly page: number;
  readonly y: number;
  readonly cells: readonly PageCell[];
}

export async function extractPageLines(bytes: Uint8Array): Promise<PageLine[]>;
```

No options object — tuning tolerances is deferred to WP-3, where real-statement
evidence exists (deliberate: don't ship knobs nobody has evidence to turn). The
input is copied once (`bytes.slice()`) before `getDocument` so the caller's
buffer is never detached/transferred (pdfjs transfers `Uint8Array` data to the
worker). pdfjs errors (`InvalidPDF`, `Password`, …) propagate as-is; WP-3/WP-4
map them to `ImportProblem`. Document lifecycle: per-page `page.cleanup()`,
`doc.destroy()` in `finally`.

Rationale: minimal surface; the copy is required for correctness (detaching the
caller's buffer is real pdfjs behavior, not hypothetical); lifecycle hygiene
keeps repeated parses (the worker-reuse manual test) from leaking.

### W2-D6 — Reconstruction rules

`src/pdf/lines.ts`, pure
`buildPageLines(page: number, items: TextItemLike[]): PageLine[]`:

1. Drop items whose `str` is blank/whitespace-only.
2. Position from `transform[4]` (x) and `transform[5]` (y); width/height from
   the item (handle `noUncheckedIndexedAccess` idiomatically).
3. Sort items by y DESC, then x ASC.
4. y-clustering, gap-based: start a new line when the baseline gap to the
   previous item exceeds `Y_TOLERANCE = 2` (pt). Handles same-row baseline
   jitter (≤2 pt, e.g. mixed font sizes) while splitting distinct rows (row
   pitch ≥ ~9 pt) and wrapped description lines. Line `y` = the topmost item's
   y.
5. Within a line, sort by x ASC. Merge adjacent items into cells: start a new
   cell when the horizontal gap `item.x − (prev.x + prev.width)` exceeds
   `CELL_GAP_FACTOR (0.5) × max(prev.height, item.height)`. Cell `x` = first
   item's x. Cell text = item strs joined with a single space, then
   `collapseWhitespace` (reuse `../text.ts`).
6. Negative/zero gaps (overlapping items) merge.
7. Multi-page: pages 1-based; lines ordered page ASC then y DESC (top of page
   first — PDF y grows upward).

Module-level documented constants for the two tolerances.

Rationale (cell gap): word gaps scale with font size (~0.28 × size) while column
gaps are tens of pt, so a half-character-height threshold separates them across
font sizes — a fixed pt threshold would break between the 8 pt body and a 12 pt
title. Rationale (y): 2 pt absorbs baseline jitter without merging rows whose
pitch is ≥ ~9 pt in the synthetic geometry (and typical real statements); the
value is revisited in WP-3 against a real sample.

### W2-D7 — Purity of the reconstruction

`lines.ts` imports NOTHING from pdfjs-dist. It defines a minimal structural
interface, exported from the `./pdf` entry:

```ts
export interface TextItemLike {
  str: string;
  transform: number[];
  width: number;
  height: number;
}
```

The pdfjs boundary (`index.ts`) filters `getTextContent()` items with a
`"str" in item` type guard (TextItem vs TextMarkedContent) and passes them
structurally.

Rationale: unit tests build `TextItemLike[]` by hand with zero pdfjs in the
graph; WP-3 can replay real-statement dumps through the same pure function; a
pdfjs upgrade cannot silently change reconstruction logic.

### W2-D8 — Synthetic fixture generator

`tests/fixtures/pdf/generate.ts` — committed script; NEVER a committed binary
(root `.gitignore:129` already ignores
`packages/statement-parsers/tests/fixtures/**/*.pdf`).

- Exports `generateSyntheticStatementPdf(): Promise<Uint8Array>` — deterministic
  (fixed content, no randomness) — plus a CLI guard
  (`process.argv[1] === fileURLToPath(import.meta.url)`) that writes the PDF to
  `process.argv[2]` or `/tmp/wf-synthetic-statement.pdf`. Node 26 runs
  erasable-syntax TS natively (coder verifies with a one-line run); the file
  must avoid enums/namespaces/decorators.
- Geometry is SYNTHETIC — no real sample found (no gitignored `statements/`
  folder exists); flagged as a limitation, not a blocker: US Letter 612×792;
  left margin 40; columns Date left-aligned @40, Code left @90, Description left
  @130 (wraps within ~180 pt), Frais right-edge @350, Retrait right-edge @420,
  Dépôt right-edge @490, Solde right-edge @565. Body font Helvetica 8, header
  Helvetica-Bold 8, title Helvetica-Bold 12. Row pitch 14 pt.
- Right-aligned money drawn at
  `x = rightEdge − font.widthOfTextAtSize(text, size)` — the crucial
  real-statement geometry that defeats whitespace-only splitting.
- Content (~30 rows across 2 pages, all invented, obviously synthetic — no real
  merchants, no real-looking folios; account ref `SYNTH-0001`): title "SYNTHETIC
  BANK STATEMENT — FIXTURE ONLY"; header row
  `Date | Code | Description | Frais | Retrait | Dépôt | Solde` (money-column
  headers right-aligned at the same right edges); a "Solde reporté" opening row
  with the opening balance in the Solde column; mixed rows (retrait only, dépôt
  only, frais+retrait, rows with empty money cells); amounts in fr-CA style
  `1 234,56`; 2–3 wrapped descriptions (continuation line carries only
  description text — no date/code/money); page 2 repeats the header row and ends
  with a closing balance row.
- pdf-lib standard fonts use WinAnsi — French accents fine; plain spaces in
  amounts (NBSP encoding quirks are a WP-3 text-handling concern, not geometry).

Rationale: a committed generator (vs a binary) keeps the diff reviewable and the
fixture provably synthetic; right-edge math is the only way to reproduce the
column-defeating geometry that motivates this whole WP; the WP-3 column layout
is the best available evidence for column positions absent a real sample.

### W2-D9 — Golden test

`tests/pdf-golden.test.ts`: generate bytes in memory → `extractPageLines` →
assert a hardcoded expected `PageLine[]` literal (produced by a one-time dump,
then SEMANTICALLY REVIEWED by the coder before freezing — not blind snapshot
approval) with positions asserted via `toBeCloseTo` (≥2 digits), not just text.
PLUS property assertions independent of the literal:

- (a) right-alignment invariant — in the same money column, a longer amount
  starts at a smaller x (e.g. `1 234,56` vs `45,67` in Retrait) while both stay
  inside the column's x-range;
- (b) the header row yields exactly 7 cells with the expected texts;
- (c) a wrapped description produces two consecutive lines where the
  continuation line has fewer cells;
- (d) lines from page 1 all precede page 2, and y is descending within each
  page.

Bump the test timeout if the cold first run is slow.

Rationale: the literal pins geometry (a regression detector across pdfjs
upgrades, which are deliberate per W2-D2); the properties pin the invariants
WP-3 depends on even if content changes; semantic review because a blind
snapshot would bless a wrong reconstruction.

### W2-D10 — Unit tests

`tests/pdf-lines.test.ts` — hand-built `TextItemLike[]`, no pdfjs: same-baseline
items cluster; ≤2 pt jitter clusters; ~10 pt gap splits; items supplied out of
x-order come out x-sorted; word-gap merge vs column-gap split including the
exact threshold boundary (gap == threshold merges; gap just above splits);
blank/whitespace-only items dropped; cell text whitespace collapsed (`"A   B"` →
`"A B"`); overlapping (negative-gap) items merge; single-item line.

Rationale: each rule gets a direct test independent of pdfjs behavior; the
boundary tests pin the "exceeds" (`>`) semantics of both tolerances.

### W2-D11 — Frontend dev-only probe

Needed so the worker can be verified under `pnpm tauri dev` and
`pnpm run dev:web` — the MANUAL-TESTS.md entry is a required deliverable of
WP-2.

- New file
  `apps/frontend/src/features/statements/dev/pdf-worker-probe-page.tsx`: a
  dev-only page with a plain `<input type="file" accept="application/pdf">`; on
  file → `new Uint8Array(await file.arrayBuffer())` → `extractPageLines`;
  renders the `pdfWorkerMode()` badge, page/line counts, duration, and the first
  ~25 lines as rows of `page | y | cells` with each cell shown as its x and
  text. Small and dependency-free (no upstream components). React.lazy requires
  a default export — the one sanctioned default export in the fork.
- Route registration in `apps/frontend/src/routes.tsx`: a conditional dev-only
  route array —

```tsx
const PdfWorkerProbePage = lazy(
  () => import("@/features/statements/dev/pdf-worker-probe-page"),
);

const devRoutes = import.meta.env.DEV
  ? [
      <Route
        key="dev-statements-pdf"
        path="dev/statements-pdf"
        element={<PdfWorkerProbePage />}
      />,
    ]
  : [];
```

rendered inside the AppLayout branch (beside the dynamic addon routes). The
lazy + statically-false DEV condition keeps pdfjs out of production bundles
(Vite replaces `import.meta.env.DEV` with `false` at build; Rollup drops the
unreachable dynamic import — at worst an unloaded lazy chunk remains). In the
Tauri window there is no URL bar — the manual test reaches the page via the
devtools console: `location.href = "/dev/statements-pdf"` (debug builds have
devtools).

Upstream edits — exhaustive list, each minimal and declared (see §5): (1)
`apps/frontend/package.json` + `"@wealthfolio/statement-parsers": "workspace:*"`
in dependencies; (2) `apps/frontend/vite.config.ts` + alias
`"@wealthfolio/statement-parsers"` → `../../packages/statement-parsers/src`,

- `"pdfjs-dist"` in `optimizeDeps.include`; (3) `apps/frontend/tsconfig.json`
- paths entries `"@wealthfolio/statement-parsers"` and
  `"@wealthfolio/statement-parsers/*"` (mirror the `@wealthfolio/ui`
  exact+wildcard pattern; NO project reference — the package tsconfig is
  `composite: false`); (4) `apps/frontend/src/routes.tsx` conditional dev route;
  (5) `pnpm-lock.yaml` via `pnpm install`. Zero CSP changes.

Rationale: the worker strategy is only provable in a real browser context (Tauri
WebView + a normal browser); a probe page is the smallest surface that exercises
file → bytes → `extractPageLines` → render, and the dev-only route keeps it out
of production.

### W2-D12 — Verification

Gates: the package test suite (84 existing stay green + new tests), `pnpm lint`,
`pnpm type-check`, `pnpm format:check`. One-time `cargo check` baseline at repo
root — recorded in the session log, NOT a gate; do not debug if it fails (first
compile is slow). Web-build chunk check: `pnpm --filter frontend build`
(BUILD_TARGET=web is baked into that script) must keep pdfjs out of the main
chunk (it may appear only in the lazy dev-probe chunk, or nowhere) — recorded.
MANUAL-TESTS.md entry (owner-run; the agent cannot reach these): see §6.3.

Rationale: `pnpm test` includes 29 pre-existing environmental frontend failures
(out of scope, verified pre-existing at `69fedca`) — the WP-2 test gate is the
package suite; the cargo baseline records the Rust state now that the toolchain
is installed (PLAN §8) without making Rust a blocker for a TS-only WP; the chunk
check proves the bundle-isolation claim of W2-D11.

## 4. File layout

New files (all additive):

```
packages/statement-parsers/src/pdf/
├── index.ts           # pdfjs boundary + public API (extractPageLines, types,
│                      #   pdfWorkerMode re-export)
├── lines.ts           # pure buildPageLines(page, items) — no pdfjs import
├── worker.ts          # browser-only: static ?worker import, installPdfWorker
│                      #   singleton + main-thread fallback
├── worker-mode.ts     # PdfWorkerMode state + getter (no pdfjs imports)
└── worker-types.d.ts  # ambient `module "*?worker"` (package program only)

packages/statement-parsers/tests/
├── pdf-lines.test.ts  # unit tests — hand-built TextItemLike[]
├── pdf-golden.test.ts # end-to-end golden + property assertions
└── fixtures/pdf/
    └── generate.ts    # committed deterministic generator (CLI-capable);
                       #   PDF output gitignored

apps/frontend/src/features/statements/dev/
└── pdf-worker-probe-page.tsx  # dev-only probe (lazy, dev route)
```

Notes: `tests/fixtures/` is prettier-ignored (package `.prettierignore`) but
eslint- and tsc-checked (package tsconfig includes `tests/**/*`) — `generate.ts`
must pass both. `*.d.ts` is prettier-ignored. Modified fork file (not an
upstream edit): `packages/statement-parsers/package.json` (exports + deps). The
two test files match the existing vitest include glob (`tests/**/*.test.ts`);
`generate.ts` does not (not collected as a test).

## 5. Upstream edits (exhaustive)

1. `apps/frontend/package.json` — add
   `"@wealthfolio/statement-parsers": "workspace:*"` to `dependencies`
   (alphabetical slot between `@wealthfolio/addon-sdk` and `@wealthfolio/ui`).
2. `apps/frontend/vite.config.ts` — `resolve.alias` entry
   `"@wealthfolio/statement-parsers": path.resolve(__dirname, "../../packages/statement-parsers/src")`
   (beside the addon-sdk/ui aliases); `"pdfjs-dist"` appended to
   `optimizeDeps.include`.
3. `apps/frontend/tsconfig.json` — `paths` entries
   `"@wealthfolio/statement-parsers": ["../../packages/statement-parsers/src"]`
   and
   `"@wealthfolio/statement-parsers/*": ["../../packages/statement-parsers/src/*"]`
   (mirrors the `@wealthfolio/ui` exact+wildcard pair). NO project reference —
   the package tsconfig is `composite: false` and cannot be referenced.
4. `apps/frontend/src/routes.tsx` — `lazy` added to the react import; the
   `PdfWorkerProbePage` lazy const + conditional `devRoutes` array rendered
   inside the AppLayout branch (W2-D11).
5. `pnpm-lock.yaml` — via `pnpm install`.

Nothing else. Zero CSP changes (`worker-src 'self' blob:` already present in
both `csp` and `devCsp`, `apps/tauri/tauri.conf.json:84-85`). No root
`package.json` change (the test gate was wired in WP-1). The statement-parsers
package's own `package.json` is fork-additive (WP-1), so its exports/dependency
changes are not upstream edits.

## 6. Test plan

### 6.1 Unit — `tests/pdf-lines.test.ts`

Per W2-D10: hand-built `TextItemLike[]`, direct imports from
`../src/pdf/lines.ts`, no pdfjs anywhere in the graph. One describe per
reconstruction rule; boundary tests for both tolerances.

### 6.2 Golden — `tests/pdf-golden.test.ts`

Per W2-D9: `generateSyntheticStatementPdf()` in memory → `extractPageLines` →
hardcoded, semantically reviewed expected literal (positions
`toBeCloseTo(…, 2)`, text exact) + properties (a)–(d). One-time dump procedure:
scratch test printing the JSON → review → fix `lines.ts` if wrong → re-dump →
freeze → delete the scratch. Bump the timeout if the cold first run is slow.

### 6.3 Manual — MANUAL-TESTS.md (owner-run; agent cannot reach these)

1. FIRST item per fork protocol — how to leave `pnpm tauri dev` (Ctrl+C in its
   terminal) and recover if leaving fails: `pkill -f "cargo run"`,
   `pkill -f Wealthfolio`, `pkill -f vite`, then `ss -ltnp | grep 1420` must be
   empty; `fuser -k 1420/tcp` if held.
2. Worker probe under `pnpm tauri dev`: generate the synthetic PDF
   (`node packages/statement-parsers/tests/fixtures/pdf/generate.ts`), open the
   app, devtools console → `location.href = "/dev/statements-pdf"`, load the
   synthetic PDF — pass = "worker-port" badge, lines table with 7-column rows,
   right-aligned money in the correct columns, 2 pages, no console errors; parse
   the same file a second time (worker reuse); failure = "main-thread" badge or
   parse error.
3. Same under `pnpm run dev:web` in a normal browser at
   `http://localhost:1420/dev/statements-pdf` (leave via Ctrl+C —
   `scripts/dev-web.mjs` kills both children).
4. Optional owner-only real-statement check: drop a real PDF from the gitignored
   `statements/` folder — LOCAL ONLY, never commit, no screenshots — also note
   observed column geometry for WP-3.

## 7. Verification

- `pnpm --filter @wealthfolio/statement-parsers test` — 84 existing + new unit +
  golden, all green.
- `pnpm lint`, `pnpm type-check`, `pnpm format:check` — green. `type-check`
  covers BOTH programs that now include `src/pdf/`: the package's strict one
  (`noUncheckedIndexedAccess` + `exactOptionalPropertyTypes` — write against the
  stricter config and both pass) and the frontend's via paths.
- `pnpm --filter frontend build` — chunk check per W2-D12 (record: pdfjs absent
  everywhere, or unloaded lazy chunk only).
- One-time `cargo check` at repo root — record the result in the session log;
  not a gate; do not debug.
- MANUAL-TESTS.md entry appended (owner runs items 1–4).

## 8. Privacy

- Generator content is entirely invented: the title says "FIXTURE ONLY", account
  ref `SYNTH-0001`, no real merchants, no real-looking folios, invented amounts.
- No PDF binary is ever committed (`.gitignore:129` covers
  `packages/statement-parsers/tests/fixtures/**/*.pdf`; the generator writes to
  `/tmp` by default).
- The optional real-statement check (manual item 4) is local-only: never
  committed, no screenshots; geometry notes for WP-3 record column x-positions
  and font sizes, never values.

## 9. Risks / plan Bs

1. pdfjs-dist standard build may not run in node-env vitest → plan B:
   `resolve.alias` `"pdfjs-dist"` → `"pdfjs-dist/legacy/build/pdf.mjs"` in the
   package vitest.config (W2-D4).
2. Worker file path / exports map must be verified against installed 6.3.289
   (`build/pdf.worker.min.mjs` expected) — coder verifies and adapts; any
   deviation recorded in the session log.
3. eslint may flag the `?worker` import → minimal inline disable or config
   entry, declared in the session log.
4. pdfjs-dist types may not resolve under `moduleResolution: "bundler"` → plan
   B: tsconfig paths shim.
5. Dev-mode `optimizeDeps` handling of the worker is verified by manual test
   item 2; fallback documented NOTES S2 style: copy the worker to `public/` or
   force main-thread. Refinement: under pnpm's strict layout,
   `optimizeDeps.include: ["pdfjs-dist"]` resolves from `apps/frontend`, where
   pdfjs-dist is NOT a direct dependency — if dev errors on it, plan B: drop the
   include entry (lazy discovery optimizes on first import, cost = one reload)
   or add `pdfjs-dist@6.3.289` exact to apps/frontend devDependencies (would
   become a declared 6th upstream edit).
6. pdfjs may want standard-font data for text extraction of the generator's
   non-embedded standard fonts (warnings or zero widths) — the golden test is
   the detector; plan B: point `standardFontDataUrl` at pdfjs-dist's
   `standard_fonts/` (node: node_modules path in the test; browser: copied
   asset) or embed a font in the generator. Declared adaptation either way.
7. If node-env vitest still chokes on the `?worker` specifier despite the
   guarded dynamic import (some other path pulling `worker.ts` in) → plan B:
   vitest `resolve.alias` regex `/\?worker$/` → a stub module.
8. Golden dump looks wrong → fix `lines.ts` and re-dump; never freeze a dump
   that has not been semantically reviewed.

## 10. Open questions

None blocking. Resolved during planning (recorded so the coder doesn't
re-derive): pdfjs placement (W2-D1), version pinning (W2-D2), worker vs
fake-worker in tests (W2-D4 — real pdfjs, node auto-fake-worker), options on the
public API (none, W2-D5), real sample (none exists — generator geometry is
synthetic from the WP-3 column layout).

Flagged limitation (not a blocker): tolerances (`Y_TOLERANCE`,
`CELL_GAP_FACTOR`) and column positions are synthetic-geometry-derived and must
be re-checked against a real statement in WP-3; manual item 4 collects that
evidence if the owner runs it.

Genuinely open, answered at build time by the marked "coder verifies" items: the
exact minified worker entry filename in installed 6.3.289 (W2-D3), the actual v6
fake-worker global mechanism (W2-D3), and whether Node 26 type-stripping runs
`generate.ts` as-is (W2-D8).
