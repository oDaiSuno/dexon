import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// Real Git, real folders, disposable temporary repositories. Everything here
// only sets up a world; the behavior under test is the Host's own.
export function sandbox(prefix) {
  return realpathSync.native(mkdtempSync(path.join(tmpdir(), prefix)));
}

export function git(repository, ...args) {
  return execFileSync(
    "git",
    [
      "-C",
      repository,
      "-c",
      "user.name=Tester",
      "-c",
      "user.email=tester@example.com",
      "-c",
      "commit.gpgsign=false",
      ...args,
    ],
    { stdio: "pipe" },
  ).toString();
}

function gitAt(repository, date, ...args) {
  return execFileSync(
    "git",
    [
      "-C",
      repository,
      "-c",
      "user.name=Tester",
      "-c",
      "user.email=tester@example.com",
      "-c",
      "commit.gpgsign=false",
      ...args,
    ],
    { stdio: "pipe", env: { ...process.env, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date } },
  ).toString();
}

export function initRepository(directory) {
  mkdirSync(directory, { recursive: true });
  execFileSync("git", ["init", "-q", "-b", "main", directory]);
  execFileSync("git", ["-C", directory, "config", "core.autocrlf", "false"]);
  return directory;
}

export function commitFile(
  repository,
  relative,
  content,
  message = `add ${relative}`,
  date = "2026-01-01T00:00:00.000Z",
) {
  const file = path.join(repository, relative);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, content);
  git(repository, "add", relative);
  gitAt(repository, date, "commit", "-q", "-m", message);
  return file;
}

export function branchAt(repository, name, date, parent = "main") {
  const tree = git(repository, "rev-parse", `${parent}^{tree}`).trim();
  const parentSha = git(repository, "rev-parse", parent).trim();
  const sha = gitAt(repository, date, "commit-tree", tree, "-p", parentSha, "-m", `work on ${name}`).trim();
  git(repository, "branch", name, sha);
  return sha;
}

export function worktreeAdd(repository, target, branch) {
  git(repository, "worktree", "add", "-q", target, branch);
  return target;
}

export function detachedWorktreeAdd(repository, target, commitish = "main") {
  git(repository, "worktree", "add", "-q", "--detach", target, commitish);
  return target;
}

export const currentBranch = (repository) => git(repository, "branch", "--show-current").trim();

export const localBranches = (repository) =>
  git(repository, "for-each-ref", "--format=%(refname:short)", "refs/heads")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .sort();

export const registeredWorktrees = (repository) =>
  git(repository, "worktree", "list", "--porcelain")
    .split("\n")
    .filter((line) => line.startsWith("worktree "))
    .map((line) => line.slice("worktree ".length));

export const commitDates = {
  main: "2026-09-06T09:00:00.000Z",
  review: "2026-09-05T09:00:00.000Z",
  stale: "2026-09-05T12:00:00.000Z",
  alpha: "2026-09-04T09:00:00.000Z",
  audit: "2026-09-03T09:00:00.000Z",
  beta: "2026-09-02T09:00:00.000Z",
  idea: "2026-09-01T09:00:00.000Z",
};

// One repository with a branch table whose declaration, alphabetical and
// commit orders all differ, plus one worktree, one vanished registration and
// one detached worktree.
export function branchWorld(root) {
  const repository = initRepository(path.join(root, "project"));
  commitFile(repository, "README.md", "# demo\n", "initial", commitDates.main);
  branchAt(repository, "feat/alpha", commitDates.alpha);
  branchAt(repository, "feat/beta", commitDates.beta);
  branchAt(repository, "audit/cleanup", commitDates.audit);
  branchAt(repository, "wip/idea", commitDates.idea);
  branchAt(repository, "review", commitDates.review);
  branchAt(repository, "chore/gamma", commitDates.stale);
  const worktrees = path.join(root, "project-worktrees");
  const review = worktreeAdd(repository, path.join(worktrees, "review"), "review");
  const stale = realpathSync.native(worktreeAdd(repository, path.join(worktrees, "gamma"), "chore/gamma"));
  rmSync(stale, { recursive: true, force: true });
  const detached = detachedWorktreeAdd(repository, path.join(worktrees, "bisect"));
  return {
    repository: realpathSync.native(repository),
    review: realpathSync.native(review),
    stale,
    detached: realpathSync.native(detached),
  };
}
