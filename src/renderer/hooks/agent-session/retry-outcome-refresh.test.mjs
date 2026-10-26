import assert from "node:assert/strict";
import test from "node:test";
import {
  createReadingSurface,
  createSessionDetail,
  createSessionHookHarness,
  createSessionTestHost,
} from "./session-hook-harness.mjs";

function failedTurn(retry) {
  return [
    { role: "user", content: "fixture", timestamp: 1 },
    {
      role: "assistant",
      content: [],
      provider: "fixture",
      model: "fixture-model",
      stopReason: "error",
      errorMessage: "503 overloaded",
      timestamp: 2,
      ...(retry ? { retry } : {}),
    },
  ];
}

test("when automatic retries give up, the chat reloads so the failure shows how many attempts were made", async (t) => {
  let saved = createSessionDetail("s-retry", { messages: failedTurn(null) });
  const host = createSessionTestHost({ getSession: async () => saved });
  const h = await createSessionHookHarness(t, {
    bundleName: "retry-outcome-refresh",
    host,
    attach: (state) => {
      const surface = createReadingSurface();
      state.scrollContainerRef.current = surface.container;
      state.liveContentEndRef.current = surface.liveEnd;
      state.messagesEndRef.current = surface.messagesEnd;
      state.lastUserMsgRef.current = surface.lastUserMsg;
    },
  });
  await h.mount({ session: saved.info, newSessionCwd: null });
  await h.flush();
  await h.env.flushRafUntilSettled();
  assert.equal(h.state.messages.at(-1).retry, undefined);

  saved = createSessionDetail("s-retry", {
    messages: failedTurn({ attempt: 3, maxAttempts: 3 }),
    historyRevision: "s-retry-after-retries",
  });
  h.emit({ type: "auto_retry_end", success: false, attempt: 3, finalError: "503 overloaded" });
  await h.flush();
  await h.flush();
  assert.deepEqual(h.state.messages.at(-1).retry, { attempt: 3, maxAttempts: 3 });
});
