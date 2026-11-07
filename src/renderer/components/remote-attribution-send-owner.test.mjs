import { attributionFixture, restoreGlobals, createElement, act } from "./remote-attribution.harness.mjs";
import { createSessionDetail, createSessionTestHost } from "../hooks/agent-session/session-hook-harness.mjs";
import assert from "node:assert/strict";
import test, { after } from "node:test";

after(restoreGlobals);

const sessionExports = 'export { useAgentSession } from "./hooks/useAgentSession.ts";';

async function mountSession(f, options) {
  let latest;
  function Session() {
    latest = f.api.useAgentSession(options);
    return createElement("output", null, String(latest.agentRunning));
  }
  await f.render(Session);
  await f.flush();
  return () => latest;
}

test("the send owner rejects an unavailable actual remote even when workspace focus is local", async (t) => {
  const f = await attributionFixture(t, sessionExports);
  const detail = createSessionDetail("offline-owner");
  const primary = createSessionTestHost({ getSession: async () => detail });
  f.setPrimaryHost(primary);
  f.api.environmentRegistry.registerSession("remote-a", detail.info.id);
  await f.status({ phase: "offline", lastFailure: null });
  const state = await mountSession(f, { session: { ...detail.info, environmentId: "remote-a" }, newSessionCwd: null });
  let result;
  await act(async () => {
    result = await state().handleSend("keep this draft");
  });
  assert.deepEqual(result, { ok: false });
  assert.equal(primary.sendCommands.length, 0);
  assert.equal(state().agentRunning, false);
  assert.equal(
    state().messages.some((message) => message.content === "keep this draft"),
    false,
  );
});

test("new-session creation, prompt and promotion stay on their captured server after focus changes", async (t) => {
  const f = await attributionFixture(t, sessionExports);
  const creationsA = [];
  const creationsB = [];
  const promoted = [];
  const hostA = createSessionTestHost({
    newAgent: async (params) => {
      creationsA.push(params);
      return { sessionId: "shared-id" };
    },
  });
  const hostB = createSessionTestHost({
    newAgent: async (params) => {
      creationsB.push(params);
      return { sessionId: "shared-id" };
    },
  });
  f.serve("remote-a", hostA);
  f.serve("remote-b", hostB);
  f.api.environmentRegistry.registerSession("remote-b", "shared-id");
  await f.focus();
  const state = await mountSession(f, {
    session: null,
    newSessionCwd: "/srv/shared",
    onSessionCreated: (info) => promoted.push(info),
  });
  await act(async () => {
    const sending = state().handleSend("work on server A");
    f.api.workspaceStore.openSpace({ environmentId: "remote-b", path: "/srv/shared" });
    await sending;
  });
  await f.flush();
  assert.equal(creationsA.length, 1, "only the originating server creates the session");
  assert.equal(creationsB.length, 0);
  assert.deepEqual(hostA.sendCommands.find(({ payload }) => payload.type === "prompt")?.payload, {
    type: "prompt",
    message: "work on server A",
  });
  assert.equal(hostB.sendCommands.length, 0, "a colliding session id must not reroute the prompt");
  assert.equal(promoted[0].environmentId, "remote-a");
  assert.equal(hostA.autoTitleRequests.length, 1);
  assert.equal(hostB.autoTitleRequests.length, 0);
});

test("queued messages use the actual session server and reject after that server disconnects", async (t) => {
  const f = await attributionFixture(t, sessionExports);
  const detail = createSessionDetail("queue-shared-id");
  const hostA = createSessionTestHost({ getSession: async () => detail });
  const hostB = createSessionTestHost({ getSession: async () => detail });
  f.serve("remote-a", hostA);
  f.serve("remote-b", hostB);
  f.api.environmentRegistry.registerSession("remote-a", detail.info.id);
  f.api.environmentRegistry.registerSession("remote-b", detail.info.id);
  await f.focus();
  const state = await mountSession(f, { session: { ...detail.info, environmentId: "remote-a" }, newSessionCwd: null });
  await f.focus("remote-b");
  await act(async () => {
    await state().handleFollowUp("follow server A");
    await state().handleSteer("steer server A");
    await state().handlePromptWithStreamingBehavior("/skill:review server A", "followUp");
  });
  assert.equal(hostA.sendCommands.length, 3);
  assert.equal(hostB.sendCommands.length, 0);
  await f.status({ phase: "offline", lastFailure: null });
  for (const send of [
    state().handleFollowUp,
    state().handleSteer,
    (text) => state().handlePromptWithStreamingBehavior(text, "followUp"),
  ]) {
    assert.deepEqual(await send("keep queued draft"), { ok: false });
  }
  assert.equal(hostA.sendCommands.length, 3);
  assert.equal(hostB.sendCommands.length, 0);
});

test("disconnecting during session creation explicitly rejects the send and rolls back its optimistic message", async (t) => {
  const f = await attributionFixture(t, sessionExports);
  let finishCreation;
  const pending = new Promise((resolve) => {
    finishCreation = resolve;
  });
  const host = createSessionTestHost({ newAgent: () => pending });
  f.serve("remote-a", host);
  await f.focus();
  const state = await mountSession(f, { session: null, newSessionCwd: "/srv/shared" });
  let sending;
  await act(async () => {
    sending = state()
      .handleSend("draft retained after interruption")
      .then(
        (result) => ({ result }),
        (error) => ({ error }),
      );
    await new Promise((resolve) => setImmediate(resolve));
  });
  await f.status({ phase: "offline", lastFailure: null });
  const outcome = await sending;
  finishCreation({ sessionId: "interrupted-creation" });
  await f.flush();
  assert.deepEqual(outcome, { result: { ok: false } });
  assert.equal(state().agentRunning, false);
  assert.equal(
    host.sendCommands.some(({ payload }) => payload.type === "prompt"),
    false,
  );
  assert.equal(
    state().messages.some((message) => message.content === "draft retained after interruption"),
    false,
  );
});

for (const method of ["handleSteer", "handleFollowUp", "handlePromptWithStreamingBehavior"]) {
  test(`${method} explicitly rejects a queued send interrupted by disconnection`, async (t) => {
    const f = await attributionFixture(t, sessionExports);
    const detail = createSessionDetail(`interrupted-${method}`);
    let finish;
    const pending = new Promise((resolve) => {
      finish = resolve;
    });
    f.serve("remote-a", { getSession: async () => detail, sendAgentCommand: () => pending });
    await f.focus();
    const state = await mountSession(f, {
      session: { ...detail.info, environmentId: "remote-a" },
      newSessionCwd: null,
    });
    let sending;
    await act(async () => {
      sending = state()
        [method]("retain the queued draft", "followUp")
        .then(
          (result) => ({ result }),
          (error) => ({ error }),
        );
      await new Promise((resolve) => setImmediate(resolve));
    });
    await f.status({ phase: "offline", lastFailure: null });
    const outcome = await sending;
    finish({});
    await f.flush();
    assert.deepEqual(outcome, { result: { ok: false } });
  });
}
