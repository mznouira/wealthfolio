// Shared engine-agnostic core behind scripts/opencode-scheduler.mjs and
// scripts/claude-scheduler.mjs: poll labeled GitHub issues, run one engine on
// each in an isolated worktree, and optionally commit/push/open a PR. See
// .factory/README.md.
//
// Non-blocking human-test surfacing: after each run, this diffs
// docs/factory/NEEDS-HUMAN.md in the worktree. If the agent appended
// anything, the PR/issue comment gets a loud note about it — nothing here
// ever waits for a human, it just makes sure the item isn't missed.
import { execFile } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const exec = promisify(execFile);

const NEEDS_HUMAN_PATH = "docs/factory/NEEDS-HUMAN.md";

export function parseSchedulerArgs(argv, defaults) {
  const opts = {
    label: defaults.label,
    limit: 5,
    interval: 0,
    from: "HEAD",
    prBase: "main",
    agent: defaults.agent,
    timeout: defaults.timeout ?? 1800000,
    openPr: false,
    comment: false,
    keep: false,
    dryRun: false,
    help: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = () => {
      const value = argv[++i];
      if (value === undefined) {
        console.error(`error: ${arg} requires a value`);
        process.exit(2);
      }
      return value;
    };
    switch (arg) {
      case "--label":
        opts.label = next();
        break;
      case "--limit":
        opts.limit = Number(next());
        break;
      case "--interval":
        opts.interval = Number(next());
        break;
      case "--from":
        opts.from = next();
        break;
      case "--pr-base":
        opts.prBase = next();
        break;
      case "--agent":
        opts.agent = next();
        break;
      case "--timeout":
        opts.timeout = Number(next());
        break;
      case "--open-pr":
        opts.openPr = true;
        break;
      case "--comment":
        opts.comment = true;
        break;
      case "--keep":
        opts.keep = true;
        break;
      case "--dry-run":
        opts.dryRun = true;
        break;
      case "-h":
      case "--help":
        opts.help = true;
        break;
      default:
        console.error(`error: unknown argument: ${arg}`);
        process.exit(2);
    }
  }
  return opts;
}

export function helpText(engineName, defaultLabel) {
  return `Poll labeled GitHub issues and run ${engineName} on each in an isolated worktree.

Options:
  --label <name>      Issue label to poll (default: ${defaultLabel})
  --limit <n>         Max issues per pass (default: 5)
  --interval <sec>    Loop forever with this delay; 0 runs once (default: 0)
  --from <ref>        Start worktrees from this ref (default: HEAD)
  --pr-base <branch>  Base branch for opened PRs (default: main)
  --agent <name>      Agent to drive (default: orchestrator)
  --timeout <ms>      Per-issue driver timeout (default: 1800000)
  --open-pr           Commit, push, and open a PR for changed worktrees
  --comment           Comment the run summary back on the issue
  --keep              Keep worktrees after each run
  --dry-run           Print planned actions without running anything
  -h, --help          Show this help

Safety: without --open-pr and --comment the scheduler only runs the agent and
reports locally. Issues already labeled "<label>:pr" or "<label>:skip" are
ignored. Nothing here ever waits for a human — see docs/factory/NEEDS-HUMAN.md
for how manual-test items surface instead of blocking a run.`;
}

const hasLabel = (issue, name) => (issue.labels || []).some((label) => label.name === name);

async function listIssues(label, limit) {
  try {
    const { stdout } = await exec("gh", [
      "issue",
      "list",
      "--label",
      label,
      "--state",
      "open",
      "--limit",
      String(limit),
      "--json",
      "number,title,body,labels",
    ]);
    return JSON.parse(stdout);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/no git remotes found|not a git repository/i.test(message)) {
      throw new Error("no GitHub repository configured; add a git remote and run `gh auth status`");
    }
    throw new Error(
      `gh issue list failed: ${message.split("\n").filter(Boolean).pop() ?? message}`,
    );
  }
}

function promptFor(issue) {
  return `Implement GitHub issue #${issue.number}: ${issue.title}

${issue.body || "(no body)"}

## Instructions

- This is an unattended, scheduled run: no one is watching. Do not ask a
  clarifying question and wait — make the most reasonable assumption, note it
  in your summary, and keep going.
- Plan, implement, and verify the change in this worktree.
- Follow AGENTS.md and the verification skill.
- If something needs a human to check (a real file, a UI interaction,
  focus/clipboard/terminal behavior, or a judgment call CI cannot make),
  append a dated, numbered entry to docs/factory/NEEDS-HUMAN.md and keep
  going — never stop and wait for a human response.
- Make surgical changes. Do not commit, push, or open a PR; the scheduler
  handles that.
- End with a concise summary: files changed, verification results, review
  and security findings (informational only), and anything you logged to
  docs/factory/NEEDS-HUMAN.md.`;
}

async function git(args, cwd) {
  return exec("git", args, { cwd });
}

async function needsHumanDiff(worktree) {
  try {
    const { stdout } = await git(["diff", "--", NEEDS_HUMAN_PATH], worktree);
    return stdout.trim().length > 0;
  } catch {
    return false;
  }
}

// gh issue edit --add-label fails outright if the label doesn't exist yet, so
// create it on demand. --force makes creation idempotent against a label
// that already exists.
async function ensureLabel(name) {
  await exec("gh", [
    "label",
    "create",
    name,
    "--force",
    "--description",
    "Agent factory: PR already opened for this issue",
    "--color",
    "5319E7",
  ]).catch(() => {});
}

async function runIssue(issue, opts, ctx) {
  const name = `${ctx.engine}-issue-${issue.number}`;

  if (opts.dryRun) {
    console.log(`[dry-run] #${issue.number} ${issue.title} -> worktree ${name}`);
    return;
  }

  const created = await exec(
    ctx.worktreeScript,
    ["create", name, "--from", opts.from, "--no-launch"],
    { cwd: ctx.root },
  );
  const worktree = (created.stdout.match(/^worktree:\s*(.+)$/m) || [])[1];
  const branch = (created.stdout.match(/^branch:\s*(.+)$/m) || [])[1];
  if (!worktree) throw new Error(`could not determine worktree path for #${issue.number}`);
  if (!branch) throw new Error(`could not determine branch name for #${issue.number}`);

  const dir = mkdtempSync(join(tmpdir(), `${ctx.engine}-issue-`));
  const promptFile = join(dir, "prompt.md");
  writeFileSync(promptFile, promptFor(issue));

  try {
    const driveArgs = [
      "--dir",
      worktree,
      "--agent",
      opts.agent,
      "--prompt-file",
      promptFile,
      "--title",
      `#${issue.number} ${issue.title}`,
      "--timeout",
      String(opts.timeout),
      ...ctx.extraDriveArgs,
    ];
    const { stdout: summary } = await exec(process.execPath, [ctx.driverScript, ...driveArgs], {
      cwd: ctx.root,
      maxBuffer: 32 * 1024 * 1024,
    });
    console.log(`[#${issue.number}] ${summary.trim().slice(0, 500)}`);

    const status = await git(["status", "--porcelain"], worktree);
    const changed = status.stdout.trim().length > 0;
    const flaggedForHuman = await needsHumanDiff(worktree);
    const humanNote = flaggedForHuman
      ? `\n\n⚠️ New items in ${NEEDS_HUMAN_PATH} — review when you're back. This did not block the run.`
      : "";

    if (changed && opts.openPr) {
      await git(["add", "-A"], worktree);
      await git(["commit", "-m", `feat: #${issue.number} ${issue.title}`], worktree);
      await git(["push", "-u", "origin", branch], worktree);
      const { stdout: prUrl } = await exec(
        "gh",
        [
          "pr",
          "create",
          "--head",
          branch,
          "--base",
          opts.prBase,
          "--title",
          `#${issue.number} ${issue.title}`,
          "--body",
          `Closes #${issue.number}\n\n${summary.trim()}${humanNote}`,
        ],
        { cwd: worktree },
      );
      console.log(`[#${issue.number}] PR: ${prUrl.trim()}`);
      await ensureLabel(`${opts.label}:pr`);
      await exec("gh", [
        "issue",
        "edit",
        String(issue.number),
        "--add-label",
        `${opts.label}:pr`,
      ]).catch(() => {});
    } else if (opts.comment) {
      await exec("gh", [
        "issue",
        "comment",
        String(issue.number),
        "--body",
        summary.trim() + humanNote,
      ]);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
    if (!opts.keep) {
      await exec(ctx.worktreeScript, ["remove", name, "--force"], { cwd: ctx.root }).catch(
        () => {},
      );
    }
  }
}

async function pass(opts, ctx) {
  const issues = await listIssues(opts.label, opts.limit);
  const pending = issues.filter(
    (issue) => !hasLabel(issue, `${opts.label}:pr`) && !hasLabel(issue, `${opts.label}:skip`),
  );

  if (pending.length === 0) {
    console.log(`no pending issues with label "${opts.label}"`);
    return;
  }

  for (const issue of pending) {
    try {
      await runIssue(issue, opts, ctx);
    } catch (error) {
      console.error(
        `[#${issue.number}] failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}

// ctx: { engine: "opencode"|"claude", root, worktreeScript, driverScript, extraDriveArgs: string[] }
export async function runScheduler(opts, ctx) {
  if (!Number.isFinite(opts.interval) || opts.interval < 0) {
    console.error("error: --interval must be a non-negative number");
    process.exit(2);
  }

  do {
    await pass(opts, ctx);
    if (opts.interval > 0)
      await new Promise((resolve) => setTimeout(resolve, opts.interval * 1000));
  } while (opts.interval > 0);
}
