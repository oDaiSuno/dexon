import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { after } from "node:test";
import { MessageChannel } from "node:worker_threads";
import { importTestBundle } from "#test-bundle";
import { createDeferred } from "#test-timing";
import { createRpcClient, createRpcServer } from "../../src/contract/rpc.ts";
import { startHeldModelServer } from "../fixtures/held-model-server.mjs";
import { installMainProcessPort } from "../fixtures/main-process-port.mjs";

const base = realpathSync(mkdtempSync(path.join(tmpdir(), "dexon-unsaved-session-")));
const agent = path.join(base, "agent");
const workspace = path.join(base, "workspace");
for (const directory of [agent, workspace]) mkdirSync(directory);
const variables = ["PI_CODING_AGENT_DIR", "PI_CODING_AGENT_SESSION_DIR", "PI_DESKTOP_USER_DATA", "PI_OFFLINE"];
const previous = new Map(variables.map((name) => [name, process.env[name]]));
process.env.PI_CODING_AGENT_DIR = agent;
process.env.PI_CODING_AGENT_SESSION_DIR = path.join(base, "sessions");
process.env.PI_DESKTOP_USER_DATA = path.join(base, "desktop");
process.env.PI_OFFLINE = "1";
const restoreMainProcess = installMainProcessPort();
const model = await startHeldModelServer();
model.configure(agent);

const { registerHandlers } = await importTestBundle("host-unsaved-session", {
  packages: "external",
  absWorkingDir: path.resolve(import.meta.dirname, "../.."),
  entryPoints: ["src/agent-host/handlers.ts"],
});
const server = createRpcServer();
const { port1, port2 } = new MessageChannel();
server.attachPort(port1);
const client = createRpcClient(port2);
const cleanupHost = registerHandlers(server);

after(async () => {
  try {
    await cleanupHost();
  } finally {
    client.close();
    server.detachPort(port1);
    await model.close();
    restoreMainProcess();
    for (const [name, value] of previous) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    rmSync(base, { recursive: true, force: true });
  }
});

const textOf = (message) =>
  typeof message?.content === "string"
    ? message.content
    : (message?.content ?? [])
        .filter((part) => part.type === "text")
        .map((part) => part.text)
        .join("");

function eventsOf(sessionId) {
  const seen = [];
  const waiters = new Set();
  const off = client.subscribe("agent.events", sessionId, (event) => {
    seen.push(event);
    for (const waiter of waiters) if (waiter.matches(event)) waiter.deferred.resolve(event);
  });
  return {
    off,
    next(matches) {
      const found = seen.find(matches);
      if (found) return Promise.resolve(found);
      const waiter = { matches, deferred: createDeferred() };
      waiters.add(waiter);
      return waiter.deferred.promise.finally(() => waiters.delete(waiter));
    },
  };
}

const showsText = (text) => (event) => event.type === "message_update" && textOf(event.message).includes(text);
const ended = (event) => event.type === "agent_end";

async function startHeldConversation(t, prompt, reply) {
  const held = model.hold(prompt, reply);
  t.after(() => held.release());
  const { sessionId } = await client.call("agent.new", { cwd: workspace, type: "ensure_session" });
  const events = eventsOf(sessionId);
  t.after(() => events.off());
  await client.call("agent.command", { sessionId, command: { type: "prompt", message: prompt } });
  await held.partialSent();
  await events.next(showsText(reply.partial));
  return { sessionId, held, events };
}

const listed = async (sessionId) =>
  (await client.call("sessions.list")).sessions.filter((session) => session.id === sessionId);

test("a new conversation is listed as soon as its first message is accepted, before any reply is complete", async (t) => {
  const prompt = "Plan the unsaved listing check";
  const { sessionId } = await startHeldConversation(t, prompt, {
    partial: "Listing reply has begun",
    rest: " and now it is finished.",
  });
  const rows = await listed(sessionId);
  assert.equal(rows.length, 1, "the running conversation has exactly one history entry");
  assert.equal(rows[0].cwd, workspace);
  assert.equal(rows[0].firstMessage, prompt);
  assert.ok((await client.call("sessions.list")).runningSessionIds.includes(sessionId));
});

test("a blank new conversation that has not sent a message stays out of the history", async () => {
  const { sessionId } = await client.call("agent.new", { cwd: workspace, type: "ensure_session" });
  assert.deepEqual(await listed(sessionId), []);
});

test("opening a running conversation before its first save shows the sent message and the reply written so far", async (t) => {
  const prompt = "Explain the partial reading check";
  const partial = "Partial reading reply so far";
  const { sessionId } = await startHeldConversation(t, prompt, { partial, rest: " plus its ending." });
  const detail = await client.call("sessions.get", { id: sessionId, includeState: true });
  assert.equal(detail.sessionId, sessionId);
  assert.deepEqual(
    detail.context.messages.map((message) => [message.role, textOf(message)]),
    [["user", prompt]],
    "only the accepted message is history; the unfinished reply is not saved as a message",
  );
  assert.equal(detail.agentState.running, true);
  assert.equal(detail.agentState.state.isStreaming, true);
  assert.equal(detail.agentState.state.streamingMessage?.role, "assistant");
  assert.equal(textOf(detail.agentState.state.streamingMessage), partial);
});

test("after the first reply is saved it is still the same single conversation, with each message once", async (t) => {
  const prompt = "Confirm the first save keeps one entry";
  const { sessionId, held, events } = await startHeldConversation(t, prompt, {
    partial: "Saved reply starts",
    rest: " and ends after the release.",
  });
  assert.equal((await listed(sessionId)).length, 1);
  held.release();
  await events.next(ended);
  await events.next((event) => event.type === "prompt_done");
  const rows = await listed(sessionId);
  assert.equal(rows.length, 1, "the saved file and the running conversation are not listed twice");
  assert.equal(rows[0].firstMessage, prompt);
  const detail = await client.call("sessions.get", { id: sessionId, includeState: true });
  assert.deepEqual(
    detail.context.messages.map((message) => [message.role, textOf(message)]),
    [
      ["user", prompt],
      ["assistant", "Saved reply starts and ends after the release."],
    ],
  );
  assert.equal(detail.agentState.state?.streamingMessage ?? null, null, "no reply is still in progress");
});
