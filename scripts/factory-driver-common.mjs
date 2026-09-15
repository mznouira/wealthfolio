// Shared CLI surface for scripts/opencode-driver.mjs and scripts/claude-driver.mjs.
// The two engines are driven differently underneath (an HTTP session API vs a
// plain `claude -p` subprocess), so only the argument parsing is worth
// sharing — forcing the drive mechanics into one abstraction would hide more
// than it'd save. See .factory/README.md.
import process from "node:process";

export function baseOptions(defaults = {}) {
  return {
    agent: defaults.agent ?? "orchestrator",
    dir: process.cwd(),
    prompt: null,
    promptFile: null,
    model: null,
    title: null,
    timeout: defaults.timeout ?? 600000,
    dryRun: false,
    json: false,
    help: false,
  };
}

export const HELP_COMMON = `  --prompt <text>       Prompt to send (positional text also works)
  --prompt-file <path>  Read the prompt from a file
  --agent <name>        Agent to use (default: orchestrator)
  --model <name>        Model override
  --title <text>        Session/display title (default: first 60 chars of prompt)
  --dir <path>          Working directory (default: cwd)
  --timeout <ms>        Abort after this many ms (default: 600000, 0 disables)
  --dry-run             Validate setup and exit without sending the prompt
  --json                Print raw JSON output
  -h, --help            Show this help`;

// `extra` maps additional flag names to (opts, next) => void handlers for
// driver-specific options (e.g. opencode's --port/--server).
export function parseCommonArgs(argv, opts, extra = {}) {
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
      case "--prompt":
        opts.prompt = next();
        break;
      case "--prompt-file":
        opts.promptFile = next();
        break;
      case "--agent":
        opts.agent = next();
        break;
      case "--model":
        opts.model = next();
        break;
      case "--title":
        opts.title = next();
        break;
      case "--dir":
        opts.dir = next();
        break;
      case "--timeout":
        opts.timeout = Number(next());
        break;
      case "--dry-run":
        opts.dryRun = true;
        break;
      case "--json":
        opts.json = true;
        break;
      case "-h":
      case "--help":
        opts.help = true;
        break;
      default:
        if (extra[arg]) {
          extra[arg](opts, next);
          break;
        }
        if (!arg.startsWith("-") && opts.prompt === null) {
          opts.prompt = arg;
          break;
        }
        console.error(`error: unknown argument: ${arg}`);
        process.exit(2);
    }
  }
  return opts;
}
