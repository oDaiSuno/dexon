import assert from "node:assert/strict";
import test, { after } from "node:test";
import {
  ENABLED_SETTINGS,
  expectToolPayload,
  expectToolRefusal,
  resultQueue,
  startSessionOrchestrationHost,
  textOf,
  toolCall,
} from "../support/session-orchestration-host.mjs";

const host = await startSessionOrchestrationHost({ name: "prompt-ownership", settings: ENABLED_SETTINGS });
after(() => host.close());

async function createWorker(cwd, label) {
  const parent = await host.createUserSession({ cwd });
  host.model.script(`${label} parent`, [
    toolCall("session_new", { message: `${label} worker`, wait: true, timeoutSeconds: 20 }),
    { text: "Worker ready" },
  ]);
  host.model.script(`${label} worker`, [{ text: "Ready" }]);
  const results = resultQueue(host);
  const events = host.events(parent);
  try {
    await host.prompt(parent, `${label} parent`);
    const child = expectToolPayload(await results.named("session_new"), "the owner creates a worker").sessionId;
    await events.next((event) => event.type === "agent_end");
    return { parent, child };
  } finally {
    events.off();
  }
}

test(
  "a delegate cannot prompt its parent even when user-to-user messaging is enabled",
  { timeout: 30_000 },
  async () => {
    const parent = await host.createUserSession({ cwd: host.workspace("parent-refusal") });
    host.model.script("Parent starts a delegate", [
      toolCall("session_new", { message: "Delegate tries its parent", wait: true, timeoutSeconds: 20 }),
      { text: "Parent finished" },
    ]);
    host.model.script("Delegate tries its parent", [
      toolCall("session_prompt", { sessionId: parent, message: "Unauthorized parent turn", wait: false }),
      { text: "Delegate finished after refusal" },
    ]);
    const results = resultQueue(host);
    const events = host.events(parent);
    try {
      await host.prompt(parent, "Parent starts a delegate");
      expectToolRefusal(
        await results.named("session_prompt"),
        "a delegate cannot direct its parent",
        /Only sessions created by this session can be prompted/,
      );
      const child = expectToolPayload(await results.named("session_new"), "refusal does not interrupt the delegate");
      assert.equal(child.lastReply, "Delegate finished after refusal");
      await events.next((event) => event.type === "agent_end");
      const messages = (await host.detail(parent)).context.messages;
      assert.equal(
        messages.some((message) => textOf(message) === "Unauthorized parent turn"),
        false,
      );
    } finally {
      events.off();
    }
  },
);

for (const delegateCaller of [false, true]) {
  test(
    `${delegateCaller ? "another owner's delegate" : "another user session"} cannot prompt an owned worker with user messaging enabled`,
    { timeout: 30_000 },
    async () => {
      const cwd = host.workspace(`foreign-worker-${delegateCaller}`);
      const { child } = await createWorker(cwd, `Owner ${delegateCaller}`);
      const before = (await host.detail(child)).context.messages;
      const other = await host.createUserSession({ cwd });
      const attack = toolCall("session_prompt", { sessionId: child, message: "Unauthorized worker turn", wait: false });
      host.model.script(
        `Other owner ${delegateCaller}`,
        delegateCaller
          ? [
              toolCall("session_new", { message: "Foreign delegate tries a worker", wait: true, timeoutSeconds: 20 }),
              { text: "Other owner finished" },
            ]
          : [attack, { text: "Other owner finished" }],
      );
      if (delegateCaller) host.model.script("Foreign delegate tries a worker", [attack, { text: "Delegate finished" }]);
      const results = resultQueue(host);
      const events = host.events(other);
      try {
        await host.prompt(other, `Other owner ${delegateCaller}`);
        expectToolRefusal(
          await results.named("session_prompt"),
          "only the creating session may prompt this worker",
          /Only sessions created by this session can be prompted/,
        );
        await events.next((event) => event.type === "agent_end");
        assert.deepEqual(
          (await host.detail(child)).context.messages,
          before,
          "the refused turn never reaches the worker",
        );
      } finally {
        events.off();
      }
    },
  );
}

test("a user session can prompt another user session when user messaging is enabled", { timeout: 30_000 }, async () => {
  const cwd = host.workspace("user-peers");
  const peerA = await host.createUserSession({ cwd });
  const peerB = await host.createUserSession({ cwd });
  host.model.script("Ask another user session", [
    toolCall("session_prompt", { sessionId: peerB, message: "Peer request", wait: true, timeoutSeconds: 20 }),
    { text: "Peer answered" },
  ]);
  host.model.script("Peer request", [{ text: "Peer response" }]);
  const results = resultQueue(host);
  const events = host.events(peerA);
  try {
    await host.prompt(peerA, "Ask another user session");
    const reply = expectToolPayload(await results.named("session_prompt"), "user sessions may collaborate");
    assert.equal(reply.lastReply, "Peer response");
    assert.equal(reply.status, "idle");
    await events.next((event) => event.type === "agent_end");
    const messages = (await host.detail(peerB)).context.messages;
    assert.equal(messages.filter((message) => message.role === "user").length, 1);
    assert.equal(textOf(messages.at(-1)), "Peer response");
  } finally {
    events.off();
  }
});
