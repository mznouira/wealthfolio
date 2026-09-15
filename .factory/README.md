# .factory — shared source for the agent factory

Wealthfolio runs two parallel agent harnesses over this repo: **OpenCode**
(`.opencode/`) and **Claude Code** (`.claude/`). Their config file formats
differ enough that the two directories can't just be symlinks of each other, so
this directory is the single source of truth each one is generated from (or,
where the formats do match, symlinked from).

- `agents/*.md` — canonical prompt body for each role (orchestrator, planner,
  coder, tester, reviewer, security, scribe). No frontmatter — just the
  instructions.
- `commands/*.md` — canonical body for each slash command (build, plan, review,
  spec, verify).
- `factory.config.json` — per-role, per-tool frontmatter (model, permissions,
  tools). This is the only place that legitimately differs between the two
  tools, because it maps to genuinely different permission systems.
- `plans/` — real plan artifacts written by whichever planner ran. Both tools'
  planner agents write here, so plans exist exactly once regardless of which
  engine produced them.
- `skills/` — skills whose frontmatter shape is identical in both tools
  (`model-selection`, `verification`). `.opencode/skills/<name>` and
  `.claude/skills/<name>` are real symlinks into here — edit either path and
  you're editing the same file.

## Keeping the two harnesses in sync

Run this after editing anything under `agents/`, `commands/`, or
`factory.config.json`:

```
pnpm factory:sync
```

It regenerates `.opencode/agents/*.md`, `.opencode/commands/*.md`,
`.claude/agents/*.md`, and `.claude/commands/*.md`. Those four directories are
generated — don't hand-edit them, edits will be overwritten on the next sync.
`pnpm factory:sync:check` fails if the generated files are out of date (no
edits, just a stale-check).

The guard/format logic (secret-file reads, destructive bash, auto-format) is
shared a different way: both `.opencode/plugins/guard.ts` and the
`.claude/settings.json` hooks call into `scripts/factory-guard.mjs`. Edit the
regex list there once; both harnesses pick it up immediately, no sync step
needed.

The driver/worktree/scheduler automation (`scripts/factory-*.{mjs,sh}`) works
the same way: one engine-agnostic core, thin `opencode-*` / `claude-*` wrappers
that only supply which binary to shell out to.
