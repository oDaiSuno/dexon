import assert from "node:assert/strict";
import test from "node:test";
import { createSessionDetail, createSessionHookHarness, createSessionTestHost } from "./session-hook-harness.mjs";

async function mountedSession(t) {
  const detail = createSessionDetail("s-1");
  const host = createSessionTestHost({ getSession: async () => detail });
  const h = await createSessionHookHarness(t, { bundleName: "session-tool-updates", host });
  await h.mount({ session: detail.info, newSessionCwd: null });
  await h.flush();
  return { h, detail };
}

test("live tool updates preserve their clock and final result until the tool result message arrives", async (t) => {
  t.mock.timers.enable({ apis: ["Date"] });
  t.mock.timers.setTime(1_700_000_000_000);
  const { h } = await mountedSession(t);
  h.emit({ type: "agent_start" });
  h.emit({ type: "tool_execution_start", toolCallId: "script-1", toolName: "codemode" });
  await h.flush();
  assert.equal(h.state.liveToolUpdates.get("script-1").startedAt, 1_700_000_000_000);

  const partialResult = {
    content: [],
    details: { calls: [{ id: "read-1", name: "read", args: "{}", status: "running" }] },
  };
  t.mock.timers.setTime(1_700_000_000_100);
  h.emit({ type: "tool_execution_update", toolCallId: "script-1", toolName: "codemode", partialResult });
  await h.flush();
  assert.deepEqual(h.state.liveToolUpdates.get("script-1").partialResult, partialResult);
  assert.equal(h.state.liveToolUpdates.get("script-1").startedAt, 1_700_000_000_000);

  const result = { content: [{ type: "text", text: "Script completed.\nhello" }], details: { calls: [] } };
  t.mock.timers.setTime(1_700_000_000_800);
  h.emit({ type: "tool_execution_end", toolCallId: "script-1", toolName: "codemode", result, isError: false });
  await h.flush();
  assert.deepEqual(h.state.liveToolUpdates.get("script-1").partialResult, result);
  assert.equal(h.state.liveToolUpdates.get("script-1").endedAt, 1_700_000_000_800);

  h.emit({ type: "message_end", message: { role: "toolResult", toolCallId: "script-1", ...result } });
  await h.flush();
  assert.equal(h.state.liveToolUpdates.has("script-1"), false);
  assert.equal(h.state.messages.at(-1).toolCallId, "script-1");
});

test("finishing or switching sessions clears live tools and late updates cannot revive a completed run", async (t) => {
  const { h, detail } = await mountedSession(t);
  h.emit({ type: "agent_start" });
  h.emit({ type: "tool_execution_start", toolCallId: "script-1", toolName: "codemode" });
  await h.flush();
  assert.equal(h.state.liveToolUpdates.size, 1);
  h.emit({ type: "agent_end" });
  await h.flush();
  assert.equal(h.state.liveToolUpdates.size, 0);
  h.emit({ type: "tool_execution_update", toolCallId: "script-1", partialResult: { calls: [] } });
  await h.flush();
  assert.equal(h.state.liveToolUpdates.size, 0);

  h.emit({ type: "agent_start" });
  h.emit({ type: "tool_execution_start", toolCallId: "script-2", toolName: "codemode" });
  await h.flush();
  assert.equal(h.state.liveToolUpdates.size, 1);
  await h.update({ session: { ...detail.info, id: "s-2" }, newSessionCwd: null });
  await h.flush();
  assert.equal(h.state.liveToolUpdates.size, 0);
});

test("a late partial or end cannot replace the frozen final tool result", async (t) => {
  t.mock.timers.enable({ apis: ["Date"] });
  t.mock.timers.setTime(1_700_000_000_000);
  const { h } = await mountedSession(t);
  const finalResult = { content: [{ type: "text", text: "final output" }], details: { calls: [] } };
  h.emit({ type: "agent_start" });
  h.emit({ type: "tool_execution_start", toolCallId: "script-1", toolName: "codemode" });
  h.emit({ type: "tool_execution_end", toolCallId: "script-1", result: finalResult });
  await h.flush();
  h.emit({ type: "tool_execution_update", toolCallId: "script-1", partialResult: { content: [] } });
  await h.flush();
  assert.deepEqual(h.state.liveToolUpdates.get("script-1").partialResult, finalResult);
  t.mock.timers.setTime(1_700_000_001_000);
  h.emit({ type: "tool_execution_end", toolCallId: "script-1", result: { content: [] } });
  await h.flush();
  assert.deepEqual(h.state.liveToolUpdates.get("script-1").partialResult, finalResult);
  assert.equal(h.state.liveToolUpdates.get("script-1").endedAt, 1_700_000_000_000);
  h.emit({ type: "message_end", message: { role: "toolResult", toolCallId: "script-1", ...finalResult } });
  await h.flush();
  h.emit({ type: "tool_execution_end", toolCallId: "script-1", result: { content: [] } });
  await h.flush();
  assert.equal(h.state.liveToolUpdates.has("script-1"), false);
  assert.equal(h.state.messages.at(-1).content[0].text, "final output");
  h.emit({ type: "tool_execution_update", toolCallId: "script-1", partialResult: { content: [] } });
  await h.flush();
  assert.equal(h.state.liveToolUpdates.has("script-1"), false);
});

test("promoting a new conversation keeps the live script and its original start time", async (t) => {
  let promoted;
  const host = createSessionTestHost({ newAgent: async () => ({ sessionId: "fresh-1" }) });
  const h = await createSessionHookHarness(t, { bundleName: "session-tool-promotion", host });
  const onSessionCreated = (info) => {
    promoted = info;
  };
  await h.mount({ session: null, newSessionCwd: "/fixture", onSessionCreated });
  await h.flush();
  await h.act(() => h.state.handleSend("run a script"));
  h.emit({ type: "agent_start" });
  h.emit({ type: "tool_execution_start", toolCallId: "script-1", toolName: "codemode" });
  await h.flush();
  const update = h.state.liveToolUpdates.get("script-1");
  assert.ok(update);
  assert.equal(promoted.id, "fresh-1");
  await h.update({ session: promoted, newSessionCwd: null, onSessionCreated });
  await h.flush();
  assert.deepEqual(h.state.liveToolUpdates.get("script-1"), update);
});
