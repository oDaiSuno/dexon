import { importTestBundle } from "#test-bundle";
import assert from "node:assert/strict";
import { lstat, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { MessageChannel } from "node:worker_threads";
import { createRpcClient, createRpcServer } from "../contract/rpc.ts";
import {
  AUTOMATION_WORKSPACE_SEGMENTS,
  automationWorkspaceRoot,
  prepareAutomationWorkspaceRoot,
  isManagedTaskDirectory,
  ensureManagedTaskDirectory,
  cleanupManagedTaskDirectory,
} from "./automation-workspace.ts";

const agentDirectory = await mkdtemp(path.join(tmpdir(), "dexon-workspace-handlers-agent-"));
process.env.PI_CODING_AGENT_DIR = agentDirectory;
process.env.PI_CODING_AGENT_SESSION_DIR = path.join(agentDirectory, "sessions");
process.env.PI_OFFLINE = "1";
test.after(() => rm(agentDirectory, { recursive: true, force: true }));

const { registerHostHandlers, isFilePathAllowed, getAllowedRootsGeneration } = await importTestBundle(
  "src/agent-host/automation-workspace-host",
  {
    packages: "external",
    stdin: {
      contents:
        'export { registerHostHandlers } from "./handlers/host.ts"; export { isFilePathAllowed } from "./file-access.ts"; export { getAllowedRootsGeneration } from "../shared/allowed-roots.ts";',
      resolveDir: import.meta.dirname,
      sourcefile: "automation-workspace-host-entry.ts",
      loader: "ts",
    },
  },
);
const { createEnvironmentApiClient } = await importTestBundle("automation-workspace-environment-client", {
  entryPoints: ["src/renderer/lib/environment-connection.ts"],
  tsconfig: "tsconfig.renderer.json",
});

function apiFixture(t, home) {
  const server = createRpcServer();
  registerHostHandlers(server, { getHome: () => home });
  const { port1, port2 } = new MessageChannel();
  server.attachPort(port1);
  const rpc = createRpcClient(port2);
  const api = createEnvironmentApiClient({
    call: rpc.call.bind(rpc),
    subscribe: async (...args) => rpc.subscribe(...args),
  });
  t.after(() => {
    rpc.close();
    server.detachPort(port1);
  });
  return { api, rpc };
}

async function fixture(t) {
  const home = await mkdtemp(path.join(tmpdir(), "dexon-automation-workspace-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  return { home, root: path.join(home, ".dexon", "automations") };
}

test("ensuring a task rejects the root and lexical outsiders without creating them", async (t) => {
  const { home, root } = await fixture(t);
  for (const target of [root, home, path.join(home, "external", "task"), `${root}-other`, "relative-task"]) {
    await assert.rejects(ensureManagedTaskDirectory(home, target), /managed|descendant/i);
  }
  await assert.rejects(lstat(path.join(home, ".dexon")), { code: "ENOENT" });
  await assert.rejects(lstat(path.join(home, "external")), { code: "ENOENT" });
});

test("ensuring a task rejects symlink escapes before creating a missing descendant", async (t) => {
  const { home, root } = await fixture(t);
  const outside = path.join(home, "outside");
  await mkdir(root, { recursive: true });
  await mkdir(outside);
  await symlink(outside, path.join(root, "escape"), process.platform === "win32" ? "junction" : "dir");
  await assert.rejects(
    ensureManagedTaskDirectory(home, path.join(root, "escape", "new", "task")),
    /managed|descendant/i,
  );
  await assert.rejects(lstat(path.join(outside, "new")), { code: "ENOENT" });
});

test("ensuring a task creates missing managed parents and preserves existing task files", async (t) => {
  const { home, root } = await fixture(t);
  const cwd = path.join(root, "daily", "task");
  await ensureManagedTaskDirectory(home, cwd);
  assert.equal((await lstat(cwd)).isDirectory(), true);
  await writeFile(path.join(cwd, "keep.txt"), "keep");
  await ensureManagedTaskDirectory(home, cwd);
  assert.equal(await readFile(path.join(cwd, "keep.txt"), "utf8"), "keep");
  assert.equal((await lstat(root)).isDirectory(), true);
});

test("cleanup removes a managed task tree while preserving its root and sibling tasks", async (t) => {
  const { home, root } = await fixture(t);
  const cwd = path.join(root, "daily");
  const sibling = path.join(root, "weekly");
  await mkdir(path.join(cwd, "artifacts"), { recursive: true });
  await mkdir(sibling);
  await writeFile(path.join(cwd, "artifacts", "output.txt"), "remove");
  await writeFile(path.join(sibling, "keep.txt"), "keep");
  assert.equal(await cleanupManagedTaskDirectory(home, cwd), true);
  await assert.rejects(lstat(cwd), { code: "ENOENT" });
  assert.equal((await lstat(root)).isDirectory(), true);
  assert.equal(await readFile(path.join(sibling, "keep.txt"), "utf8"), "keep");
});

test("workspace paths use the fixed segments and preserve native home path rules", () => {
  assert.deepEqual(AUTOMATION_WORKSPACE_SEGMENTS, [".dexon", "automations"]);
  assert.equal(automationWorkspaceRoot("/Users/demo"), path.join("/Users/demo", ".dexon", "automations"));
  assert.equal(automationWorkspaceRoot("C:\\Users\\demo"), "C:\\Users\\demo\\.dexon\\automations");
  assert.equal(automationWorkspaceRoot("\\\\server\\share\\demo"), "\\\\server\\share\\demo\\.dexon\\automations");
});

test("preparation resolves the real root and reuses it without clearing files", async (t) => {
  const { home, root } = await fixture(t);
  const first = await prepareAutomationWorkspaceRoot(home);
  assert.deepEqual(first, { ok: true, path: root, canonicalPath: await realpath(root) });
  await writeFile(path.join(root, "keep.txt"), "keep");
  assert.deepEqual(await prepareAutomationWorkspaceRoot(home), first);
  assert.equal(await readFile(path.join(root, "keep.txt"), "utf8"), "keep");
});

for (const segment of [".dexon", "automations"]) {
  test(`preparation preserves a file blocking ${segment}`, async (t) => {
    const { home, root } = await fixture(t);
    const blocked = segment === ".dexon" ? path.join(home, segment) : root;
    await mkdir(path.dirname(blocked), { recursive: true });
    await writeFile(blocked, "do not replace");
    const prepared = await prepareAutomationWorkspaceRoot(home);
    assert.equal(prepared.ok, false);
    assert.equal(prepared.reason, "not-directory");
    assert.match(prepared.error, /not a directory/i);
    assert.equal(await readFile(blocked, "utf8"), "do not replace");
    await assert.rejects(ensureManagedTaskDirectory(home, path.join(root, "task")));
  });

  test(`preparation and cleanup refuse a symlink at ${segment}`, async (t) => {
    const { home, root } = await fixture(t);
    const outside = path.join(home, "outside");
    await mkdir(path.join(outside, "task"), { recursive: true });
    await writeFile(path.join(outside, "task", "keep.txt"), "keep");
    const linked = segment === ".dexon" ? path.join(home, segment) : root;
    await mkdir(path.dirname(linked), { recursive: true });
    await symlink(outside, linked, process.platform === "win32" ? "junction" : "dir");
    const prepared = await prepareAutomationWorkspaceRoot(home);
    assert.equal(prepared.ok, false);
    assert.equal(prepared.reason, "not-directory");
    await assert.rejects(ensureManagedTaskDirectory(home, path.join(root, "new", "task")));
    assert.equal(await cleanupManagedTaskDirectory(home, path.join(root, "task")), false);
    assert.equal(await readFile(path.join(outside, "task", "keep.txt"), "utf8"), "keep");
    await assert.rejects(lstat(path.join(outside, "new")), { code: "ENOENT" });
    await assert.rejects(lstat(path.join(outside, "automations")), { code: "ENOENT" });
  });
}

test("preparation reports an io-error when the home cannot be resolved", async (t) => {
  const { home } = await fixture(t);
  const prepared = await prepareAutomationWorkspaceRoot(path.join(home, "missing-home"));
  assert.equal(prepared.ok, false);
  assert.equal(prepared.reason, "io-error");
  assert.ok(prepared.error.length > 0);
});

test("membership recognizes real and missing descendants but excludes the root, files and outsiders", async (t) => {
  const { home, root } = await fixture(t);
  const cwd = path.join(root, "daily");
  await mkdir(cwd, { recursive: true });
  await writeFile(path.join(root, "file"), "keep");
  const canonicalRoot = await realpath(root);
  assert.deepEqual(await isManagedTaskDirectory(canonicalRoot, cwd), {
    inside: true,
    canonicalTarget: await realpath(cwd),
  });
  assert.deepEqual(await isManagedTaskDirectory(canonicalRoot, path.join(cwd, "missing", "task")), {
    inside: true,
    canonicalTarget: path.join(canonicalRoot, "daily", "missing", "task"),
  });
  for (const target of [
    root,
    canonicalRoot,
    home,
    `${root}-other`,
    "relative-task",
    path.join(root, "file", "child"),
  ]) {
    assert.deepEqual(await isManagedTaskDirectory(canonicalRoot, target), { inside: false });
  }
  assert.deepEqual(await isManagedTaskDirectory(canonicalRoot, path.join(root, "file")), { inside: false });
});

test("membership rejects root aliases, symlink escapes and dangling symlinks", async (t) => {
  const { home, root } = await fixture(t);
  const outside = path.join(home, "outside");
  await mkdir(root, { recursive: true });
  await mkdir(outside);
  const canonicalRoot = await realpath(root);
  const kind = process.platform === "win32" ? "junction" : "dir";
  await symlink(root, path.join(root, "root-alias"), kind);
  await symlink(outside, path.join(root, "escape"), kind);
  await symlink(path.join(home, "missing-target"), path.join(root, "dangling"), kind);
  for (const name of ["root-alias", "escape", "dangling"]) {
    const target = path.join(root, name);
    assert.deepEqual(await isManagedTaskDirectory(canonicalRoot, target), { inside: false });
    assert.deepEqual(await isManagedTaskDirectory(canonicalRoot, path.join(target, "new")), {
      inside: name === "root-alias",
      ...(name === "root-alias" ? { canonicalTarget: path.join(canonicalRoot, "new") } : {}),
    });
    if (name !== "root-alias") await assert.rejects(ensureManagedTaskDirectory(home, path.join(target, "new")));
  }
  await assert.rejects(lstat(path.join(home, "missing-target")), { code: "ENOENT" });
});

test("cleanup refuses the root and outside aliases and never follows nested external links", async (t) => {
  const { home, root } = await fixture(t);
  const cwd = path.join(root, "task");
  const outside = path.join(home, "outside");
  await mkdir(cwd, { recursive: true });
  await mkdir(outside);
  await writeFile(path.join(outside, "keep.txt"), "keep");
  const kind = process.platform === "win32" ? "junction" : "dir";
  await symlink(outside, path.join(root, "escape"), kind);
  await symlink(root, path.join(root, "root-alias"), kind);
  await symlink(outside, path.join(cwd, "external-data"), kind);
  for (const target of [root, path.join(root, "root-alias"), outside, path.join(root, "escape")]) {
    assert.equal(await cleanupManagedTaskDirectory(home, target), false);
  }
  assert.equal(await cleanupManagedTaskDirectory(home, cwd), true);
  assert.equal(await readFile(path.join(outside, "keep.txt"), "utf8"), "keep");
  assert.equal((await lstat(root)).isDirectory(), true);
});

test("internal aliases resolve and cleanup targets the canonical managed task only", async (t) => {
  const { home, root } = await fixture(t);
  const cwd = path.join(root, "task");
  const alias = path.join(root, "alias");
  await mkdir(cwd, { recursive: true });
  await symlink(cwd, alias, process.platform === "win32" ? "junction" : "dir");
  await ensureManagedTaskDirectory(home, path.join(alias, "nested"));
  assert.equal((await lstat(path.join(cwd, "nested"))).isDirectory(), true);
  assert.equal(await cleanupManagedTaskDirectory(home, alias), true);
  await assert.rejects(lstat(cwd), { code: "ENOENT" });
  assert.equal((await lstat(alias)).isSymbolicLink(), true);
});

test("cleanup is safe for missing descendants and does not create a missing workspace", async (t) => {
  const { home, root } = await fixture(t);
  assert.equal(await cleanupManagedTaskDirectory(home, path.join(root, "missing")), false);
  await assert.rejects(lstat(path.join(home, ".dexon")), { code: "ENOENT" });
  await mkdir(root, { recursive: true });
  assert.equal(await cleanupManagedTaskDirectory(home, path.join(root, "missing", "task")), true);
  assert.equal((await lstat(root)).isDirectory(), true);
});

test("automationCwd RPC prepares and authorizes only the canonical automation workspace", async (t) => {
  const { home, root } = await fixture(t);
  const { rpc } = apiFixture(t, home);
  assert.deepEqual(await rpc.call("system.automationCwd"), { cwd: root });
  assert.equal(await isFilePathAllowed(path.join(root, "task", "output.txt")), true);
  assert.equal(await isFilePathAllowed(path.join(home, ".dexon", "sibling.txt")), false);
  assert.equal(await isFilePathAllowed(path.join(home, "sibling.txt")), false);
  const generation = getAllowedRootsGeneration();
  assert.deepEqual(await rpc.call("system.automationCwd"), { cwd: root });
  assert.equal(getAllowedRootsGeneration(), generation);
});

test("the environment client can prepare, populate and clean up a managed task through the RPC cwd", async (t) => {
  const { home, root } = await fixture(t);
  const { api } = apiFixture(t, home);
  assert.equal(typeof api.automationCwd, "function");
  const result = await api.automationCwd();
  assert.deepEqual(result, { cwd: root });
  const cwd = path.join(result.cwd, "daily", "task");
  await ensureManagedTaskDirectory(home, cwd);
  await writeFile(path.join(cwd, "result.txt"), "completed");
  assert.equal(await readFile(path.join(cwd, "result.txt"), "utf8"), "completed");
  assert.equal(await cleanupManagedTaskDirectory(home, cwd), true);
  assert.equal((await lstat(root)).isDirectory(), true);
  await assert.rejects(lstat(cwd), { code: "ENOENT" });
});

test("automationCwd maps blocking files to CONFLICT without changing them", async (t) => {
  const { home, root } = await fixture(t);
  await mkdir(path.dirname(root));
  await writeFile(root, "keep");
  const { api } = apiFixture(t, home);
  await assert.rejects(
    api.automationCwd(),
    (error) => error.code === "CONFLICT" && /not a directory/i.test(error.message),
  );
  assert.equal(await readFile(root, "utf8"), "keep");
  assert.equal(await isFilePathAllowed(root), false);
});

test("automationCwd maps unresolved home failures to INTERNAL", async (t) => {
  const { home } = await fixture(t);
  const { api } = apiFixture(t, path.join(home, "missing-home"));
  await assert.rejects(api.automationCwd(), (error) => error.code === "INTERNAL" && error.message.length > 0);
  await assert.rejects(lstat(path.join(home, "missing-home")), { code: "ENOENT" });
});

test("parent traversal after a symlink is resolved before checking managed containment", async (t) => {
  const { home, root } = await fixture(t);
  const outside = path.join(home, "outside");
  const protectedTask = path.join(root, "task");
  await mkdir(protectedTask, { recursive: true });
  await mkdir(path.join(outside, "inner"), { recursive: true });
  await mkdir(path.join(outside, "task"));
  await writeFile(path.join(protectedTask, "keep.txt"), "keep managed task");
  await writeFile(path.join(outside, "task", "keep.txt"), "keep external task");
  await symlink(
    path.join(outside, "inner"),
    path.join(root, "link"),
    process.platform === "win32" ? "junction" : "dir",
  );
  const target = `${root}${path.sep}link${path.sep}..${path.sep}task`;
  assert.deepEqual(await isManagedTaskDirectory(await realpath(root), target), { inside: false });
  await assert.rejects(ensureManagedTaskDirectory(home, `${target}-new`));
  assert.equal(await cleanupManagedTaskDirectory(home, target), false);
  assert.equal(await readFile(path.join(protectedTask, "keep.txt"), "utf8"), "keep managed task");
  assert.equal(await readFile(path.join(outside, "task", "keep.txt"), "utf8"), "keep external task");
  await assert.rejects(lstat(path.join(outside, "task-new")), { code: "ENOENT" });
});

test("a canonical root whose ancestor became a symlink is no longer trusted", async (t) => {
  const { home, root } = await fixture(t);
  await mkdir(root, { recursive: true });
  const canonicalRoot = await realpath(root);
  await rm(path.join(home, ".dexon"), { recursive: true });
  const outside = path.join(home, "outside");
  await mkdir(path.join(outside, "automations", "task"), { recursive: true });
  await writeFile(path.join(outside, "automations", "task", "keep.txt"), "keep");
  await symlink(outside, path.join(home, ".dexon"), process.platform === "win32" ? "junction" : "dir");
  assert.deepEqual(await isManagedTaskDirectory(canonicalRoot, path.join(root, "task")), { inside: false });
  assert.equal(await cleanupManagedTaskDirectory(home, path.join(root, "task")), false);
  assert.equal(await readFile(path.join(outside, "automations", "task", "keep.txt"), "utf8"), "keep");
});
