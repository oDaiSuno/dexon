import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, truncateSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { SessionManager, CredentialSynchronizationError } from "@earendil-works/pi-coding-agent";
import { loadHandlersModule, captureHandlers, root } from "./handlers-test-support.mjs";

test("registerHandlers exposes every contract method exactly once", async () => {
  const { handlers } = await captureHandlers();
  assert.equal(Object.keys(handlers).length, 94);
  for (const method of [
    "host.ping",
    "host.toolchain",
    "sessions.list",
    "sessions.contextPage",
    "sessions.entryContent",
    "worktrees.list",
    "git.status",
    "git.branch",
    "git.headContent",
    "agent.state",
    "channels.list",
    "channels.accountConnect",
    "files.list",
    "files.download",
    "models.list",
    "models.refresh",
    "models.refreshCancel",
    "models.preferences.get",
    "models.preferences.set",
    "models.defaults.get",
    "models.defaults.set",
    "auth.providers",
    "skills.list",
    "plugins.list",
    "plugins.markReloaded",
    "processes.list",
    "processes.read",
    "processes.wait",
    "processes.stop",
    "processes.restart",
    "processes.export",
    "processes.clearFinished",
    "system.allowRoot",
  ]) {
    assert.equal(typeof handlers[method], "function", `${method} must be registered`);
  }
});

test("agent.new uses a unique temporary lock key for every request", async () => {
  const { createAgentNewLockKey } = await loadHandlersModule();
  const keys = Array.from({ length: 1_000 }, () => createAgentNewLockKey());

  assert.equal(new Set(keys).size, keys.length);
  assert.ok(keys.every((key) => /^__new__[0-9a-f-]{36}$/.test(key)));
});

test("conditional auto-title writes never replace a manual session name", async (t) => {
  const fixtureDirectory = path.join(process.env.PI_CODING_AGENT_SESSION_DIR, "auto-title-fixture");
  mkdirSync(fixtureDirectory, { recursive: true });
  t.after(() => rmSync(fixtureDirectory, { recursive: true, force: true }));

  const createFixture = (sessionId) => {
    const sessionPath = path.join(fixtureDirectory, `2026-08-16T00-00-00-000Z_${sessionId}.jsonl`);
    writeFileSync(
      sessionPath,
      `${JSON.stringify({
        type: "session",
        version: 3,
        id: sessionId,
        timestamp: "2026-08-16T00:00:00.000Z",
        cwd: root,
      })}\n`,
      "utf8",
    );
    return sessionPath;
  };

  const guardedSessionId = "auto-title-guarded";
  const guardedPath = createFixture(guardedSessionId);
  const concurrentSessionId = "auto-title-concurrent";
  const concurrentPath = createFixture(concurrentSessionId);
  const { handlers } = await captureHandlers();
  const { applySessionNameIfEmpty } = await loadHandlersModule();
  await handlers["sessions.list"]();

  assert.equal(await applySessionNameIfEmpty(guardedSessionId, "Automatic title"), true);
  await handlers["sessions.rename"]({ id: guardedSessionId, name: "Manual title" });
  assert.equal(await applySessionNameIfEmpty(guardedSessionId, "Late automatic title"), false);
  assert.equal(SessionManager.open(guardedPath).getSessionName(), "Manual title");

  await Promise.all([
    applySessionNameIfEmpty(concurrentSessionId, "Automatic title"),
    handlers["sessions.rename"]({ id: concurrentSessionId, name: "Concurrent manual title" }),
  ]);
  assert.equal(SessionManager.open(concurrentPath).getSessionName(), "Concurrent manual title");
});

test("channel initialization failure is reported without an unhandled rejection", async () => {
  const { initializeChannels } = await loadHandlersModule();
  const reports = [];
  initializeChannels(
    {
      async initialize() {
        throw new Error("media init failed?token=sensitive-token");
      },
    },
    (message) => reports.push(message),
  );
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(reports, ["media init failed?token=[REDACTED]"]);
});

test("credential mutation failures distinguish committed state from an unverified mutation", async () => {
  const { credentialMutationFailure } = await loadHandlersModule();
  const synchronizationError = new CredentialSynchronizationError("test-provider", "setRuntimeApiKey", undefined, {
    cause: new Error("secret upstream detail"),
  });

  const committed = await credentialMutationFailure(
    {
      async listCredentials() {
        return [{ providerId: "test-provider", type: "api_key" }];
      },
      async refresh() {
        throw new Error("secret retry detail");
      },
    },
    "test-provider",
    { present: true, type: "api_key" },
    synchronizationError,
  );
  assert.deepEqual(committed, {
    ok: true,
    synchronized: false,
    warning: {
      code: "MODEL_SYNC_FAILED",
      message: "Credentials were updated, but the local model state could not be refreshed. Retry model refresh.",
    },
  });
  assert.doesNotMatch(JSON.stringify(committed), /secret/);

  await assert.rejects(
    credentialMutationFailure(
      {
        async listCredentials() {
          return [];
        },
        async refresh() {
          throw new Error("must not refresh");
        },
      },
      "test-provider",
      { present: true, type: "api_key" },
      synchronizationError,
    ),
    (error) => error?.code === "INTERNAL" && !String(error?.message).includes("secret"),
  );
});

test("model list projection isolates provider availability failures and keeps the last known state", async () => {
  const { projectModelsList } = await loadHandlersModule();
  const goodModel = { id: "fresh", name: "Fresh model", provider: "good", reasoning: false, input: ["text", "image"] };
  const cachedModel = { id: "cached", name: "Cached model", provider: "broken", reasoning: false, input: ["text"] };
  const result = await projectModelsList(
    {
      getProviders() {
        return [{ id: "good" }, { id: "broken" }];
      },
      getAvailableSnapshot() {
        return [cachedModel];
      },
      async getAvailable(providerId) {
        if (providerId === "good") return [goodModel];
        throw new Error("secret provider failure detail");
      },
    },
    {
      getEnabledModels() {
        return undefined;
      },
      getDefaultProvider() {
        return undefined;
      },
      getDefaultModel() {
        return undefined;
      },
    },
    { source: "network", refreshed: true, aborted: false, warnings: [] },
  );

  assert.deepEqual(result.models.map((model) => `${model.provider}/${model.id}`).sort(), [
    "broken/cached",
    "good/fresh",
  ]);
  const projectedVision = result.models.find((model) => model.id === "fresh");
  assert.deepEqual(projectedVision?.input, ["text", "image"]);
  assert.deepEqual(result.catalog.warnings, [
    {
      provider: "broken",
      code: "PROVIDER_AVAILABILITY_FAILED",
      message: "Unable to check broken model availability; the last known state remains available.",
    },
  ]);
  assert.doesNotMatch(JSON.stringify(result), /secret provider failure detail/);
});

test("file, git, worktree, skill, plugin, and system handlers return contract-shaped results", async (t) => {
  const base = mkdtempSync(path.join(tmpdir(), "pi-handler-test-"));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const project = path.join(base, "project");
  mkdirSync(path.join(project, "nested"), { recursive: true });
  const textFile = path.join(project, "hello.txt");
  writeFileSync(textFile, "hello handler tests\n");
  const outsideFile = path.join(base, "outside.txt");
  writeFileSync(outsideFile, "must not become an allowed root\n");

  const { handlers } = await captureHandlers();
  assert.deepEqual(await handlers["system.allowRoot"]({ path: project }), { ok: true });
  assert.deepEqual(await handlers["system.validateCwd"]({ path: project }), { ok: true, path: project });
  assert.deepEqual(await handlers["system.validateCwd"]({ path: outsideFile }), {
    ok: false,
    error: "Not a directory",
  });
  await assert.rejects(
    handlers["system.allowRoot"]({ path: outsideFile }),
    (error) => error.code === "BAD_REQUEST" && /Not a directory/.test(error.message),
  );
  await assert.rejects(
    handlers["system.allowRoot"]({ path: path.join(base, "missing") }),
    (error) => error.code === "BAD_REQUEST" && /Directory does not exist/.test(error.message),
  );

  const listed = await handlers["files.list"]({ path: project });
  assert.equal(
    listed.entries.some((entry) => entry.name === "hello.txt" && entry.type === "file"),
    true,
  );

  const read = await handlers["files.read"]({ path: textFile });
  assert.equal(read.encoding, "utf8");
  assert.equal(read.content, "hello handler tests\n");

  const downloaded = await handlers["files.download"]({ path: textFile });
  assert.equal(Buffer.from(downloaded.base64, "base64").toString("utf8"), "hello handler tests\n");
  assert.equal(downloaded.size, Buffer.byteLength("hello handler tests\n"));

  const oversizedFile = path.join(project, "oversized.bin");
  writeFileSync(oversizedFile, "");
  truncateSync(oversizedFile, 50 * 1024 * 1024 + 1);
  await assert.rejects(
    handlers["files.download"]({ path: oversizedFile }),
    (error) =>
      error.code === "RESULT_TOO_LARGE" &&
      error.detail?.size === 50 * 1024 * 1024 + 1 &&
      error.detail?.maxBytes === 50 * 1024 * 1024,
  );

  const meta = await handlers["files.meta"]({ path: textFile });
  assert.equal(meta.language, "text");
  assert.equal(meta.mime, "text/plain");

  const preview = await handlers["files.preview"]({ path: textFile });
  assert.equal(preview.kind, "text");
  assert.equal(preview.content, "hello handler tests\n");

  const index = await handlers["files.index"]({ root: project, query: "hello" });
  assert.equal(Array.isArray(index.files), true);
  assert.equal(index.files.includes("hello.txt"), true);
  await assert.rejects(
    handlers["files.index"]({ root: project, query: "../outside" }),
    (error) => error.code === "BAD_REQUEST" && /Parent traversal/.test(error.message),
  );

  let deepDirectory = project;
  for (let depth = 0; depth < 9; depth += 1) {
    deepDirectory = path.join(deepDirectory, `depth-${depth}`);
    mkdirSync(deepDirectory);
  }
  writeFileSync(path.join(deepDirectory, "beyond-depth.txt"), "too deep", "utf8");
  const directIndex = await handlers["files.index"]({ root: project });
  assert.equal(
    directIndex.matches.some(
      (entry) =>
        entry.path === "depth-0/depth-1/depth-2/depth-3/depth-4/depth-5/depth-6/depth-7/depth-8/beyond-depth.txt",
    ),
    false,
  );
  assert.equal(
    directIndex.matches.some((entry) => entry.path === "depth-0" && entry.isDir),
    true,
  );
  assert.equal(directIndex.truncated, false);

  const git = await handlers["git.status"]({ path: project });
  assert.equal(git.isGit, false);

  const worktrees = await handlers["worktrees.list"]({ projectRoot: project });
  assert.equal(Array.isArray(worktrees.worktrees), true);
  assert.equal(worktrees.projectRoot, project);

  const agentState = await handlers["agent.state"]({ sessionId: "missing-session" });
  assert.deepEqual(agentState, { running: false });

  const skills = await handlers["skills.list"]({ cwd: project });
  assert.equal(Array.isArray(skills.skills), true);

  const plugins = await handlers["plugins.list"]({ cwd: project });
  assert.equal(typeof plugins, "object");

  const running = await handlers["system.runningCount"]();
  assert.equal(running.count, running.sessionIds.length);

  await handlers["files.watchStart"]({ path: project });
  assert.deepEqual(await handlers["files.watchStop"]({ path: project }), { ok: true });
});
