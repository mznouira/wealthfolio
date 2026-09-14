---
name: verification
description:
  Run Wealthfolio's verification ladder for TypeScript and Rust changes. Use
  before declaring any change complete, or when asked to verify, test, or check
  the build.
---

# Verification

Run the ladder in order and stop at the first failure.

1. `pnpm format:check`
2. `pnpm lint:quiet`
3. `pnpm run type-check`
4. `pnpm test`
5. `cargo check --workspace`
6. `cargo test`

## Narrow first

For a small change, run only the relevant subset while iterating, then the full
ladder before shipping.

- Frontend: `pnpm --filter frontend lint`, `pnpm --filter frontend type-check`,
  `pnpm test`
- Rust crate: `cargo check -p <crate>`, `cargo test -p <crate>`

## Frontend behavior

For user-visible frontend changes, run `pnpm test:e2e`. The `run-e2e-tests`
skill covers environment setup.

## Reporting

- Report failures verbatim with file:line and the exact repro command.
- Never weaken, skip, or delete a test to make it pass.
- Treat unverified work as incomplete.
