# WP-2 implementation plan — PDF → positioned text (pdfjs-dist)

Implements: `docs/specs/wp2-pdf-positioned-text.md` (design W2-D1..W2-D12 LOCKED
— do not re-open; "coder verifies" items are build-time checks, not design
questions). Protocol: `docs/statements/AGENTS.md` (additive-only, privacy,
gates, docs duties). Scope: `docs/statements/PLAN.md` §4, §5 WP-2, §8. Planned:
2026-09-14. Executor: coder (`opencode-go/kimi-k2.7-code`).

## Goal

Institution-agnostic PDF → `PageLine[]` layer in
`packages/statement-parsers/src/pdf/` (pdfjs-dist `6.3.289` exact, `./pdf`
subpath export), pure reconstruction + unit tests, deterministic synthetic PDF
generator + golden end-to-end test, frontend dev-only worker probe (5 declared
upstream edits), MANUAL-TESTS entry, docs + push. No Desjardins grammar in
`src/`. No Rust changes.

## Success criteria

- `pnpm --filter @wealthfolio/statement-parsers test` green: 84 existing +
  `tests/pdf-lines.test.ts` + `tests/pdf-golden.test.ts` (literal semantically
  reviewed before freezing + properties (a)–(d)).
- `pnpm lint`, `pnpm type-check`, `pnpm format:check` green.
- `pnpm --filter frontend build` (web): pdfjs NOT in main chunk — record which
  (absent everywhere / unloaded lazy dev-probe chunk only).
- One-time `cargo check` at root: result recorded in session log. NOT a gate. Do
  not debug if it fails.
- `MANUAL-TESTS.md`: dated WP-2 section, 4 items, leave/recover first.
- `PLAN.md`: WP-2 → done + session-log line. `CONTEXT.md`: PageLine/cell
  glossary entries.
- Upstream diff = exactly the 5 declared edits (spec §5). Zero CSP changes.
- Privacy: no PDF binary committed; generator content all synthetic.

## Assumptions

- Spec facts verified 2026-09-14 (versions, CSP, configs, gitignore line 129) —
  trust, don't re-derive.
- pdfjs-dist 6.3.289: exports `.` → `build/pdf.mjs` + types; worker entry
  `build/pdf.worker.min.mjs` — coder verifies against installed tree (slice A).
- Node 26.8.1 runs erasable-syntax `.ts` directly — verify once (slice B).
- Frontend test debt (29 pre-existing failures) out of scope — package suite is
  the WP-2 test gate.
- Uncommitted at start: this plan + the spec → commit both first (step 0).

## Step 0 — git pre-flight (before any build)

```bash
cd /home/zied/Projects/wealthfolio
git branch --show-current   # MUST be zied/statements, else STOP + report
git status --short          # only the two WP-2 docs uncommitted → commit them
git fetch upstream
git merge-base --is-ancestor upstream/main zied/statements \
  && echo CURRENT || echo BEHIND
```

- Commit docs first:
  `pnpm exec prettier --write docs/specs/wp2-pdf-positioned-text.md .opencode/plans/2026-09-14-wp2-pdf-positioned-text.md`
  then
  `git add docs/specs/wp2-pdf-positioned-text.md .opencode/plans/ && git commit -m "WP-2: spec + implementation plan"`.
  Any OTHER dirt → STOP + report.
- BEHIND → `git rebase upstream/main`. Clean → continue. Conflicts →
  `git rebase --abort`, STOP, report. Never force-push.
- After any rebase: `pnpm install` + package test sanity (84 green) before
  building.

## Slice A — deps + src/pdf module + unit tests

### Files

New, under `/home/zied/Projects/wealthfolio/packages/statement-parsers/`:

- `src/pdf/worker-mode.ts` —
  `export type PdfWorkerMode = "worker-port" | "main-thread" | "not-configured";`
  module-level `let` state + `setPdfWorkerMode(mode)` + `pdfWorkerMode()`
  getter. NO pdfjs imports.
- `src/pdf/worker-types.d.ts` — ambient
  `declare module "*?worker" { const w: new () => Worker; export default w; }`
  (DOM lib is on in `tsconfig.base.json`, so `Worker` type exists).
- `src/pdf/worker.ts` — static
  `import PdfWorker from "pdfjs-dist/build/pdf.worker.min.mjs?worker";` (verify
  path first, see Commands); `installPdfWorker(): Promise<PdfWorkerMode>`:
  module-level singleton promise (concurrent calls await same promise);
  `GlobalWorkerOptions.workerPort = new PdfWorker()`; on construction failure →
  main-thread fallback
  `globalThis.pdfjsWorker = await import("pdfjs-dist/build/pdf.worker.mjs")`
  (verify v6 mechanism name in installed source; adapt if renamed); sets mode
  via `setPdfWorkerMode` on success only.
- `src/pdf/lines.ts` — pure
  `buildPageLines(page: number, items: TextItemLike[]): PageLine[]` per W2-D6
  rules 1–7; documented module constants `Y_TOLERANCE = 2`,
  `CELL_GAP_FACTOR = 0.5`; `collapseWhitespace` from `../text.ts`; NO pdfjs
  import; exports `TextItemLike`, `buildPageLines`, `PageCell`, `PageLine`
  types.
- `src/pdf/index.ts` — public API per W2-D5: `PageCell`, `PageLine`,
  `extractPageLines(bytes: Uint8Array): Promise<PageLine[]>`; `bytes.slice()`
  copy before `getDocument`; browser guard
  (`typeof window !== "undefined" && typeof document !== "undefined" && typeof Worker !== "undefined"`)
  wrapping `await import("./worker.ts")` + `await installPdfWorker()` before
  `getDocument`; `"str" in item` filter on `getTextContent()` items; per-page
  `page.cleanup()`; `doc.destroy()` in `finally`; re-export `TextItemLike`,
  `pdfWorkerMode`, `PdfWorkerMode` from `./worker-mode.ts`. Static
  `import { getDocument } from "pdfjs-dist";`.
- `tests/pdf-lines.test.ts` — W2-D10 cases: same-baseline cluster; ≤2 pt jitter
  cluster; ~10 pt gap split; out-of-x-order input → x-sorted; word gap merge vs
  column gap split incl. exact boundary (gap == threshold merges, just above
  splits); blank/whitespace items dropped; `"A   B"` → `"A B"`; negative-gap
  overlap merge; single-item line. Import from `../src/pdf/lines.ts`. No pdfjs.

Modify:

- `packages/statement-parsers/package.json` —
  `exports: { ".": "./src/index.ts", "./pdf": "./src/pdf/index.ts" }`;
  `dependencies: { "pdfjs-dist": "6.3.289" }` (exact, no caret);
  devDependencies + `"pdf-lib": "^1.17.1"`.

### Commands

```bash
pnpm install
# verify installed pdfjs facts (W2-D3 "coder verifies"):
ls packages/statement-parsers/node_modules/pdfjs-dist/build/ | grep -i worker
grep -A 20 '"exports"' packages/statement-parsers/node_modules/pdfjs-dist/package.json
grep -rn "pdfjsWorker" packages/statement-parsers/node_modules/pdfjs-dist/build/pdf.mjs | head -5
ls packages/statement-parsers/node_modules/pdfjs-dist/types/src/pdf.d.ts
```

Worker entry differs from `pdf.worker.min.mjs` → use the minified entry that
exists; record in session log. Fake-worker global renamed → adapt `worker.ts`;
record.

### Done when

- `pnpm --filter @wealthfolio/statement-parsers type-check` green (worker.ts
  `?worker` import resolves via `worker-types.d.ts`).
- `pnpm --filter @wealthfolio/statement-parsers test` green — 84 existing + new
  unit tests.
- `pnpm --filter @wealthfolio/statement-parsers lint` green (if eslint flags the
  `?worker` import: minimal inline disable, declared).

## Slice B — generator + golden test

### Files

New, under `packages/statement-parsers/`:

- `tests/fixtures/pdf/generate.ts` — per W2-D8:
  `generateSyntheticStatementPdf(): Promise<Uint8Array>`, deterministic, no
  randomness; CLI guard `process.argv[1] === fileURLToPath(import.meta.url)` →
  write `process.argv[2] ?? "/tmp/wf-synthetic-statement.pdf"`; erasable syntax
  only (no enums/namespaces/decorators); standalone imports (pdf-lib
  - node builtins only). Geometry: Letter 612×792; margin 40; Date @40 left,
    Code @90 left, Description @130 left (wrap ~180 pt), Frais right-edge 350,
    Retrait right-edge 420, Dépôt right-edge 490, Solde right-edge 565;
    Helvetica 8 body / Helvetica-Bold 8 header / Helvetica-Bold 12 title; row
    pitch 14 pt; money at `x = rightEdge − font.widthOfTextAtSize(text, size)`.
    Content: title "SYNTHETIC BANK STATEMENT — FIXTURE ONLY"; account ref
    `SYNTH-0001`; header row (money headers right-aligned at same right edges);
    "Solde reporté" opening row (balance in Solde column only); ~30 rows / 2
    pages, mixed (retrait only, dépôt only, frais+retrait, empty money cells);
    fr-CA amounts `"1 234,56"` (plain spaces); 2–3 wrapped descriptions
    (continuation = description text only); page 2 repeats header + ends with
    closing balance row. All invented; no real merchants.
- `tests/pdf-golden.test.ts` — per W2-D9: generate in memory →
  `extractPageLines` → (1) hardcoded expected `PageLine[]` literal: `page`
  exact, `y` + cell `x` via `toBeCloseTo(…, 2)`, cell text exact; (2) properties
  (a)–(d) independent of literal; timeout bumped (e.g. `30_000`) if cold run
  slow.

### Commands

```bash
# Node TS-run verification (one-time):
node packages/statement-parsers/tests/fixtures/pdf/generate.ts
ls -la /tmp/wf-synthetic-statement.pdf
# one-time dump (scratch, then DELETE):
cd packages/statement-parsers && pnpm exec vitest run tests/pdf-dump.test.ts
```

Dump procedure: scratch `tests/pdf-dump.test.ts` printing
`JSON.stringify(lines, null, 1)` → copy output → SEMANTIC REVIEW (7-cell header?
money in correct columns? wrapped continuations separate lines with fewer cells?
page 1 before page 2, y descending?) → if wrong: fix `lines.ts`, re-dump →
freeze literal in `pdf-golden.test.ts` → delete scratch file. Never freeze an
unreviewed dump.

### Done when

- `pnpm --filter @wealthfolio/statement-parsers test` green incl. golden.
- Generator CLI works via plain `node`.
- `git status` shows no `*.pdf` (gitignore line 129 covers; verify).

## Slice C — frontend wiring + probe

### Files

Modify (upstream edits 1–4, exact per spec §5):

- `apps/frontend/package.json` — dependencies +
  `"@wealthfolio/statement-parsers": "workspace:*"` (between
  `@wealthfolio/addon-sdk` and `@wealthfolio/ui`).
- `apps/frontend/vite.config.ts` — `resolve.alias` +
  `"@wealthfolio/statement-parsers": path.resolve(__dirname, "../../packages/statement-parsers/src")`;
  `optimizeDeps.include` + `"pdfjs-dist"`.
- `apps/frontend/tsconfig.json` — `paths` +
  `"@wealthfolio/statement-parsers": ["../../packages/statement-parsers/src"]`,
  `"@wealthfolio/statement-parsers/*": ["../../packages/statement-parsers/src/*"]`.
  NO project reference (package tsconfig `composite: false`).
- `apps/frontend/src/routes.tsx` — add `lazy` to the react import;
  `const PdfWorkerProbePage = lazy(() => import("@/features/statements/dev/pdf-worker-probe-page"));`
  `const devRoutes = import.meta.env.DEV ? [<Route key="dev-statements-pdf" path="dev/statements-pdf" element={<PdfWorkerProbePage />} />] : [];`
  render `{devRoutes}` inside the AppLayout branch, right after the dynamic
  addon-routes block.

New:

- `apps/frontend/src/features/statements/dev/pdf-worker-probe-page.tsx` — per
  W2-D11: DEFAULT export (React.lazy requirement — the fork's one sanctioned
  default export); plain `<input type="file" accept="application/pdf">`; on file
  → `new Uint8Array(await file.arrayBuffer())` → `extractPageLines` (from
  `@wealthfolio/statement-parsers/pdf`); render `pdfWorkerMode()` badge, page
  count, line count, duration ms, first ~25 lines as `page | y | cells` rows
  (cell = `x: text`). Plain elements + tailwind classes only; no upstream
  components; no i18n (dev-only).

### Commands

```bash
pnpm install                       # lockfile = upstream edit 5
pnpm --filter frontend type-check
pnpm --filter frontend lint
```

### Done when

- `pnpm --filter frontend type-check` green (probe page + routes + paths
  resolution; pdfjs types resolve through statement-parsers node_modules). If
  `@wealthfolio/statement-parsers/pdf` dir-index resolution fails under paths
  wildcard → add explicit path
  `"@wealthfolio/statement-parsers/pdf": ["../../packages/statement-parsers/src/pdf/index.ts"]`.
- `pnpm --filter frontend lint` green.
- Root `pnpm type-check` green (both programs: package strict + frontend).

## Slice D — verification gates + cargo baseline + chunk check

### Commands

```bash
pnpm --filter @wealthfolio/statement-parsers test   # THE test gate
pnpm lint
pnpm type-check
pnpm format:check
pnpm --filter frontend build                        # web build (BUILD_TARGET=web baked in)
# chunk check — record result:
ls dist/assets/ | head -50
grep -l "pdfjs" dist/assets/*.js || echo "no pdfjs in any chunk"
# cargo baseline (one-time, slow first compile; NOT a gate):
cargo check 2>&1 | tail -20
```

Chunk check pass: no pdfjs marker in the main/index chunk. Accept: absent
everywhere, OR present only in an unloaded lazy dev-probe chunk (statically
-false `import.meta.env.DEV` lets Rollup drop or orphan it). Record which.

### Done when

- All four gates green; chunk-check result recorded; cargo result recorded (pass
  or fail — do not debug).

## Slice E — docs + commit + push

### Files

Modify:

- `docs/statements/MANUAL-TESTS.md` — dated `## WP-2 — PDF → positioned text`
  section (below the "most recent first" marker), 4 numbered items transcribed
  from spec §6.3, each with exact command / pass / failure. Item 1 = leave
  `pnpm tauri dev` + recover.
- `docs/statements/PLAN.md` — §5 WP table: WP-2 `pending` → `**done**`; §10
  session log: one entry (done: pdf layer + generator + golden + probe, worker
  path + fake-worker mechanism verified facts, golden review note, gates green,
  chunk-check + cargo baseline results, any plan-B activations, real-sample gap
  flagged; next: WP-3; blocked: manual items 1–4 pending owner run).
- `docs/statements/CONTEXT.md` — read first, then add glossary entries (its
  format): **positioned line (PageLine)** — reconstructed row: page, y, ordered
  cells; **cell** — x + text merged from adjacent items. Glossary only, no
  implementation detail.
- `docs/specs/wp2-pdf-positioned-text.md` — NOT rewritten (approved record). If
  a "coder verifies" item resolved differently than assumed (worker filename,
  fake-worker name), append a dated note at the bottom.

### Commands

```bash
pnpm exec prettier --write docs/statements/MANUAL-TESTS.md docs/statements/PLAN.md docs/statements/CONTEXT.md
git add -A
git status --short          # review: only intended files
git diff --cached --stat    # upstream diff must be exactly the 5 edits
git commit -m "WP-2: PDF -> positioned text layer (pdfjs-dist) + dev worker probe"
git push origin zied/statements
```

### Done when

- Docs updated + prettier-clean; commit pushed; `git status` clean.

## Verification ladder (WP-2 gates)

```bash
pnpm --filter @wealthfolio/statement-parsers test   # 84 + new unit + golden
pnpm lint
pnpm type-check
pnpm format:check
```

Records, not gates: `pnpm --filter frontend build` chunk check; one-time
`cargo check` baseline. `cargo test`/`cargo clippy` NOT run (no Rust touched).
Root `pnpm test` NOT the gate (29 pre-existing frontend failures, out of scope)
— but keep the package + `node --test scripts/__tests__/` portions green
implicitly via the gates above.

## Risks & rollback

- pdfjs standard build fails in node vitest → plan B: vitest.config
  `resolve.alias` `"pdfjs-dist"` → `"pdfjs-dist/legacy/build/pdf.mjs"`.
- eslint flags `?worker` import → minimal inline disable, declared.
- pdfjs types unresolved under bundler → tsconfig paths shim.
- `optimizeDeps.include: ["pdfjs-dist"]` unresolvable from apps/frontend (pnpm
  strict layout; not a frontend dep) → drop the entry (lazy discovery, one
  reload) OR add `pdfjs-dist@6.3.289` exact to frontend devDeps (declared 6th
  upstream edit). Detected at dev start / manual item 2.
- Worker path / fake-worker global differ in 6.3.289 → adapt per installed
  source; record.
- Standard-font data needed for text extraction (warnings/zero widths) → golden
  test detects; plan B: `standardFontDataUrl` → pdfjs-dist `standard_fonts/`
  (node path in test / copied asset in browser) or embed a font in the
  generator. Declared adaptation.
- Node TS stripping fails on `generate.ts` → `node --experimental-strip-types`
  fallback; if still failing, CLI wrapper as `.mjs` (golden test unaffected — it
  imports the TS function).
- Golden dump wrong → fix `lines.ts`, re-dump; never freeze unreviewed.
- eslint `no-console` on generate.ts CLI → minimal inline disable, declared.
- Rollback (all additive except declared edits):
  `git checkout -- apps/frontend/package.json apps/frontend/vite.config.ts apps/frontend/tsconfig.json apps/frontend/src/routes.tsx pnpm-lock.yaml packages/statement-parsers/package.json`;
  `rm -rf packages/statement-parsers/src/pdf packages/statement-parsers/tests/pdf-lines.test.ts packages/statement-parsers/tests/pdf-golden.test.ts packages/statement-parsers/tests/fixtures/pdf apps/frontend/src/features/statements`;
  revert `docs/statements/{MANUAL-TESTS,PLAN,CONTEXT}.md`. Branch
  `zied/statements` only.

## Unresolved questions

None blocking (spec §10). Build-time "coder verifies" items live in slices A/B.
