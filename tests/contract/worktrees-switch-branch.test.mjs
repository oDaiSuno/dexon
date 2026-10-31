import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import test, { after } from "node:test";
import { importTestBundle } from "#test-bundle";
import { worktreePathsEqual } from "../../src/shared/worktree-path.ts";
import {
  branchWorld,
  currentBranch,
  git,
  initRepository,
  registeredWorktrees,
  sandbox,
} from "../support/worktree-repository.mjs";

const base = sandbox("dexon-worktree-switch-");
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

const { registerHandlers } = await importTestBundle("worktree-switch-contract", {
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

async function opened(cwd) {
  await handlers["system.allowRoot"]({ path: cwd });
  return (branch) => handlers["worktrees.switchBranch"]({ cwd, branch });
}

test("a folder with only a brand-new file switches branch, keeps that file and reports the new branch afterwards", async () => {
  const world = branchWorld(path.join(base, "clean"));
  const switchTo = await opened(world.repository);
  writeFileSync(path.join(world.repository, "fresh-note.txt"), "never committed\n");

  assert.deepEqual(await switchTo("feat/alpha"), { ok: true });
  assert.equal(currentBranch(world.repository), "feat/alpha");
  assert.equal(existsSync(path.join(world.repository, "fresh-note.txt")), true, "the new file is still there");

  assert.deepEqual(await handlers["git.branch"]({ path: world.repository }), { isGit: true, branch: "feat/alpha" });
  const afterwards = await handlers["worktrees.branches"]({ cwd: world.repository });
  assert.equal(afterwards.current, "feat/alpha");
  assert.equal(afterwards.branches.find((entry) => entry.name === "feat/alpha").isCurrent, true);
  assert.equal(afterwards.branches.find((entry) => entry.name === "main").isCurrent, false);
  assert.ok(
    worktreePathsEqual(afterwards.branches.find((entry) => entry.name === "feat/alpha").worktreePath, world.repository),
  );
});

test("a changed file that Git already tracks stops the switch, whether it is still loose or already staged", async () => {
  const loose = branchWorld(path.join(base, "loose"));
  const switchLoose = await opened(loose.repository);
  writeFileSync(path.join(loose.repository, "README.md"), "# edited by hand\n");
  assert.deepEqual(await switchLoose("feat/alpha"), { ok: false, reason: "dirty" });
  assert.equal(currentBranch(loose.repository), "main");

  const staged = branchWorld(path.join(base, "staged"));
  const switchStaged = await opened(staged.repository);
  writeFileSync(path.join(staged.repository, "README.md"), "# staged edit\n");
  git(staged.repository, "add", "README.md");
  assert.deepEqual(await switchStaged("feat/alpha"), { ok: false, reason: "dirty" });
  assert.equal(currentBranch(staged.repository), "main");
});

test("reading the folder first does not make the switch trust the old answer", async () => {
  const world = branchWorld(path.join(base, "fresh"));
  const switchTo = await opened(world.repository);
  assert.equal((await handlers["git.status"]({ path: world.repository })).clean, true);
  assert.equal((await handlers["git.branch"]({ path: world.repository })).branch, "main");

  writeFileSync(path.join(world.repository, "README.md"), "# changed after the read\n");
  assert.deepEqual(await switchTo("feat/alpha"), { ok: false, reason: "dirty" });
  assert.equal(currentBranch(world.repository), "main");
});

test("a branch another folder already holds is reported as occupied with that folder", async () => {
  const world = branchWorld(path.join(base, "occupied"));
  const switchTo = await opened(world.repository);
  const result = await switchTo("review");
  assert.equal(result.ok, false);
  assert.equal(result.reason, "occupied");
  assert.ok(worktreePathsEqual(result.path, world.review));
  assert.equal(currentBranch(world.repository), "main");
  assert.equal(currentBranch(world.review), "review", "the other folder is untouched");
});

test("a branch that is only registered to a folder that no longer exists is reported as stale with that path", async () => {
  const world = branchWorld(path.join(base, "stale-switch"));
  const switchTo = await opened(world.repository);
  const result = await switchTo("chore/gamma");
  assert.equal(result.ok, false);
  assert.equal(result.reason, "stale");
  assert.ok(worktreePathsEqual(result.path, world.stale));
  assert.equal(currentBranch(world.repository), "main");
  assert.ok(
    registeredWorktrees(world.repository).some((folder) => worktreePathsEqual(folder, world.stale)),
    "the registration to the missing folder is still kept",
  );
});

test("a folder outside the opened folders is refused, and so is a folder that is not the root of a checkout", async () => {
  const world = branchWorld(path.join(base, "guards"));
  const unopened = initRepository(path.join(base, "guards", "elsewhere"));
  await assert.rejects(
    handlers["worktrees.switchBranch"]({ cwd: unopened, branch: "feat/alpha" }),
    (error) => error.code === "FORBIDDEN",
  );

  const nested = path.join(world.repository, "packages", "app");
  mkdirSync(nested, { recursive: true });
  await handlers["system.allowRoot"]({ path: nested });
  await assert.rejects(handlers["worktrees.switchBranch"]({ cwd: nested, branch: "feat/alpha" }));
  assert.equal(currentBranch(world.repository), "main");
});

test("a branch that only the remote has is refused instead of being guessed into a new local branch", async () => {
  const root = path.join(base, "no-guess");
  const world = branchWorld(root);
  const origin = initRepository(path.join(root, "origin"));
  git(origin, "checkout", "-q", "-b", "guest");
  git(origin, "commit", "-q", "--allow-empty", "-m", "work on guest");
  git(world.repository, "remote", "add", "origin", origin);
  git(world.repository, "fetch", "-q", "origin");

  const clone = path.join(root, "probe-clone");
  execFileSync("git", ["clone", "-q", origin, clone], { stdio: "pipe" });
  execFileSync("git", ["-C", clone, "switch", "guest"], { stdio: "pipe" });
  assert.equal(
    execFileSync("git", ["-C", clone, "branch", "--show-current"]).toString().trim(),
    "guest",
    "a plain switch would indeed invent the local branch from the remote one",
  );

  const switchTo = await opened(world.repository);
  await assert.rejects(switchTo("guest"));
  assert.equal(currentBranch(world.repository), "main");
  assert.equal(git(world.repository, "branch", "--list", "guest").trim(), "", "no local branch appeared");
});

test("opening an existing branch in a new worktree reuses that branch instead of creating a second one", async () => {
  const world = branchWorld(path.join(base, "new-worktree"));
  await handlers["system.allowRoot"]({ path: world.repository });
  const created = await handlers["worktrees.create"]({ projectRoot: world.repository, branch: "feat/alpha" });

  assert.equal(created.worktree.branch, "feat/alpha");
  assert.ok(worktreePathsEqual(created.worktree.path, `${world.repository}-worktrees/feat-alpha`));
  assert.equal(currentBranch(created.worktree.path), "feat/alpha");
  assert.equal(
    git(world.repository, "branch", "--list", "feat/alpha").split("\n").filter(Boolean).length,
    1,
    "the branch is reused, not duplicated",
  );
});

test("the new worktree is reported as the folder that holds that branch", async () => {
  const world = branchWorld(path.join(base, "new-worktree-listed"));
  await handlers["system.allowRoot"]({ path: world.repository });
  const created = await handlers["worktrees.create"]({ projectRoot: world.repository, branch: "feat/alpha" });
  const result = await handlers["worktrees.branches"]({ cwd: world.repository });
  assert.ok(
    worktreePathsEqual(
      result.branches.find((entry) => entry.name === "feat/alpha").worktreePath,
      created.worktree.path,
    ),
  );
});
