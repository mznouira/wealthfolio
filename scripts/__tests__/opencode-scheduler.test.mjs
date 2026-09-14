import { strict as assert } from "node:assert";
import { execFile } from "node:child_process";
import { dirname, resolve } from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const run = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const scheduler = resolve(here, "../opencode-scheduler.mjs");

test("prints help and exits cleanly", async () => {
  const { stdout } = await run(process.execPath, [scheduler, "--help"], { timeout: 20000 });
  assert.match(stdout, /Poll labeled GitHub issues/);
});

test("rejects a negative interval", async () => {
  await assert.rejects(
    () => run(process.execPath, [scheduler, "--interval", "-1"], { timeout: 20000 }),
    /non-negative/,
  );
});
