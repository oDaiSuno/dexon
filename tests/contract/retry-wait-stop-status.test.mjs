import assert from "node:assert/strict";
import test, { after } from "node:test";
import {
  ENABLED_SETTINGS,
  collectEvents,
  startSessionOrchestrationHost,
  waitUntil,
} from "../support/session-orchestration-host.mjs";

const host = await startSessionOrchestrationHost({
  name: "retry-wait-stop-status",
  settings: ENABLED_SETTINGS,
  retry: { enabled: true, maxRetries: 2, baseDelayMs: 60_000 },
});
after(() => host.close());

test(
  "when the user stops during the wait before an automatic retry, the session is not reported as an error",
  { timeout: 90_000 },
  async () => {
    const session = await host.createUserSession({ cwd: host.workspace("retry-wait-stop") });
    const prompt = "Fail once and then wait before retrying";
    host.model.script(prompt, [
      { error: { status: 503, message: "upstream is overloaded" } },
      { text: "never reached" },
    ]);
    const events = collectEvents(host.client, session);

    try {
      await host.prompt(session, prompt);
      await events.next((event) => event.type === "auto_retry_start");
      await host.command(session, { type: "abort" });
      const detail = await waitUntil(
        async () => {
          const state = await host.state(session);
          return state.state?.isPromptRunning === false ? await host.detail(session) : null;
        },
        { timeoutMs: 30_000, label: "the stopped retry wait to release the session" },
      );

      const failures = detail.context.messages.filter(
        (message) => message.role === "assistant" && message.stopReason === "error",
      );
      assert.equal(failures.length, 1, "the failure that made the app wait for a retry stays in the saved history");
      const listed = await host.client.call("sessions.list");
      assert.notEqual(
        listed.sessionStatuses?.[session],
        "error",
        "stopping the wait before a retry is the user giving up, not a failure of the turn",
      );
    } finally {
      events.off();
    }
  },
);
