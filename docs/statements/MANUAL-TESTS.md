# MANUAL-TESTS.md — statements

Manual checks for the statements feature. Append a dated section per work
package, covering **only what the gates structurally cannot reach**. Do not
re-list what `pnpm test` already asserts.

Rules:

- One numbered item per check. Each states three things: the **exact command**,
  what a **pass** looks like, and what **failure** looks like.
- "Verify it renders correctly" is not an item.
- Order by risk, not by feature. Say plainly when a known past failure makes an
  item likely.
- If a change can capture a terminal, screen, or focus, the **first** item is
  how to leave it and how to recover if leaving fails.
- When a manual item later becomes automatable, delete it and name the test that
  replaced it.

---

## WP-0 — fork bootstrap

No manual tests. Bootstrap is verified by `git remote -v`, the current branch,
and a green `pnpm install`.

---

## WP-2 — PDF → positioned text (pdfjs worker)

Added 2026-09-14. The package tests cover reconstruction and the golden
end-to-end extraction in Node; these items cover what only a real runtime can
prove: the pdfjs worker under Tauri's custom protocol + CSP, and under a plain
browser.

1. Leaving `pnpm tauri dev` and recovering. It occupies a terminal (Vite on
   :1420 + cargo). **Command:** focus the terminal running `pnpm tauri dev`,
   press Ctrl+C. **Pass:** the shell prompt returns, the Wealthfolio window
   closes, and `ss -ltnp | grep 1420` prints nothing. If leaving fails: run
   `pkill -f 'cargo run'`, `pkill -f Wealthfolio`, `pkill -f vite`, then
   re-check the port; if still held, `fuser -k 1420/tcp`. **Failure:** the port
   is still busy on the next `pnpm tauri dev` (strictPort) — repeat the kills;
   as a last resort `pkill -9 -f Wealthfolio`.

2. pdfjs worker under `pnpm tauri dev` (the real Tauri runtime — custom
   protocol + CSP). **Command:** `pnpm tauri dev` (the cargo baseline was
   already compiled this session; startup ~1 min). Generate the fixture:
   `node packages/statement-parsers/tests/fixtures/pdf/generate.ts` (writes
   `/tmp/wf-synthetic-statement.pdf`). In the Wealthfolio window: right-click →
   Inspect to open devtools (debug builds have them), Console tab, run
   `location.href = "/dev/statements-pdf"`. On the probe page, pick
   `/tmp/wf-synthetic-statement.pdf` with the file input. **Pass:** the badge
   reads "worker-port"; ~44 lines across 2 pages; the header row shows 7 cells
   (Date | Code | Description | Frais | Retrait | Dépôt | Solde);
   Retrait/Dépôt/Solde amounts sit in their own cells with longer amounts
   starting further left (right-aligned); wrapped descriptions appear as
   continuation lines with fewer cells; no console errors; loading the same file
   a second time still works (worker reuse). **Failure:** the badge reads
   "main-thread" (worker blocked — investigate CSP/bundling before WP-3), a
   parse error is displayed, or lines are empty/garbled.

3. Same check under `pnpm run dev:web` (secondary — plain browser, no Tauri
   CSP). **Command:** `pnpm run dev:web` (spawns the cargo server + Vite). Open
   `http://localhost:1420/dev/statements-pdf` in a browser and repeat item 2's
   assertions. **Pass:** as item 2. **Failure:** as item 2. Leave: Ctrl+C in the
   terminal (`scripts/dev-web.mjs` kills both children). If leaving fails:
   `pkill -f dev-web.mjs`, `pkill -f vite`, `pkill -f 'apps/server'`, then check
   port 1420 as in item 1.

4. Owner-only, optional: a real statement, LOCAL ONLY. Put a real Desjardins PDF
   in the gitignored `statements/` folder and load it in the probe (either
   runtime). **Pass:** rows reconstruct with plausible columns — eyeball against
   the PDF itself. **Failure:** columns merge or split wrongly — record the
   observed geometry for WP-3 tolerance tuning. Privacy: never commit the file,
   never screenshot it, delete it afterwards. While it is open, note the real
   geometry (page size, column x positions, body font size) and record it in
   PLAN §5 WP-3 / NOTES — it is the evidence that tunes WP-3's tolerances and
   the generator (the WP-2 gap: no real sample existed, so geometry is
   synthetic).

---

<!-- Add new sections below, most recent first. -->
