import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { createToolchainBashOptions } from "./toolchain-bash.ts";

const POLL_INTERVAL_MS = 50;
const windowsSystemEntry = /[\\/]windows(?:[\\/]|$)/i;

function withoutWindowsSystemPath(extraPathEntries = []) {
  const saved = new Map();
  for (const name of Object.keys(process.env)) {
    if (name.toLowerCase() !== "path") continue;
    saved.set(name, process.env[name]);
    const kept = (process.env[name] ?? "").split(";").filter((entry) => !windowsSystemEntry.test(entry));
    process.env[name] = [...extraPathEntries, ...kept].join(";");
  }
  return () => {
    for (const [name, value] of saved) process.env[name] = value;
  };
}

function isAlive(processId) {
  try {
    process.kill(processId, 0);
    return true;
  } catch (error) {
    return error.code !== "ESRCH";
  }
}

async function waitUntil(predicate, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) return false;
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
  return true;
}

async function readReportedShellPid(filePath, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const reported = Number(readFileSync(filePath, "utf8").trim());
      if (Number.isSafeInteger(reported) && reported > 0) return reported;
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
  return Number.NaN;
}

function context(commands) {
  return {
    inventoryRevision: 21,
    resolutionId: "resolution-21",
    cwd: "/workspace",
    intent: "agent-shell",
    commands,
    nativeEnv: { PATH: "/native" },
    shellEnv: { PATH: "/resolved/bin:/usr/bin", PI_DESKTOP_TOOLCHAIN_REVISION: "21" },
    summary: [],
  };
}

test("pins Agent Bash to the resolved executable and context-local environment", () => {
  // The host may legitimately export this revision (e.g. running the suite
  // inside Dexon's own Agent Bash) — the assertions below require the
  // function under test to be its only source, so pin the host value here.
  const hostRevision = process.env.PI_DESKTOP_TOOLCHAIN_REVISION;
  delete process.env.PI_DESKTOP_TOOLCHAIN_REVISION;
  try {
    return runAssertions();
  } finally {
    if (hostRevision === undefined) delete process.env.PI_DESKTOP_TOOLCHAIN_REVISION;
    else process.env.PI_DESKTOP_TOOLCHAIN_REVISION = hostRevision;
  }

  function runAssertions() {
    const descriptor = {
      capability: "shell.bash",
      provider: "system",
      executable: "/resolved/bin/bash",
      argvPrefix: [],
      binDir: "/resolved/bin",
      version: "5.2.0",
      cwdSemantics: "posix",
      envPatch: {},
    };
    const options = createToolchainBashOptions(context({ "shell.bash": descriptor }), undefined, "source profile");
    assert.equal(options.shellPath, "/resolved/bin/bash");
    assert.equal(options.commandPrefix, "source profile");
    const spawned = options.spawnHook({ command: "/resolved/bin/bash", args: [], env: { KEEP: "yes" } });
    assert.deepEqual(spawned.env, {
      KEEP: "yes",
      PATH: "/resolved/bin:/usr/bin",
      PI_DESKTOP_TOOLCHAIN_REVISION: "21",
    });
    assert.equal(process.env.PI_DESKTOP_TOOLCHAIN_REVISION, undefined);
  }
});

test("removes host credentials from Agent Bash environment", () => {
  const descriptor = {
    capability: "shell.bash",
    provider: "system",
    executable: "/resolved/bin/bash",
    argvPrefix: [],
    binDir: "/resolved/bin",
    version: "5.2.0",
    cwdSemantics: "posix",
    envPatch: {},
  };
  const toolContext = context({ "shell.bash": descriptor });
  toolContext.shellEnv.XAI_API_KEY = "provider-secret";
  toolContext.shellEnv.CLI_PROXY_API_KEY = "proxy-secret";
  const options = createToolchainBashOptions(toolContext);
  const spawned = options.spawnHook({
    command: "/resolved/bin/bash",
    args: [],
    env: { GITHUB_TOKEN: "github-secret", SAFE_VALUE: "kept" },
  });
  assert.equal(spawned.env.XAI_API_KEY, undefined);
  assert.equal(spawned.env.CLI_PROXY_API_KEY, undefined);
  assert.equal(spawned.env.GITHUB_TOKEN, undefined);
  assert.equal(spawned.env.SAFE_VALUE, "kept");
});

test("reports structured Bash absence and never falls back to PATH", async () => {
  const missing = Object.assign(new Error("Bash required"), {
    code: "TOOLCHAIN_BASH_REQUIRED",
    capability: "shell.bash",
  });
  const runtime = {
    requireFromContext(capability) {
      assert.equal(capability, "shell.bash");
      throw missing;
    },
  };
  const options = createToolchainBashOptions(context({}), runtime);
  await assert.rejects(options.operations.exec("echo test", { cwd: "/workspace" }), missing);
});

test("aborting a running Bash command survives a PATH without System32", async (t) => {
  if (process.platform !== "win32") {
    t.skip("the unavailable taskkill failure exists only on Windows");
    return;
  }
  const gitBash = path.win32.join(process.env.ProgramFiles ?? "C:\\Program Files", "Git", "bin", "bash.exe");
  if (!existsSync(gitBash)) {
    t.skip(`Git Bash is not installed at ${gitBash}`);
    return;
  }
  const workspace = mkdtempSync(path.join(tmpdir(), "dexon-bash-abort-"));
  const shellPidFile = path.join(workspace, "shell.pid");
  const controller = new globalThis.AbortController();
  const crashes = [];
  const recordCrash = (error) => crashes.push(error);
  process.on("uncaughtException", recordCrash);
  const gitRoot = path.win32.dirname(path.win32.dirname(gitBash));
  const restorePath = withoutWindowsSystemPath([path.win32.dirname(gitBash), path.win32.join(gitRoot, "usr", "bin")]);
  try {
    const descriptor = {
      capability: "shell.bash",
      provider: "system",
      executable: gitBash,
      argvPrefix: [],
      binDir: path.win32.dirname(gitBash),
      version: "5.2.0",
      cwdSemantics: "native",
      envPatch: {},
    };
    const options = createToolchainBashOptions(context({ "shell.bash": descriptor }));
    const running = options.operations.exec("cat /proc/$$/winpid > shell.pid; sleep 30", workspace, {
      onData: () => {},
      signal: controller.signal,
    });
    const shellProcessId = await readReportedShellPid(shellPidFile, 20_000);
    assert.ok(Number.isSafeInteger(shellProcessId), "the running command must report its shell process");
    assert.equal(isAlive(shellProcessId), true);
    controller.abort();
    const outcome = await running.then(
      () => ({ settled: "resolved", message: "" }),
      (error) => ({ settled: "rejected", message: error.message }),
    );
    assert.equal(outcome.settled, "rejected", "an aborted command must not report success");
    assert.match(outcome.message, /aborted/u);
    await new Promise((resolve) => setTimeout(resolve, 500));
    assert.deepEqual(crashes, []);
    assert.ok(await waitUntil(() => !isAlive(shellProcessId), 20_000), "the aborted shell must exit");
  } finally {
    restorePath();
    process.off("uncaughtException", recordCrash);
    rmSync(workspace, { recursive: true, force: true });
  }
});
