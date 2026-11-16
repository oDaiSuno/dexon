import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import test, { after } from "node:test";
import { ENABLED_SETTINGS, startSessionOrchestrationHost, toolCall } from "../support/session-orchestration-host.mjs";

const host = await startSessionOrchestrationHost({
  name: "session-missing-folder",
  settings: ENABLED_SETTINGS,
  modules: { initializeSessionOrchestrationService: "./src/agent-host/session-orchestration/service.ts" },
});
after(() => host.close());

const missingFolder = (error) => error?.code === "MISSING_SESSION_CWD";

async function historySessionInDeletedFolder(label, folder = host.workspace(label)) {
  const sessionId = `${label}-history`;
  await host.writeSession(sessionId, folder, [
    {
      type: "message",
      id: "user-1",
      parentId: null,
      timestamp: new Date(Date.UTC(2026, 7, 6, 9, 1, 0)).toISOString(),
      message: { role: "user", content: "Summarize the old notes" },
    },
  ]);
  rmSync(folder, { recursive: true, force: true });
  return { folder, sessionId };
}

test("an agent cannot wake a session whose worktree folder was deleted", { timeout: 60_000 }, async () => {
  const repository = host.workspace("deleted-worktree-repository");
  const git = (...args) =>
    execFileSync(
      "git",
      ["-c", "user.name=Fixture", "-c", "user.email=fixture@example.com", "-c", "commit.gpgsign=false", ...args],
      { cwd: repository, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    );
  git("init", "--initial-branch=main");
  writeFileSync(path.join(repository, "README.md"), "# deleted worktree\n");
  git("add", "README.md");
  git("commit", "-m", "Start the repository");
  const worktree = path.join(`${repository}-worktrees`, "feature");
  git("worktree", "add", worktree, "-b", "feature");
  const callerId = await host.createUserSession({ cwd: repository });
  const { folder, sessionId } = await historySessionInDeletedFolder("deleted-worktree-target", worktree);
  const service = host.module.initializeSessionOrchestrationService();

  await assert.rejects(
    service.prompt(callerId, { sessionId, message: "Pick the work back up" }),
    (error) => missingFolder(error) && error.message.includes(folder),
    "the calling agent is told which folder is missing",
  );
  assert.equal(existsSync(folder), false, "waking from another session never recreates the folder");
  assert.deepEqual(await host.state(sessionId), { running: false });
});

test(
  "an idle live session rejects work after folder deletion while history and stop commands remain available",
  { timeout: 60_000 },
  async () => {
    const folder = host.workspace("deleted-live-session");
    const prompt = "Remember this historical turn";
    host.model.script(prompt, [
      { text: "Historical answer." },
      toolCall("write", { path: path.join(folder, "resurrected.txt"), content: "must not be written" }),
      { text: "Done." },
    ]);
    const sessionId = await host.createUserSession({ cwd: folder });
    const events = host.events(sessionId);
    try {
      await host.prompt(sessionId, prompt);
      await events.next((event) => event?.type === "agent_end");
    } finally {
      events.off();
    }
    const detail = await host.detail(sessionId);
    const entryId = detail.context.entryIds[0];
    rmSync(folder, { recursive: true, force: true });
    for (const command of [
      { type: "prompt", message: "Write the file" },
      { type: "steer", message: "Write the file" },
      { type: "follow_up", message: "Write the file" },
      { type: "edit_message", entryId, message: "Write the file" },
    ]) {
      await assert.rejects(host.command(sessionId, command), missingFolder);
      assert.equal(existsSync(folder), false, `${command.type} never recreates the folder`);
    }
    for (const type of [
      "get_state",
      "get_session_stats",
      "get_last_assistant_text",
      "abort",
      "abort_compaction",
      "clear_queue",
    ]) {
      await host.command(sessionId, { type });
    }
    assert.equal((await host.state(sessionId)).running, true);
    assert.deepEqual((await host.detail(sessionId)).context.messages, detail.context.messages);
    assert.equal(existsSync(folder), false);
  },
);

test("an idle live delegate cannot resume work into its deleted folder", { timeout: 60_000 }, async () => {
  const folder = host.workspace("live-delegate");
  const callerId = await host.createUserSession({ cwd: folder });
  const service = host.module.initializeSessionOrchestrationService();
  const prompt = "Bootstrap a live delegate";
  host.model.script(prompt, [
    { text: "Delegate idle." },
    toolCall("write", { path: path.join(folder, "resurrected.txt"), content: "must not be written" }),
    { text: "Done." },
  ]);
  const created = await service.create(callerId, { cwd: folder, message: prompt, wait: true });
  assert.equal(created.wait.status, "idle");
  rmSync(folder, { recursive: true, force: true });
  await assert.rejects(
    service.prompt(callerId, { sessionId: created.sessionId, message: "Write the file", wait: true }),
    missingFolder,
  );
  assert.equal(existsSync(folder), false);
  assert.equal((await host.state(created.sessionId)).state.isPromptRunning, false);
});
