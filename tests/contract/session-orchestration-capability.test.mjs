import assert from "node:assert/strict";
import test, { after } from "node:test";
import {
  ENABLED_SETTINGS,
  SESSION_TOOL_NAMES,
  startSessionOrchestrationHost,
  waitUntil,
} from "../support/session-orchestration-host.mjs";

const host = await startSessionOrchestrationHost({ name: "orchestration-capability" });
after(() => host.close());

test(
  "while the collaboration setting is off a running session sees none of the session tools, and turning it on in Settings makes them available without a restart",
  { timeout: 60_000 },
  async () => {
    const parent = await host.createUserSession({ cwd: host.workspace("parent") });
    const disabledTools = await host.activeToolNames(parent);
    assert.deepEqual(
      disabledTools.filter((name) => SESSION_TOOL_NAMES.includes(name)),
      [],
      "the Agent must not see any session tool while the setting is off",
    );

    host.mainPort.setSessionOrchestrationSettings(ENABLED_SETTINGS);

    const enabled = await waitUntil(
      async () => {
        const active = await host.activeToolNames(parent);
        return SESSION_TOOL_NAMES.every((name) => active.includes(name)) ? active : null;
      },
      { timeoutMs: 8_000, label: "the live session to gain the session tools" },
    );
    assert.deepEqual(
      SESSION_TOOL_NAMES.filter((name) => enabled.includes(name)).sort(),
      [...SESSION_TOOL_NAMES].sort(),
      "all nine session tools become active on a session that was already running",
    );
  },
);
