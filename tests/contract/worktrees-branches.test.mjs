import assert from "node:assert/strict";
import { mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import test, { after } from "node:test";
import { importTestBundle } from "#test-bundle";
import { worktreePathsEqual } from "../../src/shared/worktree-path.ts";
import {
  branchWorld,
  commitDates,
  git,
  initRepository,
  localBranches,
  registeredWorktrees,
  sandbox,
} from "../support/worktree-repository.mjs";

const base = sandbox("dexon-worktree-branches-");
const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
const previousOffline = process.env.PI_OFFLINE;
process.env.PI_CODING_AGENT_DIR = path.join(base, "agent");
process.env.PI_OFFLINE = "1";
after(() => {
  if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
  if (previousOffline === undefined) delete process.env.PI_OFFLINE;
  else process.env.PI_OFFLINE = previousOffline;
  rmSync(base, { recursive: true, force: true });
});

const { registerHandlers } = await importTestBundle("worktree-branches-contract", {
  packages: "external",
  absWorkingDir: path.resolve(import.meta.dirname, "../.."),
  entryPoints: ["src/agent-host/handlers.ts"],
});
const handlers = {};
registerHandlers({
  handle(next) {
    Object.assign(handlers, next);
  },
  emit() {},
});

const branchesOf = async (cwd) => {
  await handlers["system.allowRoot"]({ path: cwd });
  return handlers["worktrees.branches"]({ cwd });
};

const byName = (result) => new Map(result.branches.map((entry) => [entry.name, entry]));

const at = (iso) => Date.parse(iso);

test("every local branch is listed newest commit first, and each one says which folder holds it", async () => {
  const world = branchWorld(path.join(base, "listed"));
  const result = await branchesOf(world.repository);

  assert.equal(result.isGit, true);
  assert.equal(result.isTopLevel, true);
  assert.ok(worktreePathsEqual(result.projectRoot, world.repository));
  assert.ok(worktreePathsEqual(result.mainFolder, world.repository));
  assert.equal(result.current, "main");
  assert.deepEqual(
    result.branches.map((entry) => entry.name),
    ["main", "chore/gamma", "review", "feat/alpha", "audit/cleanup", "feat/beta", "wip/idea"],
  );
  assert.deepEqual(
    result.branches.map((entry) => at(entry.committedAt)),
    [
      at(commitDates.main),
      at(commitDates.stale),
      at(commitDates.review),
      at(commitDates.alpha),
      at(commitDates.audit),
      at(commitDates.beta),
      at(commitDates.idea),
    ],
  );

  const branches = byName(result);
  assert.equal(branches.get("main").isCurrent, true);
  assert.ok(worktreePathsEqual(branches.get("main").worktreePath, world.repository));
  assert.equal(branches.get("main").isMainFolder, true);
  assert.equal(branches.get("main").stalePath, null);

  assert.equal(branches.get("review").isCurrent, false);
  assert.ok(worktreePathsEqual(branches.get("review").worktreePath, world.review));
  assert.equal(branches.get("review").isMainFolder, false);
  assert.equal(branches.get("review").stalePath, null);

  assert.equal(branches.get("feat/alpha").worktreePath, null);
  assert.equal(branches.get("feat/alpha").stalePath, null);
  assert.equal(branches.get("feat/alpha").isCurrent, false);

  assert.equal(branches.get("chore/gamma").worktreePath, null);
  assert.ok(worktreePathsEqual(branches.get("chore/gamma").stalePath, world.stale));

  assert.deepEqual(
    result.detached.map((entry) => path.normalize(entry.path)),
    [path.normalize(world.detached)],
  );
  const head = git(world.repository, "rev-parse", "main").trim();
  const reported = result.detached[0].commit;
  assert.ok(head.startsWith(reported), `the detached worktree names its short commit, not ${reported}`);
  assert.ok(reported.length >= 7);
});

test("a branch registration whose folder is gone stays visible in the branch list but is no longer a worktree you can open", async () => {
  const world = branchWorld(path.join(base, "stale"));
  const result = await branchesOf(world.repository);
  assert.ok(worktreePathsEqual(byName(result).get("chore/gamma").stalePath, world.stale));
  assert.ok(
    registeredWorktrees(world.repository).some((folder) => worktreePathsEqual(folder, world.stale)),
    "the registration to the missing folder is still kept",
  );

  const listed = await handlers["worktrees.list"]({ projectRoot: world.repository });
  assert.equal(listed.isGit, true);
  const folders = listed.worktrees.map((entry) => entry.path);
  assert.equal(
    folders.some((folder) => worktreePathsEqual(folder, world.stale)),
    false,
    "a registration to a missing folder is not offered as a folder",
  );
  assert.ok(folders.some((folder) => worktreePathsEqual(folder, world.repository)));
  assert.ok(folders.some((folder) => worktreePathsEqual(folder, world.review)));
  assert.equal(listed.worktrees.find((entry) => worktreePathsEqual(entry.path, world.repository)).isMain, true);
});

test("no remote branch appears, even after a fetch brings one in", async () => {
  const world = branchWorld(path.join(base, "remote"));
  const origin = initRepository(path.join(base, "remote", "origin"));
  git(origin, "checkout", "-q", "-b", "only-remote");
  git(origin, "commit", "-q", "--allow-empty", "-m", "remote only");
  git(world.repository, "remote", "add", "origin", origin);
  git(world.repository, "fetch", "-q", "origin");
  assert.match(git(world.repository, "for-each-ref", "refs/remotes").toString(), /origin\/only-remote/);

  const result = await branchesOf(world.repository);
  assert.equal(
    result.branches.some((entry) => entry.name.includes("only-remote")),
    false,
    "remote branches are not part of the list",
  );
  assert.equal(
    result.branches.some((entry) => entry.name.startsWith("origin/")),
    false,
  );
  assert.deepEqual(localBranches(world.repository), [...result.branches.map((entry) => entry.name)].sort());
});

test("the same branch list comes back from any worktree of the repository; only the current mark differs", async () => {
  const world = branchWorld(path.join(base, "anywhere"));
  const fromMain = await branchesOf(world.repository);
  const fromReview = await handlers["worktrees.branches"]({ cwd: world.review });

  assert.deepEqual(
    fromReview.branches.map((entry) => entry.name),
    fromMain.branches.map((entry) => entry.name),
  );
  assert.ok(worktreePathsEqual(fromReview.projectRoot, world.repository));
  assert.equal(fromReview.current, "review");
  assert.equal(byName(fromReview).get("review").isCurrent, true);
  assert.equal(byName(fromReview).get("main").isCurrent, false);
  assert.ok(worktreePathsEqual(byName(fromReview).get("main").worktreePath, world.repository));
  assert.equal(byName(fromReview).get("main").isMainFolder, true);
});

test("a folder that is not a repository has no branches, and a folder inside one is not a checkout root", async () => {
  const world = branchWorld(path.join(base, "plain"));
  const plain = path.join(base, "plain", "notes");
  mkdirSync(plain, { recursive: true });
  const outside = await branchesOf(plain);
  assert.equal(outside.isGit, false);
  assert.equal(outside.isTopLevel, false);
  assert.deepEqual(outside.branches, []);

  const nested = path.join(world.repository, "packages", "app");
  mkdirSync(nested, { recursive: true });
  const inside = await handlers["worktrees.branches"]({ cwd: nested });
  assert.equal(inside.isGit, true);
  assert.equal(inside.isTopLevel, false);
  assert.ok(worktreePathsEqual(inside.mainFolder, world.repository));
});
