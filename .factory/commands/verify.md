Follow the `verification` skill. Run the ladder and report results verbatim.
Stop at the first failure unless asked otherwise.

1. `pnpm format:check`
2. `pnpm lint:quiet`
3. `pnpm run type-check`
4. `pnpm test`
5. `cargo check --workspace`
6. `cargo test`

For frontend behavior changes, also run `pnpm test:e2e`.

Report failures with file:line and the exact repro command. Do not weaken tests.
If a check needs a human, log it to `docs/factory/NEEDS-HUMAN.md` instead of
skipping it, and continue.
