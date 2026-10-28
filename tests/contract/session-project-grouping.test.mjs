import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { after } from "node:test";
import { MessageChannel } from "node:worker_threads";
import { importTestBundle } from "#test-bundle";
import { createRpcClient, createRpcServer } from "../../src/contract/rpc.ts";
import { installMainProcessPort } from "../fixtures/main-process-port.mjs";

const repositoryRoot = path.resolve(import.meta.dirname, "../..");
const base = realpathSync(mkdtempSync(path.join(tmpdir(), "dexon-project-grouping-")));
const agentDirectory = path.join(base, "agent");
const desktopDirectory = path.join(base, "desktop");
const sessionDirectory = path.join(agentDirectory, "sessions");
const workspaceRoot = path.join(base, "work");
for (const directory of [agentDirectory, desktopDirectory, sessionDirectory, workspaceRoot]) {
  mkdirSync(directory, { recursive: true });
}

const ENVIRONMENT = ["PI_CODING_AGENT_DIR", "PI_CODING_AGENT_SESSION_DIR", "PI_DESKTOP_USER_DATA", "PI_OFFLINE"];
const previousEnvironment = new Map(ENVIRONMENT.map((name) => [name, process.env[name]]));
process.env.PI_CODING_AGENT_DIR = agentDirectory;
process.env.PI_DESKTOP_USER_DATA = desktopDirectory;
process.env.PI_OFFLINE = "1";
delete process.env.PI_CODING_AGENT_SESSION_DIR;

const restoreMainProcessPort = installMainProcessPort();
let runtime;
let boots = 0;

after(async () => {
  try {
    if (runtime) await stopHost(runtime);
  } finally {
    restoreMainProcessPort();
    for (const [name, value] of previousEnvironment) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    rmSync(base, { recursive: true, force: true });
  }
});

const GIT_IDENTITY = ["-c", "user.name=Fixture", "-c", "user.email=fixture@example.com", "-c", "commit.gpgsign=false"];

function git(cwd, args) {
  return execFileSync("git", [...GIT_IDENTITY, "-C", cwd, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, GIT_CONFIG_NOSYSTEM: "1", GIT_TERMINAL_PROMPT: "0" },
  }).trim();
}

function initRepository(repository) {
  mkdirSync(repository, { recursive: true });
  git(repository, ["init", "--initial-branch=main"]);
  writeFileSync(path.join(repository, "README.md"), `# ${path.basename(repository)}\n`, "utf8");
  git(repository, ["add", "README.md"]);
  git(repository, ["commit", "-m", "fixture repository"]);
  return realpathSync(repository);
}

function createRepository(name) {
  return initRepository(path.join(workspaceRoot, name));
}

function addWorktree(repository, worktreePath, branch) {
  git(repository, ["worktree", "add", worktreePath, "-b", branch]);
  return realpathSync(worktreePath);
}

const dexonRepository = createRepository("dexon");
const dexonWorktree = addWorktree(dexonRepository, path.join(workspaceRoot, "dexon-issue-39"), "issue-39");
const appRepository = createRepository("app");
const appWorktree = addWorktree(appRepository, path.join(workspaceRoot, "app-issue-40"), "issue-40");
const appManualWorktree = addWorktree(appRepository, path.join(workspaceRoot, "app-issue-41"), "issue-41");
const liveOnlyWorktree = addWorktree(appRepository, path.join(workspaceRoot, "app-issue-42"), "issue-42");
const legacyRepository = createRepository("legacy");
const legacyInsideWorktree = path.join(legacyRepository, ".worktrees", "gone");
const legacyClassicWorktree = path.join(workspaceRoot, "legacy-worktrees", "old-branch");
const legacyModelRestoreWorktree = path.join(workspaceRoot, "legacy-model-restore");
const legacyIssueTenWorktree = path.join(workspaceRoot, "legacy-issue-10");
const outerRepository = createRepository("outer");
const innerRepository = initRepository(path.join(outerRepository, "packages", "inner"));
const innerGoneWorktree = path.join(innerRepository, ".worktrees", "gone");
const strayWorktree = addWorktree(appRepository, path.join(outerRepository, ".worktrees", "app-stray"), "issue-43");

function messageEntry(id, parentId, timestamp, message) {
  return { type: "message", id, parentId, timestamp, message: { ...message, timestamp: Date.parse(timestamp) } };
}

function sessionLines(id, cwd, parentSession) {
  const timestamp = "2026-08-06T09:00:00.000Z";
  return [
    { type: "session", version: 3, id, timestamp, cwd, ...(parentSession ? { parentSession } : {}) },
    messageEntry(`${id}-ask`, null, "2026-08-06T09:00:01.000Z", {
      role: "user",
      content: [{ type: "text", text: `Ask ${id}` }],
    }),
    messageEntry(`${id}-answer`, `${id}-ask`, "2026-08-06T09:00:02.000Z", {
      role: "assistant",
      content: [{ type: "text", text: `Answer ${id}` }],
      provider: "fixture",
      model: "fixture",
    }),
  ];
}

function writeSessionFile({ folder, id, cwd, parentSession }) {
  const directory = path.join(sessionDirectory, folder);
  mkdirSync(directory, { recursive: true });
  const filePath = path.join(directory, `2026-08-06T09-00-00-000Z_${id}.jsonl`);
  const lines = sessionLines(id, cwd, parentSession).map((line) => JSON.stringify(line));
  writeFileSync(filePath, `${lines.join("\n")}\n`, "utf8");
  return filePath;
}

function appendAnswer(filePath, id, parentId, second) {
  const timestamp = new Date(Date.UTC(2026, 7, 6, 9, 0, second)).toISOString();
  const entry = messageEntry(id, parentId, timestamp, {
    role: "assistant",
    content: [{ type: "text", text: `Answer ${id}` }],
    provider: "fixture",
    model: "fixture",
  });
  const line = `${JSON.stringify(entry)}\n`;
  appendFileSync(filePath, line, "utf8");
  appendedText.set(filePath, `${appendedText.get(filePath) ?? ""}${line}`);
  return id;
}

function writeLegacySession(id, cwd, parentSession) {
  return writeSessionFile({ folder: "legacy", id, cwd, parentSession });
}

const dexonSessionFiles = {
  coordinator: writeSessionFile({ folder: "dexon", id: "coordinator", cwd: dexonRepository }),
  "pr-session": writeSessionFile({ folder: "dexon", id: "pr-session", cwd: dexonWorktree }),
  "worker-a": writeSessionFile({ folder: "dexon", id: "worker-a", cwd: dexonWorktree }),
  "worker-b": writeSessionFile({ folder: "dexon", id: "worker-b", cwd: dexonWorktree }),
};

const appSessionFiles = {
  "app-coordinator": writeSessionFile({ folder: "app", id: "app-coordinator", cwd: appRepository }),
  "app-pr": writeSessionFile({ folder: "app", id: "app-pr", cwd: appWorktree }),
  "app-worker": writeSessionFile({ folder: "app", id: "app-worker", cwd: appWorktree }),
  "app-manual": writeSessionFile({ folder: "app", id: "app-manual", cwd: appManualWorktree }),
};

const orphanRootFile = writeLegacySession("orphan-root", legacyIssueTenWorktree);
const straySessionFile = writeSessionFile({ folder: "app", id: "app-stray", cwd: strayWorktree });
const innerGoneFile = writeSessionFile({ folder: "nested", id: "inner-gone", cwd: innerGoneWorktree });

const legacySessionFiles = {
  "legacy-inside": writeLegacySession("legacy-inside", legacyInsideWorktree),
  "legacy-classic": writeLegacySession("legacy-classic", legacyClassicWorktree),
  "legacy-creator": writeLegacySession("legacy-creator", legacyRepository),
  "legacy-delegated": writeLegacySession("legacy-delegated", legacyModelRestoreWorktree),
  "legacy-grandchild": writeLegacySession("legacy-grandchild", legacyModelRestoreWorktree),
  "legacy-loner": writeLegacySession("legacy-loner", legacyModelRestoreWorktree),
  "orphan-fork": writeLegacySession("orphan-fork", legacyIssueTenWorktree, orphanRootFile),
};

const delegateCreators = {
  "pr-session": "coordinator",
  "worker-a": "pr-session",
  "worker-b": "pr-session",
  "app-pr": "app-coordinator",
  "app-worker": "app-pr",
  "legacy-delegated": "legacy-creator",
  "legacy-grandchild": "legacy-delegated",
};

writeFileSync(
  path.join(desktopDirectory, "session-origins.json"),
  JSON.stringify(
    {
      version: 1,
      sessions: Object.fromEntries(
        Object.entries(delegateCreators).map(([sessionId, createdBySessionId]) => [
          sessionId,
          { relation: "delegate", createdBySessionId, createdAt: "2026-08-06T00:00:00.000Z" },
        ]),
      ),
    },
    null,
    2,
  ),
  "utf8",
);

const originalContents = new Map(
  [
    ...Object.values(dexonSessionFiles),
    ...Object.values(appSessionFiles),
    orphanRootFile,
    straySessionFile,
    innerGoneFile,
    ...Object.values(legacySessionFiles),
  ].map((filePath) => [filePath, readFileSync(filePath, "utf8")]),
);
const appendedText = new Map();

async function boot() {
  boots += 1;
  const loaded = await importTestBundle(`session-project-grouping-${boots}`, {
    packages: "external",
    stdin: {
      contents:
        'export { registerHandlers } from "./src/agent-host/handlers.ts";\nexport { startSessionWatcher } from "./src/agent-host/session-watcher.ts";',
      resolveDir: repositoryRoot,
      loader: "ts",
    },
  });
  const server = createRpcServer();
  const { port1, port2 } = new MessageChannel();
  server.attachPort(port1);
  const client = createRpcClient(port2);
  const cleanup = loaded.registerHandlers(server);
  const stopWatcher = loaded.startSessionWatcher(server);
  return { client, server, port1, cleanup, stopWatcher };
}

async function stopHost(current) {
  current.stopWatcher();
  await current.cleanup();
  current.client.close();
  current.server.detachPort(current.port1);
}

async function restart() {
  const current = runtime;
  await stopHost(current);
  runtime = await boot();
}

runtime = await boot();

async function listing() {
  const result = await runtime.client.call("sessions.list");
  return new Map(result.sessions.map((session) => [session.id, session]));
}

const firstListing = await listing();

async function waitForSessionEvent(events, from, sessionId, label) {
  const deadline = Date.now() + 10_000;
  for (;;) {
    const found = events.slice(from).find((event) => event.sessionId === sessionId && event.session?.id === sessionId);
    if (found) return found;
    if (Date.now() > deadline) throw new Error(`timed out after 10000ms waiting for ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

function assertSessionFilesUntouched() {
  for (const [filePath, original] of originalContents) {
    assert.equal(
      readFileSync(filePath, "utf8"),
      original + (appendedText.get(filePath) ?? ""),
      `${path.basename(filePath)} is left exactly as it was apart from the lines this test appended`,
    );
  }
}

test("a running worktree session pushed live keeps the project and parent the full list gives it, even right after a rescan", async (t) => {
  const scenarioIds = ["coordinator", "pr-session", "worker-a", "worker-b"];
  const expectedParents = {
    coordinator: undefined,
    "pr-session": "coordinator",
    "worker-a": "pr-session",
    "worker-b": "pr-session",
  };

  const first = await listing();
  for (const id of scenarioIds) {
    const row = first.get(id);
    assert.ok(row, `${id} appears in the full listing`);
    assert.equal(row.projectRoot, dexonRepository, `${id} is grouped under the main repository`);
    assert.equal(row.parentSessionId, expectedParents[id], `${id} hangs under its creator`);
  }

  const events = [];
  const unsubscribe = runtime.client.subscribe("sessions.changed", "*", (event) => events.push(event));
  t.after(unsubscribe);

  let previousEntry = "pr-session-answer";
  for (const round of [1, 2, 3]) {
    const from = events.length;
    previousEntry = appendAnswer(
      dexonSessionFiles["pr-session"],
      `pr-session-answer-${round}`,
      previousEntry,
      2 + round,
    );
    await assert.rejects(
      runtime.client.call("sessions.get", { id: `not-a-saved-session-${round}` }),
      (error) => error.code === "NOT_FOUND",
      `asking for an unknown session is refused, which is what forces a full rescan`,
    );
    const pushed = await waitForSessionEvent(
      events,
      from,
      "pr-session",
      `the live push of pr-session in round ${round}`,
    );
    assert.equal(
      pushed.session.projectRoot,
      dexonRepository,
      `round ${round}: the pushed session is grouped under the main repository, not under the worktree folder`,
    );
    assert.equal(pushed.session.parentSessionId, "coordinator", `round ${round}: the pushed session keeps its creator`);
  }

  const refreshed = await listing();
  const prRow = refreshed.get("pr-session");
  const lastPush = events.filter((event) => event.sessionId === "pr-session" && event.session).at(-1);
  for (const field of ["projectRoot", "parentSessionId", "relation", "createdBySessionId", "worktreeBranch"]) {
    assert.equal(lastPush.session[field], prRow[field], `the live push and the refreshed list agree on ${field}`);
  }
  assert.equal(prRow.worktreeBranch, "issue-39", "the worktree session still names its branch");
  for (const id of scenarioIds) {
    assert.equal(refreshed.get(id).projectRoot, first.get(id).projectRoot, `${id} keeps its project after the rescan`);
    assert.equal(
      refreshed.get(id).parentSessionId,
      first.get(id).parentSessionId,
      `${id} keeps its parent after the rescan`,
    );
  }
  assert.deepEqual(
    [...new Set(scenarioIds.map((id) => refreshed.get(id).projectRoot))],
    [dexonRepository],
    "the four sessions still form exactly one project group",
  );
});

test("after a worktree that held a session tree is deleted and Dexon restarts, the whole tree and a manually opened session stay under the main repository", async (t) => {
  const scenarioIds = ["app-coordinator", "app-pr", "app-worker", "app-manual"];

  const before = await listing();
  for (const id of scenarioIds) {
    const row = before.get(id);
    assert.ok(row, `${id} appears while the worktree still exists`);
    assert.equal(
      row.projectRoot,
      appRepository,
      `${id} is grouped under the main repository while the worktree exists`,
    );
  }

  for (const worktree of [appWorktree, appManualWorktree]) {
    git(appRepository, ["worktree", "remove", "--force", worktree]);
    assert.equal(existsSync(worktree), false, `${path.basename(worktree)} folder is gone from disk`);
  }

  await restart();

  const rows = await listing();
  for (const id of scenarioIds) {
    const row = rows.get(id);
    assert.ok(row, `${id} is still listed after the restart`);
    assert.equal(
      row.projectRoot,
      appRepository,
      `${id} is still grouped under the main repository after its worktree folder was deleted`,
    );
  }
  assert.equal(rows.get("app-pr").parentSessionId, "app-coordinator", "the delegated session keeps its creator");
  assert.equal(rows.get("app-worker").parentSessionId, "app-pr", "the grandchild session keeps its creator");
  assert.equal(rows.get("app-manual").parentSessionId, undefined, "the manually opened session hangs under nobody");

  const events = [];
  const unsubscribe = runtime.client.subscribe("sessions.changed", "*", (event) => events.push(event));
  t.after(unsubscribe);

  for (const [id, second] of [
    ["app-pr", 11],
    ["app-manual", 12],
  ]) {
    const from = events.length;
    appendAnswer(appSessionFiles[id], `${id}-answer-after-removal`, `${id}-answer`, second);
    const pushed = await waitForSessionEvent(events, from, id, `the live push of ${id} after its worktree was deleted`);
    assert.equal(
      pushed.session.projectRoot,
      appRepository,
      `the live push of ${id} after its worktree was deleted stays under the main repository`,
    );
    assert.equal(
      pushed.session.parentSessionId,
      rows.get(id).parentSessionId,
      `the live push of ${id} keeps the same parent as the full list`,
    );
  }

  assertSessionFilesUntouched();
});

test("sessions of worktrees deleted before they were ever remembered find their project through parent folders or their creator, and the rest keep their own complete groups", async (t) => {
  for (const folder of [
    legacyInsideWorktree,
    legacyClassicWorktree,
    legacyModelRestoreWorktree,
    legacyIssueTenWorktree,
  ]) {
    assert.equal(existsSync(folder), false, `${folder} never existed`);
  }

  const expectedLegacy = {
    "legacy-inside": { projectRoot: legacyRepository, description: "a worktree inside the repository joins it" },
    "legacy-classic": {
      projectRoot: legacyRepository,
      worktreeBranch: "old-branch",
      description: "a removed worktree folder joins its repository",
    },
    "legacy-delegated": {
      projectRoot: legacyRepository,
      parentSessionId: "legacy-creator",
      description: "a delegated session joins its creator",
    },
    "legacy-grandchild": {
      projectRoot: legacyRepository,
      parentSessionId: "legacy-delegated",
      description: "a grandchild session joins its ancestor",
    },
    "legacy-loner": { projectRoot: legacyModelRestoreWorktree, description: "an unrelated session keeps its group" },
    "orphan-root": { projectRoot: legacyIssueTenWorktree, description: "the root of an unknown tree keeps its group" },
    "orphan-fork": {
      projectRoot: legacyIssueTenWorktree,
      parentSessionId: "orphan-root",
      description: "a fork joins its unknown root",
    },
  };

  const assertLegacyRows = (rows, when) => {
    for (const [id, { projectRoot, parentSessionId, worktreeBranch, description }] of Object.entries(expectedLegacy)) {
      const row = rows.get(id);
      assert.ok(row, `${when}${id} is listed`);
      assert.equal(row.projectRoot, projectRoot, `${when}${description}`);
      if (worktreeBranch)
        assert.equal(row.worktreeBranch, worktreeBranch, `${when}${id} keeps the branch name ${worktreeBranch}`);
      if (parentSessionId) assert.equal(row.parentSessionId, parentSessionId, `${when}${description}`);
    }
    for (const id of ["legacy-loner", "orphan-root"]) {
      assert.equal(rows.get(id).parentSessionId, undefined, `${when}${id} hangs under nobody`);
    }
  };
  assertLegacyRows(firstListing, "on the first listing: ");
  assertLegacyRows(await listing(), "after refreshing: ");

  const events = [];
  const unsubscribe = runtime.client.subscribe("sessions.changed", "*", (event) => events.push(event));
  t.after(unsubscribe);

  for (const [id, projectRoot, parentSessionId, second] of [
    ["legacy-delegated", legacyRepository, "legacy-creator", 21],
    ["orphan-fork", legacyIssueTenWorktree, "orphan-root", 22],
  ]) {
    const from = events.length;
    appendAnswer(legacySessionFiles[id], `${id}-answer-after-removal`, `${id}-answer`, second);
    const pushed = await waitForSessionEvent(events, from, id, `the live push of ${id} after its worktree is gone`);
    assert.equal(
      pushed.session.projectRoot,
      projectRoot,
      `the live push of ${id} lands in the same project as the full list`,
    );
    assert.equal(
      pushed.session.parentSessionId,
      parentSessionId,
      `the live push of ${id} keeps the same parent as the full list`,
    );
  }

  assertSessionFilesUntouched();
});

test("when a new session in a worktree is only ever pushed live and the worktree is then deleted, it still belongs to the main repository after a restart", async (t) => {
  const events = [];
  const unsubscribe = runtime.client.subscribe("sessions.changed", "*", (event) => events.push(event));
  t.after(unsubscribe);

  const liveOnlyFile = writeSessionFile({ folder: "app", id: "app-live-only", cwd: liveOnlyWorktree });
  const writtenContent = readFileSync(liveOnlyFile, "utf8");

  const pushed = await waitForSessionEvent(
    events,
    0,
    "app-live-only",
    "the first live push of a session in a brand-new worktree",
  );
  assert.equal(
    pushed.session.projectRoot,
    appRepository,
    "the first live push of a brand-new worktree session is grouped under the main repository",
  );

  git(appRepository, ["worktree", "remove", "--force", liveOnlyWorktree]);
  assert.equal(existsSync(liveOnlyWorktree), false, `${path.basename(liveOnlyWorktree)} folder is gone from disk`);

  await restart();

  const row = (await listing()).get("app-live-only");
  assert.ok(row, "the session that was only ever pushed live is still listed after the restart");
  assert.equal(
    row.projectRoot,
    appRepository,
    "a session only ever pushed live stays under the main repository after its worktree was deleted",
  );
  assert.equal(row.parentSessionId, undefined, "the session that was only ever pushed live hangs under nobody");
  assert.equal(
    readFileSync(liveOnlyFile, "utf8"),
    writtenContent,
    "the session file is left exactly as this test wrote it",
  );
});

test("a deleted worktree keeps the project it was remembered with even inside another repository, and an unremembered one joins the nearest enclosing repository", async () => {
  const strayFirst = firstListing.get("app-stray");
  const unrememberedFirst = firstListing.get("inner-gone");
  assert.ok(strayFirst, "app-stray is listed on the first listing");
  assert.ok(unrememberedFirst, "inner-gone is listed on the first listing");
  assert.equal(
    strayFirst.projectRoot,
    appRepository,
    "on the first listing: a worktree of app placed inside another repository belongs to app",
  );
  assert.equal(
    unrememberedFirst.projectRoot,
    innerRepository,
    "on the first listing: an unremembered deleted worktree joins the nearest enclosing repository, not an outer one",
  );

  git(appRepository, ["worktree", "remove", "--force", strayWorktree]);
  assert.equal(existsSync(strayWorktree), false, "the stray worktree folder is gone from disk");

  await restart();

  const rows = await listing();
  const strayAfter = rows.get("app-stray");
  const unrememberedAfter = rows.get("inner-gone");
  assert.ok(strayAfter, "app-stray is still listed after the restart");
  assert.ok(unrememberedAfter, "inner-gone is still listed after the restart");
  assert.equal(
    strayAfter.projectRoot,
    appRepository,
    "after its folder inside another repository was deleted, the worktree session still belongs to the repository it was remembered with",
  );
  assert.equal(
    unrememberedAfter.projectRoot,
    innerRepository,
    "after refreshing: an unremembered deleted worktree joins the nearest enclosing repository, not an outer one",
  );

  assertSessionFilesUntouched();
});
