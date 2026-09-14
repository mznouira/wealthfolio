import { strict as assert } from "node:assert";
import { test } from "node:test";
import { Guard } from "../../.opencode/plugins/guard.ts";

const calls = [];
const fake$ = (strings, ...values) => {
  calls.push(strings.join("|") + " " + values.join(","));
  return { cwd: () => ({ quiet: async () => {} }) };
};

const hooks = () => Guard({ $: fake$, directory: "/repo" }, {});

test("blocks secret reads but allows examples", async () => {
  const h = await hooks();
  const before = h["tool.execute.before"];

  await assert.rejects(() => before({ tool: "read" }, { args: { filePath: ".env" } }));
  await assert.rejects(() => before({ tool: "read" }, { args: { filePath: "/repo/.env.local" } }));
  await assert.rejects(() => before({ tool: "read" }, { args: { filePath: ".npmrc" } }));
  await assert.rejects(() => before({ tool: "read" }, { args: { filePath: "~/.ssh/id_rsa" } }));

  await before({ tool: "read" }, { args: { filePath: ".env.example" } });
  await before({ tool: "read" }, { args: { filePath: ".env.web.example" } });
  await before({ tool: "read" }, { args: { filePath: "src/app.ts" } });
});

test("blocks destructive shell but allows normal commands", async () => {
  const h = await hooks();
  const before = h["tool.execute.before"];

  await assert.rejects(() => before({ tool: "bash" }, { args: { command: "rm -rf /tmp/x" } }));
  await assert.rejects(() =>
    before({ tool: "bash" }, { args: { command: "git push --force origin main" } }),
  );
  await assert.rejects(() => before({ tool: "bash" }, { args: { command: "git push -f" } }));
  await assert.rejects(() =>
    before({ tool: "bash" }, { args: { command: "git reset --hard HEAD~1" } }),
  );
  await assert.rejects(() => before({ tool: "bash" }, { args: { command: "cargo publish" } }));

  await before({ tool: "bash" }, { args: { command: "git push origin feature/x" } });
  await before({ tool: "bash" }, { args: { command: "pnpm test" } });
});

test("dispatches formatting by extension", async () => {
  calls.length = 0;
  const h = await hooks();
  const after = h["tool.execute.after"];

  await after({ tool: "edit", args: { filePath: "src/app.ts" } }, {});
  await after({ tool: "write", args: { filePath: "crates/core/src/lib.rs" } }, {});
  await after({ tool: "edit", args: { filePath: "Cargo.toml" } }, {});

  assert.equal(calls.length, 2);
  assert.match(calls[0], /prettier/);
  assert.match(calls[1], /rustfmt/);
});
