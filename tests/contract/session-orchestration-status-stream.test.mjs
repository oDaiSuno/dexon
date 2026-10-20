import assert from "node:assert/strict";
import test, { after } from "node:test";
import {
  ENABLED_SETTINGS,
  collectEvents,
  startSessionOrchestrationHost,
  waitUntil,
} from "../support/session-orchestration-host.mjs";

// A failing provider reply must surface as a failed turn, so retries are off and
// the failure is a single deterministic request.
const host = await startSessionOrchestrationHost({
  name: "orchestration-status-stream",
  settings: ENABLED_SETTINGS,
  retry: false,
});
after(() => host.close());

test(
  "the live status stream reports a running turn and then the error that ended it",
  { timeout: 60_000 },
  async () => {
    const session = await host.createUserSession({ cwd: host.workspace("failing") });
    host.model.script("Fail this turn on purpose", [{ error: { status: 400, message: "fixture provider failure" } }]);
    const frames = [];
    const offRunning = host.client.subscribe("agent.running", "*", (frame) => frames.push(frame));
    const events = collectEvents(host.client, session);

    try {
      await host.prompt(session, "Fail this turn on purpose");
      await events.next((event) => event.type === "prompt_done" || event.type === "prompt_error");

      const errorFrame = await waitUntil(() => frames.find((frame) => frame.sessionStatuses?.[session] === "error"), {
        timeoutMs: 12_000,
        label: "the stream to report the failed turn",
      });
      const runningFrame = frames.find((frame) => frame.sessionStatuses?.[session] === "running");
      assert.ok(runningFrame, "the stream reported the turn as running before it failed");
      assert.ok(
        frames.indexOf(runningFrame) < frames.indexOf(errorFrame),
        "running comes before the failure in the stream",
      );
    } finally {
      offRunning();
      events.off();
    }
  },
);
