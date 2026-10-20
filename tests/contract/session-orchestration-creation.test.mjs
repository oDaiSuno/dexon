import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import test, { after } from "node:test";
import {
  ENABLED_SETTINGS,
  runAgentTurn,
  startSessionOrchestrationHost,
  textOf,
  expectToolPayload,
  expectToolRefusal,
  toolCall,
  waitUntil,
} from "../support/session-orchestration-host.mjs";

const MODELS = [
  { id: "held-model", reasoning: true },
  { id: "held-model-b", reasoning: true },
  { id: "held-model-c", reasoning: true },
  { id: "held-model-d", reasoning: true },
];

const host = await startSessionOrchestrationHost({
  name: "orchestration-creation",
  settings: ENABLED_SETTINGS,
  models: MODELS,
});
after(() => host.close());

function git(cwd, ...args) {
  return execFileSync(
    "git",
    ["-c", "user.name=Fixture", "-c", "user.email=fixture@example.com", "-c", "commit.gpgsign=false", ...args],
    {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
}

function createRepository(label) {
  const repository = host.workspace(label);
  git(repository, "init", "--initial-branch=main");
  writeFileSync(path.join(repository, "README.md"), `# ${label}\n`);
  git(repository, "add", "README.md");
  git(repository, "commit", "-m", "Start the repository");
  return repository;
}

test(
  "session_new makes a delegated session that the history lists under its creator in the same directory",
  { timeout: 60_000 },
  async () => {
    const parentCwd = host.workspace("delegating-parent");
    const parent = await host.createUserSession({ cwd: parentCwd });
    const childMessage = "Draft the migration plan";
    host.model.script(childMessage, [{ text: "The migration plan is drafted" }]);
    const events = host.events(parent);

    const [received] = await runAgentTurn(host, parent, {
      prompt: "Hand the plan to a worker",
      steps: [toolCall("session_new", { message: childMessage }), { text: "Handed off" }],
    });

    const payload = expectToolPayload(received, "the model must receive a session_new result");
    const childId = payload.sessionId;
    assert.equal(typeof childId, "string");
    assert.notEqual(childId, parent, "the created session is a different session");

    const row = await waitUntil(() => host.sessionRow(childId), {
      timeoutMs: 8_000,
      label: "the created session to be listed",
    });
    assert.equal(row.parentSessionId, parent, "the created session hangs under its creator");
    assert.equal(row.relation, "delegate", "a session created by another session is a delegation, not a fork");
    assert.equal(row.createdBySessionId, parent, "the creator is recorded");
    assert.equal(row.cwd, parentCwd, "the created session works in the creator's directory");

    const ended = events.all.find((event) => event.type === "tool_execution_end" && event.toolName === "session_new");
    assert.equal(ended?.result?.details?.targetSessionId, childId, "the tool card can point at the created session");

    await waitUntil(
      async () => {
        const detail = await host.detail(childId);
        const last = detail.context.messages.at(-1);
        return last?.role === "assistant" && textOf(last) === "The migration plan is drafted";
      },
      { timeoutMs: 10_000, label: "the created session to answer its first message" },
    );
  },
);

test(
  "the first message a created session receives is marked as coming from the creating session, in saved history and in the live stream",
  { timeout: 60_000 },
  async () => {
    const parent = await host.createUserSession({ cwd: host.workspace("source-parent") });
    const childMessage = "Summarise the failing tests";
    host.model.script(childMessage, [{ text: "Two tests fail" }]);
    const live = [];
    const off = host.client.subscribe("agent.events", "*", (event) => live.push(event));

    try {
      const [received] = await runAgentTurn(host, parent, {
        prompt: "Ask a worker to summarise",
        steps: [toolCall("session_new", { message: childMessage }), { text: "Asked" }],
      });
      const childId = expectToolPayload(received, "the model must receive a session_new result").sessionId;

      const marked = await waitUntil(
        () =>
          live.find(
            (event) =>
              (event.type === "message_start" || event.type === "message_end") &&
              event.message?.role === "user" &&
              textOf(event.message) === childMessage,
          ),
        { timeoutMs: 10_000, label: "the live user message of the created session" },
      );
      assert.equal(marked.message.sessionSource?.sessionId, parent, "the live bubble shows its origin");

      const detail = await host.detail(childId);
      const firstUser = detail.context.messages.find((message) => message.role === "user");
      assert.equal(textOf(firstUser), childMessage);
      assert.equal(
        firstUser.sessionSource?.sessionId,
        parent,
        "reopening the session still shows where the message came from",
      );
    } finally {
      off();
    }
  },
);

test(
  "a created session inherits the creator's model and thinking level when Settings name no override",
  { timeout: 60_000 },
  async () => {
    const parent = await host.createUserSession({
      cwd: host.workspace("model-parent"),
      provider: "held-fixture",
      modelId: "held-model-b",
      thinkingLevel: "high",
    });
    const childMessage = "Inherit the working style";
    host.model.script(childMessage, [{ text: "Inherited" }]);

    const [received] = await runAgentTurn(host, parent, {
      prompt: "Start a worker like yourself",
      steps: [toolCall("session_new", { message: childMessage }), { text: "Started" }],
    });
    const childId = expectToolPayload(received, "the model must receive a session_new result").sessionId;

    const state = await waitUntil(
      async () => {
        const result = await host.state(childId);
        return result.running ? result.state : null;
      },
      { timeoutMs: 8_000, label: "the created session to be live" },
    );
    assert.deepEqual(state.model, { id: "held-model-b", provider: "held-fixture" });
    assert.equal(state.thinkingLevel, "high");
  },
);

test(
  "session_new refuses a directory from another project but accepts a worktree of the creator's own repository",
  { timeout: 90_000 },
  async () => {
    const repository = createRepository("main-checkout");
    const worktree = path.join(host.base, "linked-worktree");
    git(repository, "worktree", "add", worktree, "-b", "linked-branch");
    const otherProject = host.workspace("other-project");
    mkdirSync(path.join(otherProject, "src"), { recursive: true });

    const refusingParent = await host.createUserSession({ cwd: repository });
    const [refused] = await runAgentTurn(host, refusingParent, {
      prompt: "Work in the other project",
      steps: [toolCall("session_new", { cwd: otherProject, message: "Cross the project border" }), { text: "Blocked" }],
    });
    expectToolRefusal(refused, "a directory from another project must be refused", /project/i);
    assert.equal(
      (await host.sessions()).some((session) => session.cwd === otherProject),
      false,
      "no session was created outside the creator's project",
    );

    const acceptingParent = await host.createUserSession({ cwd: repository });
    const childMessage = "Work in the linked worktree";
    host.model.script(childMessage, [{ text: "Working in the worktree" }]);
    const [accepted] = await runAgentTurn(host, acceptingParent, {
      prompt: "Hand this to a worker in the linked worktree",
      steps: [toolCall("session_new", { cwd: worktree, message: childMessage }), { text: "Started" }],
    });
    const payload = expectToolPayload(accepted, "a worktree of the same repository must be accepted");
    const row = await waitUntil(() => host.sessionRow(payload.sessionId), {
      timeoutMs: 8_000,
      label: "the worktree session to be listed",
    });
    assert.equal(row.cwd, worktree);
  },
);
