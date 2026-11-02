import assert from "node:assert/strict";
import test from "node:test";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { importTestBundle } from "#test-bundle";
import { isDisplayEvent, toDisplayEvent, toDisplayMessage } from "./display-message.ts";

const { AgentSessionWrapper } = await importTestBundle("display-message", {
  packages: "external",
  stdin: {
    contents: 'export { AgentSessionWrapper } from "./rpc-manager.ts";',
    resolveDir: import.meta.dirname,
    loader: "ts",
  },
});

test("agent_end dispatch keeps visible message order and event fields without changing the original", (t) => {
  let dispatch;
  const wrapper = new AgentSessionWrapper({
    sessionId: "display-message-test",
    sessionManager: SessionManager.inMemory(),
    subscribe(listener) {
      dispatch = listener;
      return () => undefined;
    },
  });
  t.after(() => wrapper.destroy());
  const events = [];
  wrapper.onEvent((event) => events.push(event));
  wrapper.start();

  const system = { role: "system", content: "private", timestamp: 1 };
  const user = { role: "user", content: "hello", timestamp: 2 };
  const assistant = { role: "assistant", content: [{ type: "text", text: "done" }], timestamp: 3 };
  const result = { role: "toolResult", toolName: "read", content: [{ type: "text", text: "file" }] };
  const event = {
    type: "agent_end",
    messages: [system, user, assistant, { ...system, content: "private tool loadout" }, result],
    aborted: false,
    metadata: { runId: "run-a" },
  };
  const original = structuredClone(event);
  dispatch(event);

  const displayed = events.find((item) => item.type === "agent_end");
  assert.deepEqual(displayed.messages, [user, assistant, result]);
  assert.deepEqual(displayed, { ...original, messages: [user, assistant, result] });
  assert.notEqual(displayed, event);
  assert.deepEqual(event, original);
  assert.deepEqual(toDisplayEvent(event), displayed);
  assert.deepEqual(toDisplayEvent({ ...event, messages: [system] }), { ...event, messages: [] });
});

test("system lifecycle events stay inside the host while display and run events pass through", () => {
  const system = { role: "system", content: "private", timestamp: 1 };
  const user = { role: "user", content: "hello", timestamp: 2 };
  assert.equal(toDisplayMessage(system), null);
  assert.equal(toDisplayMessage(user), user);
  for (const type of ["message_start", "message_update", "message_end"]) {
    assert.equal(isDisplayEvent({ type, message: system }), false, type);
    assert.equal(isDisplayEvent({ type, message: user }), true, type);
    assert.equal(toDisplayEvent({ type, message: system }), null, type);
    const visible = { type, message: user };
    assert.equal(toDisplayEvent(visible), visible, type);
  }
  for (const event of [
    { type: "agent_settled", aborted: false },
    { type: "tool_execution_end", result: "ok" },
    { type: "agent_end" },
  ]) {
    assert.equal(isDisplayEvent(event), true);
    assert.equal(toDisplayEvent(event), event);
  }
});
