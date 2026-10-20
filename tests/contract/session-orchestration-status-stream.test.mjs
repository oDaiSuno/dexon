import assert from "node:assert/strict";
import test, { after } from "node:test";
import {
  ENABLED_SETTINGS,
  collectEvents,
  startSessionOrchestrationHost,
  waitUntil,
} from "../support/session-orchestration-host.mjs";

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

test("a turn the user stopped is reported as idle rather than as an error", { timeout: 60_000 }, async () => {
  const session = await host.createUserSession({ cwd: host.workspace("stopped-status") });
  const turn = host.model.script("Work until the user stops it", [
    { hold: true, partial: "Working on it", rest: " and finished" },
  ]);

  await host.prompt(session, "Work until the user stops it");
  await turn.partialSent(0);
  await host.command(session, { type: "abort" });
  await waitUntil(async () => (await host.state(session)).state?.isPromptRunning === false, {
    timeoutMs: 20_000,
    label: "the stopped turn to release the session",
  });

  const listed = await host.client.call("sessions.list");
  assert.notEqual(
    listed.sessionStatuses?.[session],
    "error",
    "stopping a turn is not a failure, so the session must not be reported as an error",
  );
});
