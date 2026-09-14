import { strict as assert } from "node:assert";
import { execFile } from "node:child_process";
import { createServer } from "node:http";
import { dirname, resolve } from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const run = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const driver = resolve(here, "../opencode-driver.mjs");

function startMock() {
  return new Promise((resolveServer) => {
    const server = createServer((req, res) => {
      let body = "";
      req.on("data", (chunk) => (body += chunk));
      req.on("end", () => {
        const url = new URL(req.url, "http://localhost");
        const json = (value) => {
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify(value));
        };
        if (url.pathname === "/global/health") return json({ healthy: true, version: "mock" });
        if (req.method === "POST" && url.pathname === "/session") return json({ id: "ses_mock" });
        if (url.pathname === "/session/ses_mock/message") {
          const parsed = JSON.parse(body);
          return json({
            info: { id: "msg_mock" },
            parts: [{ type: "text", text: `echo:${parsed.agent}` }],
          });
        }
        res.writeHead(404);
        res.end();
      });
    });
    server.listen(0, "127.0.0.1", () => resolveServer(server));
  });
}

async function withServer(handler) {
  const server = await startMock();
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  try {
    return await handler(baseUrl);
  } finally {
    server.close();
  }
}

test("sends the agent and prints assistant text", async () => {
  await withServer(async (baseUrl) => {
    const { stdout } = await run(
      process.execPath,
      [driver, "--server", baseUrl, "--prompt", "hi", "--agent", "build"],
      { timeout: 20000 },
    );
    assert.equal(stdout.trim(), "echo:build");
  });
});

test("dry-run creates a session and exits", async () => {
  await withServer(async (baseUrl) => {
    const { stdout } = await run(
      process.execPath,
      [driver, "--server", baseUrl, "--prompt", "hi", "--dry-run"],
      { timeout: 20000 },
    );
    assert.match(stdout, /session=ses_mock/);
  });
});

test("rejects an invalid model format", async () => {
  await assert.rejects(
    () =>
      run(
        process.execPath,
        [driver, "--server", "http://127.0.0.1:1", "--prompt", "hi", "--model", "bad"],
        {
          timeout: 20000,
        },
      ),
    /provider\/model/,
  );
});
