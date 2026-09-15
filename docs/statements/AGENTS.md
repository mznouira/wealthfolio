# AGENTS.md — statements fork protocol

Working agreement for anyone (human or agent) changing the **statements**
feature in this Wealthfolio fork. Upstream's own [`/AGENTS.md`](../../AGENTS.md)
is the general repo guide and still applies; this file adds the rules specific
to our fork and this feature.

Canonical plan: [`PLAN.md`](PLAN.md). Vocabulary: [`CONTEXT.md`](CONTEXT.md).

## 1. This is a thin fork tracking upstream

- `origin` is `mznouira/wealthfolio` (our fork). `upstream` is
  `wealthfolio/wealthfolio`.
- Branch from **`upstream/main`**, never from a stale local `main`, and never
  commit to `main`.
- One feature branch for the effort: `zied/statements`.
- Keep the patch series **small and additive**. Prefer new files under
  `packages/statement-parsers/` and `apps/frontend/src/features/statements/`.
  When an upstream file must change, keep it minimal and clearly scoped so a
  rebase stays cheap.
- After upstream releases, rebase `zied/statements` onto the new `upstream/main`
  and re-run the gates before continuing.
- We intend to propose the generic statement-import seam upstream (WP-7). Design
  the seam so an institution parser is a drop-in, and so nothing
  Desjardins-specific leaks into the seam.

## 2. Privacy

The repo is public, and so is upstream.

- **Never commit a real statement, account number, or balance.**
- Derive a parser from a real file, then write a **synthetic** fixture from the
  shape and delete the real file. Same procedure that produced portage's
  verified Desjardins layout.
- Keep downloaded statements in a local `statements/` folder, which is
  gitignored, or outside the repo entirely.

## 3. Gates (all must be green before a work package is done)

```bash
pnpm test          # vitest (frontend + packages)
pnpm lint
pnpm type-check
cargo test         # once the Rust toolchain is installed, if Rust is touched
cargo clippy       # if Rust is touched
```

Plus, for the parser:

- golden fixtures are **synthetic** and committed;
- the reconciliation assertion (opening + Σ lines = closing) is a **hard gate**,
  not a warning.

## 4. Manual tests

Anything CI structurally cannot reach — a real PDF, folder intake, the review
grid, focus/clipboard/terminal behaviour — gets a dated section in
[`MANUAL-TESTS.md`](MANUAL-TESTS.md), one numbered item per check, each stating
the exact command, what a pass looks like, and what failure looks like. If a
change can capture a terminal, screen, or focus, the **first** item is how to
leave it and how to recover if leaving fails.

## 5. Docs

- `PLAN.md` — update the work-package table and append one session-log line
  (done / next / blocked).
- `CONTEXT.md` — update the moment a term is resolved; glossary only, no
  implementation details.
- Anything discussed but not built goes to a "Parking lot" note in `PLAN.md`,
  never silently into code.

## 6. Toolchain

See `PLAN.md` §8. In short: Node + `pnpm@10.33.4` are ready; the Rust toolchain
(`rust-toolchain.toml` pins `1.95.0`) and Tauri system deps still need an
interactive `sudo` install. Frontend-only work does not need Rust.
