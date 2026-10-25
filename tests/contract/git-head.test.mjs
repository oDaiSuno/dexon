import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { after } from "node:test";
import { importTestBundle } from "#test-bundle";

const base = realpathSync(mkdtempSync(path.join(tmpdir(), "dexon-git-head-")));
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

const { registerHandlers } = await importTestBundle("git-head-contract", {
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

const git = (repo, ...args) =>
  execFileSync(
    "git",
    [
      "-C",
      repo,
      "-c",
      "user.name=Tester",
      "-c",
      "user.email=tester@example.com",
      "-c",
      "commit.gpgsign=false",
      ...args,
    ],
    { stdio: "pipe" },
  );

function repository(name) {
  const repo = path.join(base, name);
  mkdirSync(repo, { recursive: true });
  execFileSync("git", ["init", "-q", "-b", "main", repo]);
  return repo;
}

function commitFile(repo, relative, content, message = `add ${relative}`) {
  const file = path.join(repo, relative);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, content);
  git(repo, "add", relative);
  git(repo, "commit", "-q", "-m", message);
  return file;
}

test("a changed file's last committed text is returned so the viewer can compare against it", async () => {
  const repo = repository("changed");
  await handlers["system.allowRoot"]({ path: repo });
  const top = commitFile(repo, "notes.txt", "one\ntwo\n");
  const nested = commitFile(repo, "src/deep/code.ts", "export const a = 1;\n");
  writeFileSync(top, "one\nTWO\nthree\n");
  writeFileSync(nested, "export const a = 2;\n");

  assert.deepEqual(await handlers["git.headContent"]({ path: top }), { comparable: true, content: "one\ntwo\n" });
  assert.deepEqual(await handlers["git.headContent"]({ path: nested }), {
    comparable: true,
    content: "export const a = 1;\n",
  });
});

test("a new file that was never committed compares against empty text, while ignored files and folders without Git cannot be compared", async () => {
  const repo = repository("new-and-ignored");
  await handlers["system.allowRoot"]({ path: repo });
  commitFile(repo, ".gitignore", "secret.txt\n");
  const fresh = path.join(repo, "fresh.txt");
  writeFileSync(fresh, "brand new\n");
  const ignored = path.join(repo, "secret.txt");
  writeFileSync(ignored, "token\n");
  const plain = path.join(base, "plain-folder");
  mkdirSync(plain);
  await handlers["system.allowRoot"]({ path: plain });
  const loose = path.join(plain, "loose.txt");
  writeFileSync(loose, "hello\n");

  assert.deepEqual(await handlers["git.headContent"]({ path: fresh }), { comparable: true, content: "" });
  assert.deepEqual(await handlers["git.headContent"]({ path: ignored }), { comparable: false, content: "" });
  assert.deepEqual(await handlers["git.headContent"]({ path: loose }), { comparable: false, content: "" });
});

test("committed text of files outside the opened folders is refused", async () => {
  const repo = repository("not-allowed");
  const file = commitFile(repo, "private.txt", "private\n");
  await assert.rejects(handlers["git.headContent"]({ path: file }), (error) => error.code === "FORBIDDEN");
  await assert.rejects(handlers["git.branch"]({ path: repo }), (error) => error.code === "FORBIDDEN");
});

test("the quick branch lookup names the current branch, and says when a folder is not a Git repository", async () => {
  const repo = repository("branch");
  await handlers["system.allowRoot"]({ path: repo });
  commitFile(repo, "README.md", "# demo\n");
  git(repo, "checkout", "-q", "-b", "feat/explorer-redesign");
  const plain = path.join(base, "plain-branch");
  mkdirSync(plain);
  await handlers["system.allowRoot"]({ path: plain });

  assert.deepEqual(await handlers["git.branch"]({ path: repo }), { isGit: true, branch: "feat/explorer-redesign" });
  assert.deepEqual(await handlers["git.branch"]({ path: plain }), { isGit: false, branch: null });
});

test("git status says how many commits the branch is ahead of or behind its remote branch, and nothing when there is none", async () => {
  const repo = repository("upstream");
  await handlers["system.allowRoot"]({ path: repo });
  commitFile(repo, "README.md", "# demo\n");

  assert.equal((await handlers["git.status"]({ path: repo })).upstream, null, "no remote branch is configured yet");

  git(repo, "branch", "-q", "remote-copy");
  git(repo, "branch", "-q", "--set-upstream-to=remote-copy");
  assert.deepEqual((await handlers["git.status"]({ path: repo })).upstream, { ahead: 0, behind: 0 });

  commitFile(repo, "a.txt", "a\n");
  assert.deepEqual((await handlers["git.status"]({ path: repo })).upstream, { ahead: 1, behind: 0 });

  git(repo, "checkout", "-q", "remote-copy");
  commitFile(repo, "b.txt", "b\n");
  commitFile(repo, "c.txt", "c\n");
  git(repo, "checkout", "-q", "main");
  assert.deepEqual((await handlers["git.status"]({ path: repo })).upstream, { ahead: 1, behind: 2 });
});
