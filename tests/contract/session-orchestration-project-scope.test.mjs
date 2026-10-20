import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import path from "node:path";
import test, { after } from "node:test";
import {
  ENABLED_SETTINGS,
  expectToolPayload,
  expectToolRefusal,
  resultQueue,
  startSessionOrchestrationHost,
  textOf,
  toolCall,
  waitUntil,
} from "../support/session-orchestration-host.mjs";

const host = await startSessionOrchestrationHost({ name: "orchestration-project-scope", settings: ENABLED_SETTINGS });
after(() => host.close());

async function userMessageCount(sessionId) {
  const detail = await host.detail(sessionId);
  return detail.context.messages.filter((message) => message.role === "user").length;
}

test("no session tool reaches a session in another project", { timeout: 90_000 }, async () => {
  const foreignCwd = host.workspace("scope-foreign-project");
  const foreign = await host.createUserSession({ cwd: foreignCwd });
  const foreignTurn = host.model.script("Work that belongs to another project", [
    { hold: true, partial: "Foreign work", rest: " is still going" },
  ]);
  await host.prompt(foreign, "Work that belongs to another project");
  await foreignTurn.partialSent(0);

  const parent = await host.createUserSession({ cwd: host.workspace("scope-parent-project") });
  host.model.script("Try to reach another project", [
    { toolCall: { name: "session_read", input: { sessionId: foreign } } },
    { toolCall: { name: "session_wait", input: { sessionId: foreign, timeoutSeconds: 0 } } },
    { toolCall: { name: "session_prompt", input: { sessionId: foreign, message: "Do my work instead" } } },
    { toolCall: { name: "session_stop", input: { sessionId: foreign } } },
    { toolCall: { name: "session_close", input: { sessionId: foreign } } },
    { text: "Everything was refused" },
  ]);
  const results = resultQueue(host);

  await host.prompt(parent, "Try to reach another project");
  for (const toolName of ["session_read", "session_wait", "session_prompt", "session_stop", "session_close"]) {
    expectToolRefusal(
      await results.named(toolName),
      `${toolName} must refuse a session in another project`,
      /project/i,
    );
  }

  const state = await host.state(foreign);
  assert.equal(state.running, true, "the session in the other project was not stopped or closed");
  assert.equal(state.state.isPromptRunning, true, "its turn keeps running");
  assert.equal(await userMessageCount(foreign), 1, "nothing was queued on the session in the other project");
});

test("listing sessions shows only the sessions of the caller's own project", { timeout: 90_000 }, async () => {
  const parentCwd = host.workspace("list-scope-project");
  const parent = await host.createUserSession({ cwd: parentCwd });
  const quiet = await host.createUserSession({ cwd: parentCwd });
  host.model.script("The user's own quiet task", [{ text: "The user's own quiet answer" }]);
  await host.prompt(quiet, "The user's own quiet task");
  await waitUntil(
    async () => {
      const texts = (await host.detail(quiet)).context.messages.filter((m) => m.role === "assistant").map(textOf);
      return texts.includes("The user's own quiet answer");
    },
    { timeoutMs: 20_000, label: "the user's own session to answer" },
  );
  const elsewhere = await host.createUserSession({ cwd: host.workspace("list-scope-elsewhere") });

  const childMessage = "Stay busy while the parent looks around";
  host.model.script(childMessage, [{ hold: true, partial: "Still working", rest: " and still working" }]);
  let childId;
  host.model.script("List the sessions you can see", [
    toolCall("session_new", { message: childMessage, wait: false }),
    { text: "Worker started" },
    { toolCall: { name: "session_list", input: () => ({ limit: 50 }) } },
    { text: "Listed" },
  ]);
  const results = resultQueue(host);

  await host.prompt(parent, "List the sessions you can see");
  childId = expectToolPayload(await results.named("session_new"), "the worker must be created").sessionId;
  await waitUntil(async () => (await host.runningIds()).includes(childId), {
    timeoutMs: 10_000,
    label: "the worker to be running",
  });

  await host.prompt(parent, "List them now");
  const listed = expectToolPayload(await results.named("session_list"), "the Agent must receive the list");
  const bySession = new Map(listed.sessions.map((session) => [session.sessionId, session]));

  assert.equal(bySession.get(childId)?.status, "running", "the busy worker in this project is listed as running");
  assert.equal(bySession.get(childId)?.createdBySessionId, parent, "the listing names the session that created it");
  assert.equal(bySession.get(quiet)?.status, "idle", "the user's own session in this project is listed");
  assert.equal(bySession.has(elsewhere), false, "a session of another project is not listed");
  assert.equal(bySession.has(parent), true, "the caller itself is part of its own project");
});

test("a worktree of the caller's repository counts as the same project", { timeout: 90_000 }, async () => {
  const repository = host.workspace("scope-repository");
  const git = (...args) =>
    execFileSync(
      "git",
      ["-c", "user.name=Fixture", "-c", "user.email=fixture@example.com", "-c", "commit.gpgsign=false", ...args],
      { cwd: repository, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    );
  git("init", "--initial-branch=main");
  writeFileSync(path.join(repository, "README.md"), "# scope\n");
  git("add", "README.md");
  git("commit", "-m", "Start the repository");
  const worktree = path.join(host.base, "scope-worktree");
  git("worktree", "add", worktree, "-b", "scope-branch");

  const worker = await host.createUserSession({ cwd: worktree });
  host.model.script("Work in the linked worktree", [{ text: "Worktree work is done" }]);
  await host.prompt(worker, "Work in the linked worktree");
  await waitUntil(
    async () => {
      const texts = (await host.detail(worker)).context.messages.filter((m) => m.role === "assistant").map(textOf);
      return texts.includes("Worktree work is done");
    },
    { timeoutMs: 20_000, label: "the worktree session to answer" },
  );

  const parent = await host.createUserSession({ cwd: repository });
  host.model.script("Read the worktree session", [
    { toolCall: { name: "session_list", input: () => ({ limit: 50 }) } },
    { toolCall: { name: "session_read", input: { sessionId: worker } } },
    { text: "Read across the worktree" },
  ]);
  const results = resultQueue(host);

  await host.prompt(parent, "Read the worktree session");
  const listed = expectToolPayload(await results.named("session_list"), "the Agent must receive the list");
  assert.ok(
    listed.sessions.some((session) => session.sessionId === worker),
    "a session in the linked worktree belongs to the same project",
  );

  const read = expectToolPayload(await results.named("session_read"), "reading a worktree session must work");
  assert.equal(read.lastReply, "Worktree work is done");
});
