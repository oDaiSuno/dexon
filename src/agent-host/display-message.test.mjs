import assert from "node:assert/strict";
import test from "node:test";
import { isDisplayEvent, toDisplayMessage } from "./display-message.ts";

test("system lifecycle events stay inside the host while display and run events pass through", () => {
  const system = { role: "system", content: "private", timestamp: 1 };
  const user = { role: "user", content: "hello", timestamp: 2 };
  assert.equal(toDisplayMessage(system), null);
  assert.equal(toDisplayMessage(user), user);
  for (const type of ["message_start", "message_update", "message_end"]) {
    assert.equal(isDisplayEvent({ type, message: system }), false, type);
    assert.equal(isDisplayEvent({ type, message: user }), true, type);
  }
  assert.equal(isDisplayEvent({ type: "agent_settled", aborted: false }), true);
  assert.equal(isDisplayEvent({ type: "tool_execution_end", result: "ok" }), true);
});
