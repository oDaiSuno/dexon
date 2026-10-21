import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { after } from "node:test";
import { MessageChannel } from "node:worker_threads";
import { importTestBundle } from "#test-bundle";
import { createDeferred } from "#test-timing";
import { createRpcClient, createRpcServer } from "../../src/contract/rpc.ts";
import { heldModel, startHeldModelServer } from "../fixtures/held-model-server.mjs";
import { installMainProcessPort } from "../fixtures/main-process-port.mjs";

const base = realpathSync(mkdtempSync(path.join(tmpdir(), "dexon-message-versions-")));
const agent = path.join(base, "agent");
const workspace = path.join(base, "workspace");
const sessionDirectory = path.join(base, "sessions");
for (const directory of [agent, workspace, sessionDirectory]) mkdirSync(directory, { recursive: true });
const variables = ["PI_CODING_AGENT_DIR", "PI_CODING_AGENT_SESSION_DIR", "PI_DESKTOP_USER_DATA", "PI_OFFLINE"];
const previous = new Map(variables.map((name) => [name, process.env[name]]));
process.env.PI_CODING_AGENT_DIR = agent;
process.env.PI_CODING_AGENT_SESSION_DIR = sessionDirectory;
process.env.PI_DESKTOP_USER_DATA = path.join(base, "desktop");
process.env.PI_OFFLINE = "1";
const restoreMainProcess = installMainProcessPort();
const model = await startHeldModelServer({ otherReply: "Fixture reply." });
model.configure(agent);

const bundleOptions = {
  packages: "external",
  absWorkingDir: path.resolve(import.meta.dirname, "../.."),
  entryPoints: ["src/agent-host/handlers.ts"],
};

const firstHost = await importTestBundle("session-message-versions", bundleOptions);
const server = createRpcServer();
const { port1, port2 } = new MessageChannel();
server.attachPort(port1);
const client = createRpcClient(port2);
const cleanupHost = firstHost.registerHandlers(server);

let firstHostClosed = false;
async function closeFirstHost() {
  if (firstHostClosed) return;
  firstHostClosed = true;
  await cleanupHost();
  client.close();
  server.detachPort(port1);
}

async function startSecondHost(name) {
  const bundle = await importTestBundle(name, bundleOptions);
  const secondServer = createRpcServer();
  const channel = new MessageChannel();
  secondServer.attachPort(channel.port1);
  const secondClient = createRpcClient(channel.port2);
  const cleanup = bundle.registerHandlers(secondServer);
  let closed = false;
  return {
    client: secondClient,
    async close() {
      if (closed) return;
      closed = true;
      await cleanup();
      secondClient.close();
      secondServer.detachPort(channel.port1);
    },
  };
}

after(async () => {
  try {
    await closeFirstHost();
  } finally {
    await model.close();
    restoreMainProcess();
    for (const [name, value] of previous) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    rmSync(base, { recursive: true, force: true });
  }
});

const PNG_DATA = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==";

function stamp(second) {
  return new Date(Date.UTC(2026, 7, 6, 9, 0, second)).toISOString();
}

function userEntry(id, parentId, second, text) {
  return {
    id,
    parentId,
    type: "message",
    timestamp: stamp(second),
    message: { role: "user", content: text, timestamp: second * 1000 },
  };
}

function assistantEntry(id, parentId, second, blocks) {
  return {
    id,
    parentId,
    type: "message",
    timestamp: stamp(second),
    message: {
      role: "assistant",
      provider: heldModel.provider,
      model: heldModel.modelId,
      content: blocks,
      stopReason: "stop",
      usage: {
        input: 10,
        output: 5,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 15,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
      timestamp: second * 1000,
    },
  };
}

function textBlock(value) {
  return { type: "text", text: value };
}

function markerEntry(id, parentId, second, customType, data) {
  return { id, parentId, type: "custom", customType, data, timestamp: stamp(second) };
}

function modelChangeEntry(id, parentId, second) {
  return {
    id,
    parentId,
    type: "model_change",
    provider: heldModel.provider,
    modelId: heldModel.modelId,
    timestamp: stamp(second),
  };
}

async function writeSession(anyClient, sessionId, entries) {
  await anyClient.call("sessions.list");
  const header = { type: "session", version: 3, id: sessionId, timestamp: stamp(0), cwd: workspace };
  const filePath = path.join(sessionDirectory, `2026-08-06T09-00-00-000Z_${sessionId}.jsonl`);
  const lines = [header, ...entries].map((entry) => JSON.stringify(entry));
  writeFileSync(filePath, `${lines.join("\n")}\n`, "utf8");
  return filePath;
}

function textOf(message) {
  if (typeof message?.content === "string") return message.content;
  return (message?.content ?? [])
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("");
}

function shownConversation(messages) {
  return messages.map((message) => [message.role, textOf(message)]);
}

async function conversationOf(anyClient, sessionId, leafId) {
  const detail = await anyClient.call(
    "sessions.get",
    leafId === undefined ? { id: sessionId } : { id: sessionId, leafId },
  );
  return detail.context.messages;
}

async function openLive(anyClient, sessionId) {
  await anyClient.call("sessions.list");
  await anyClient.call("agent.command", { sessionId, command: { type: "get_state" } });
}

function eventsOf(anyClient, sessionId) {
  const seen = [];
  const waiters = new Set();
  const off = anyClient.subscribe("agent.events", sessionId, (event) => {
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

const ended = (event) => event.type === "prompt_done";

function idsInFile(filePath) {
  return readFileSync(filePath, "utf8")
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => JSON.parse(line))
    .filter((entry) => entry.type !== "session")
    .map((entry) => entry.id);
}

function digestOf(filePath) {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

function twoVersionsOfOneQuestion(newerBranch) {
  return [
    userEntry("q1", null, 1, "Where do the tests of this project live?"),
    assistantEntry("a1", "q1", 2, [textBlock("The tests live in the tests directory.")]),
    userEntry("q2", "a1", 3, "What does a new session copy from this conversation?"),
    assistantEntry("a2", "q2", 4, [textBlock("It copies the conversation up to the chosen answer.")]),
    ...newerBranch,
  ];
}

test("when a question was edited once, the newest version is shown and both versions are listed on it", async () => {
  const sessionId = "versions-newest-shown";
  await writeSession(
    client,
    sessionId,
    twoVersionsOfOneQuestion([
      userEntry("q2b", "a1", 5, "Which files does a new session copy?"),
      assistantEntry("a2b", "q2b", 6, [textBlock("It copies the files of the chosen answer.")]),
    ]),
  );
  const detail = await client.call("sessions.get", { id: sessionId });
  assert.equal(detail.leafId, "a2b", "the conversation is read at the record written last");
  assert.deepEqual(shownConversation(detail.context.messages), [
    ["user", "Where do the tests of this project live?"],
    ["assistant", "The tests live in the tests directory."],
    ["user", "Which files does a new session copy?"],
    ["assistant", "It copies the files of the chosen answer."],
  ]);
  assert.deepEqual(
    detail.context.messages[2].versions,
    { entryIds: ["q2", "q2b"], index: 1 },
    "the shown question lists the older question first and reports itself as the second version",
  );
  assert.ok(
    !("versions" in detail.context.messages[0]),
    "a question with a single version carries no version list at all",
  );
});

test("when the newer version follows a model change, both questions still count as versions of one message", async () => {
  const sessionId = "versions-after-model-change";
  await writeSession(
    client,
    sessionId,
    twoVersionsOfOneQuestion([
      modelChangeEntry("model-change", "a1", 5),
      userEntry("q2b", "model-change", 6, "Which files does a new session copy?"),
      assistantEntry("a2b", "q2b", 7, [textBlock("It copies the files of the chosen answer.")]),
    ]),
  );
  const detail = await client.call("sessions.get", { id: sessionId });
  assert.deepEqual(shownConversation(detail.context.messages), [
    ["user", "Where do the tests of this project live?"],
    ["assistant", "The tests live in the tests directory."],
    ["user", "Which files does a new session copy?"],
    ["assistant", "It copies the files of the chosen answer."],
  ]);
  assert.deepEqual(
    detail.context.messages[2].versions,
    { entryIds: ["q2", "q2b"], index: 1 },
    "the model change between the answer and the newer question does not split the versions",
  );
});

test("when the newer version follows a channel source marker, both questions still count as versions of one message", async () => {
  const sessionId = "versions-after-channel-marker";
  await writeSession(
    client,
    sessionId,
    twoVersionsOfOneQuestion([
      markerEntry("channel-source", "a1", 5, "dexon-channel-source", { channel: "telegram", runId: "run-1" }),
      userEntry("q2b", "channel-source", 6, "Which files does a new session copy?"),
      assistantEntry("a2b", "q2b", 7, [textBlock("It copies the files of the chosen answer.")]),
    ]),
  );
  const detail = await client.call("sessions.get", { id: sessionId });
  assert.equal(detail.context.messages.length, 4);
  assert.deepEqual(
    detail.context.messages[2].versions,
    { entryIds: ["q2", "q2b"], index: 1 },
    "the channel source marker between the answer and the newer question does not split the versions",
  );
});

test("when the first question of a conversation was edited, both versions are listed on the first question", async () => {
  const sessionId = "versions-first-question";
  await writeSession(client, sessionId, [
    userEntry("q1", null, 1, "Where do the tests of this project live?"),
    assistantEntry("a1", "q1", 2, [textBlock("The tests live in the tests directory.")]),
    userEntry("q1b", null, 3, "Where do the fixtures of this project live?"),
    assistantEntry("a1b", "q1b", 4, [textBlock("The fixtures live in the tests/fixtures directory.")]),
  ]);
  const detail = await client.call("sessions.get", { id: sessionId });
  assert.deepEqual(shownConversation(detail.context.messages), [
    ["user", "Where do the fixtures of this project live?"],
    ["assistant", "The fixtures live in the tests/fixtures directory."],
  ]);
  assert.deepEqual(
    detail.context.messages[0].versions,
    { entryIds: ["q1", "q1b"], index: 1 },
    "two questions that start a conversation are versions of one message",
  );
});

test("when a conversation was never edited, no question reports versions", async () => {
  const sessionId = "versions-none";
  await writeSession(client, sessionId, [
    userEntry("q1", null, 1, "Where do the tests of this project live?"),
    assistantEntry("a1", "q1", 2, [textBlock("The tests live in the tests directory.")]),
    userEntry("q2", "a1", 3, "What does a new session copy from this conversation?"),
    assistantEntry("a2", "q2", 4, [textBlock("It copies the conversation up to the chosen answer.")]),
  ]);
  const messages = await conversationOf(client, sessionId);
  assert.deepEqual(shownConversation(messages), [
    ["user", "Where do the tests of this project live?"],
    ["assistant", "The tests live in the tests directory."],
    ["user", "What does a new session copy from this conversation?"],
    ["assistant", "It copies the conversation up to the chosen answer."],
  ]);
  assert.deepEqual(
    messages.filter((message) => "versions" in message),
    [],
    "an unedited conversation is shown exactly as before, with no version list anywhere",
  );
});

test("when the reader asks for the conversation at an older version's ending, that version is shown with its position", async () => {
  const sessionId = "versions-context-at-old";
  await writeSession(
    client,
    sessionId,
    twoVersionsOfOneQuestion([
      userEntry("q2b", "a1", 5, "Which files does a new session copy?"),
      assistantEntry("a2b", "q2b", 6, [textBlock("It copies the files of the chosen answer.")]),
    ]),
  );
  const answer = await client.call("sessions.context", { id: sessionId, leafId: "a2" });
  assert.deepEqual(shownConversation(answer.context.messages), [
    ["user", "Where do the tests of this project live?"],
    ["assistant", "The tests live in the tests directory."],
    ["user", "What does a new session copy from this conversation?"],
    ["assistant", "It copies the conversation up to the chosen answer."],
  ]);
  assert.deepEqual(
    answer.context.messages[2].versions,
    { entryIds: ["q2", "q2b"], index: 0 },
    "the older question reports itself as the first version",
  );
});

test("when a reader edits a question and sends it, the edit becomes a new version and the old version stays in the session file", async (t) => {
  const sessionId = "versions-edit-question";
  const filePath = await writeSession(client, sessionId, [
    userEntry("q1", null, 1, "Where do the tests of this project live?"),
    assistantEntry("a1", "q1", 2, [textBlock("The tests live in the tests directory.")]),
    userEntry("q2", "a1", 3, "What does a new session copy from this conversation?"),
    assistantEntry("a2", "q2", 4, [textBlock("It copies the conversation up to the chosen answer.")]),
  ]);
  await openLive(client, sessionId);
  const events = eventsOf(client, sessionId);
  t.after(() => events.off());
  const finished = events.next(ended);
  const answer = await client.call("agent.command", {
    sessionId,
    command: { type: "edit_message", entryId: "q2", message: "Which files does a new session copy?" },
  });
  assert.equal(answer.cancelled, false, "the edit is accepted");
  await finished;
  const messages = await conversationOf(client, sessionId);
  assert.deepEqual(shownConversation(messages), [
    ["user", "Where do the tests of this project live?"],
    ["assistant", "The tests live in the tests directory."],
    ["user", "Which files does a new session copy?"],
    ["assistant", "Fixture reply."],
  ]);
  const edited = messages[2].versions;
  assert.equal(edited?.entryIds?.length, 2, "the edited question reports two versions");
  assert.equal(edited?.entryIds?.[0], "q2", "the version that was edited is the older one");
  assert.equal(edited?.index, 1, "the edited question is the one shown");
  const ids = idsInFile(filePath);
  assert.ok(ids.includes("q2"), "the question that was replaced is still in the session file");
  assert.ok(ids.includes("a2"), "the answer that was replaced is still in the session file");
});

test("when a reader edits the first question, the conversation starts at the new version and reports both", async (t) => {
  const sessionId = "versions-edit-first-question";
  await writeSession(client, sessionId, [
    userEntry("q1", null, 1, "Where do the tests of this project live?"),
    assistantEntry("a1", "q1", 2, [textBlock("The tests live in the tests directory.")]),
  ]);
  await openLive(client, sessionId);
  const events = eventsOf(client, sessionId);
  t.after(() => events.off());
  const finished = events.next(ended);
  const answer = await client.call("agent.command", {
    sessionId,
    command: { type: "edit_message", entryId: "q1", message: "Where do the fixtures of this project live?" },
  });
  assert.equal(answer.cancelled, false, "the first question can be edited too");
  await finished;
  const messages = await conversationOf(client, sessionId);
  assert.deepEqual(shownConversation(messages), [
    ["user", "Where do the fixtures of this project live?"],
    ["assistant", "Fixture reply."],
  ]);
  const edited = messages[0].versions;
  assert.equal(edited?.entryIds?.length, 2, "the first question reports two versions");
  assert.equal(edited?.entryIds?.[0], "q1", "the version that was edited is the older one");
  assert.equal(edited?.index, 1, "the edited question is the one shown");
});

test("when a reader edits a question and keeps its image, the new version stores the image", async (t) => {
  const sessionId = "versions-edit-with-image";
  await writeSession(client, sessionId, [
    userEntry("q1", null, 1, "Where do the tests of this project live?"),
    assistantEntry("a1", "q1", 2, [textBlock("The tests live in the tests directory.")]),
    userEntry("q2", "a1", 3, "What does a new session copy from this conversation?"),
    assistantEntry("a2", "q2", 4, [textBlock("It copies the conversation up to the chosen answer.")]),
  ]);
  await openLive(client, sessionId);
  const events = eventsOf(client, sessionId);
  t.after(() => events.off());
  const finished = events.next(ended);
  const answer = await client.call("agent.command", {
    sessionId,
    command: {
      type: "edit_message",
      entryId: "q2",
      message: "What does this screenshot of a new session show?",
      images: [{ type: "image", data: PNG_DATA, mimeType: "image/png" }],
    },
  });
  assert.equal(answer.cancelled, false, "an edit that keeps an image is accepted");
  await finished;
  const messages = await conversationOf(client, sessionId);
  const edited = messages[2];
  assert.equal(textOf(edited), "What does this screenshot of a new session show?");
  const images = (edited.content ?? []).filter((part) => part.type === "image");
  assert.equal(images.length, 1, "the new version stores the kept image");
  assert.equal(images[0].data, PNG_DATA, "the stored image is the one the reader kept");
  assert.equal(images[0].mimeType, "image/png", "the stored image keeps its type");
});

test("when the reader switches back to the older version, the conversation shows the older question and answer", async (t) => {
  const sessionId = "versions-switch-back";
  await writeSession(client, sessionId, [
    userEntry("q1", null, 1, "Where do the tests of this project live?"),
    assistantEntry("a1", "q1", 2, [textBlock("The tests live in the tests directory.")]),
    userEntry("q2", "a1", 3, "What does a new session copy from this conversation?"),
    assistantEntry("a2", "q2", 4, [textBlock("It copies the conversation up to the chosen answer.")]),
    userEntry("q2b", "a1", 5, "Which files does a new session copy?"),
    assistantEntry("a2b", "q2b", 6, [textBlock("It copies the files of the chosen answer.")]),
  ]);
  await openLive(client, sessionId);
  const events = eventsOf(client, sessionId);
  t.after(() => events.off());
  const finished = events.next(ended);
  await client.call("agent.command", {
    sessionId,
    command: { type: "edit_message", entryId: "q2", message: "Which files does a new session copy?" },
  });
  await finished;
  const switched = await client.call("agent.command", {
    sessionId,
    command: { type: "switch_version", entryId: "q2" },
  });
  assert.equal(switched.cancelled, false, "the switch is accepted");
  assert.equal(switched.leafId, "a2", "the conversation stands at the ending of the older version");
  const messages = await conversationOf(client, sessionId);
  assert.deepEqual(shownConversation(messages), [
    ["user", "Where do the tests of this project live?"],
    ["assistant", "The tests live in the tests directory."],
    ["user", "What does a new session copy from this conversation?"],
    ["assistant", "It copies the conversation up to the chosen answer."],
  ]);
  assert.equal(messages[2].versions?.index, 0, "the older question reports itself as the first version");
  assert.deepEqual(
    messages[2].versions?.entryIds?.slice(0, 2),
    ["q2", "q2b"],
    "the two versions that existed before the edit are still listed first",
  );
  assert.equal(
    messages[2].versions?.entryIds?.length,
    3,
    "the edit joined the two versions that were already there instead of replacing them",
  );
});

test("when the reader switches to a version with two later branches, the newest branch is shown", async () => {
  const sessionId = "versions-newest-branch";
  await writeSession(client, sessionId, [
    userEntry("q1", null, 1, "Where do the tests of this project live?"),
    assistantEntry("a1", "q1", 2, [textBlock("The tests live in the tests directory.")]),
    userEntry("q2", "a1", 3, "What does a new session copy from this conversation?"),
    assistantEntry("a2", "q2", 4, [textBlock("It copies the conversation up to the chosen answer.")]),
    userEntry("q3old", "a2", 5, "Which files does a new session copy?"),
    assistantEntry("a3old", "q3old", 6, [textBlock("It copies the files of the chosen answer.")]),
    userEntry("q3new", "a2", 9, "Which files does a new session keep?"),
    assistantEntry("a3new", "q3new", 10, [textBlock("It keeps the files of the chosen answer.")]),
    userEntry("q2b", "a1", 11, "Which branch does the conversation show?"),
    assistantEntry("a2b", "q2b", 12, [textBlock("It shows the newest branch.")]),
  ]);
  await openLive(client, sessionId);
  const switched = await client.call("agent.command", {
    sessionId,
    command: { type: "switch_version", entryId: "q2" },
  });
  assert.equal(switched.cancelled, false, "the switch is accepted");
  assert.equal(switched.leafId, "a3new", "the conversation stands at the newest ending under the chosen version");
  const messages = await conversationOf(client, sessionId);
  assert.deepEqual(shownConversation(messages), [
    ["user", "Where do the tests of this project live?"],
    ["assistant", "The tests live in the tests directory."],
    ["user", "What does a new session copy from this conversation?"],
    ["assistant", "It copies the conversation up to the chosen answer."],
    ["user", "Which files does a new session keep?"],
    ["assistant", "It keeps the files of the chosen answer."],
  ]);
});

test("when the newest ending of a version is a question without a reply, that question stays visible at the end", async () => {
  const sessionId = "versions-dangling-question";
  await writeSession(client, sessionId, [
    userEntry("q1", null, 1, "Where do the tests of this project live?"),
    assistantEntry("a1", "q1", 2, [textBlock("The tests live in the tests directory.")]),
    userEntry("q2", "a1", 3, "What does a new session copy from this conversation?"),
    assistantEntry("a2", "q2", 4, [textBlock("It copies the conversation up to the chosen answer.")]),
    userEntry("q3dangling", "a2", 5, "Which files does a new session copy?"),
    userEntry("q2b", "a1", 6, "Which branch does the conversation show?"),
    assistantEntry("a2b", "q2b", 7, [textBlock("It shows the newest branch.")]),
  ]);
  await openLive(client, sessionId);
  const switched = await client.call("agent.command", {
    sessionId,
    command: { type: "switch_version", entryId: "q2" },
  });
  assert.equal(switched.cancelled, false, "the switch is accepted");
  assert.equal(switched.leafId, "q3dangling", "the conversation stands on the question that has no reply");
  const messages = await conversationOf(client, sessionId);
  assert.deepEqual(shownConversation(messages), [
    ["user", "Where do the tests of this project live?"],
    ["assistant", "The tests live in the tests directory."],
    ["user", "What does a new session copy from this conversation?"],
    ["assistant", "It copies the conversation up to the chosen answer."],
    ["user", "Which files does a new session copy?"],
  ]);
});

test("when the reader continues from an older version, the new turn follows the older answer and both versions remain", async (t) => {
  const sessionId = "versions-continue-on-old";
  await writeSession(client, sessionId, [
    userEntry("q1", null, 1, "Where do the tests of this project live?"),
    assistantEntry("a1", "q1", 2, [textBlock("The tests live in the tests directory.")]),
    userEntry("q2", "a1", 3, "What does a new session copy from this conversation?"),
    assistantEntry("a2", "q2", 4, [textBlock("It copies the conversation up to the chosen answer.")]),
    userEntry("q2b", "a1", 5, "Which files does a new session copy?"),
    assistantEntry("a2b", "q2b", 6, [textBlock("It copies the files of the chosen answer.")]),
  ]);
  await openLive(client, sessionId);
  const events = eventsOf(client, sessionId);
  t.after(() => events.off());
  const switched = await client.call("agent.command", {
    sessionId,
    command: { type: "switch_version", entryId: "q2" },
  });
  assert.equal(switched.cancelled, false, "the switch is accepted");
  const finished = events.next(ended);
  await client.call("agent.command", { sessionId, command: { type: "prompt", message: "Please continue here." } });
  await finished;
  const messages = await conversationOf(client, sessionId);
  assert.deepEqual(shownConversation(messages), [
    ["user", "Where do the tests of this project live?"],
    ["assistant", "The tests live in the tests directory."],
    ["user", "What does a new session copy from this conversation?"],
    ["assistant", "It copies the conversation up to the chosen answer."],
    ["user", "Please continue here."],
    ["assistant", "Fixture reply."],
  ]);
  assert.equal(messages[2].versions?.entryIds?.length, 2, "the other version is still listed after the new turn");
});

test("when the reader leaves a version that changed files, the host reports the file changes of that version remain", async () => {
  const sessionId = "versions-left-version-files";
  await writeSession(client, sessionId, [
    userEntry("q1", null, 1, "Where do the tests of this project live?"),
    assistantEntry("a1", "q1", 2, [textBlock("The tests live in the tests directory.")]),
    userEntry("q2", "a1", 3, "Rename the button label."),
    assistantEntry("a2", "q2", 4, [
      textBlock("I renamed the button label."),
      { type: "toolCall", id: "call-edit-1", name: "edit", arguments: { path: "src/app.ts" } },
    ]),
    userEntry("q2b", "a1", 5, "Show me the button label."),
    assistantEntry("a2b", "q2b", 6, [
      textBlock("The button label is unchanged."),
      { type: "toolCall", id: "call-read-1", name: "read", arguments: { path: "src/app.ts" } },
    ]),
  ]);
  await openLive(client, sessionId);
  const leftReadOnly = await client.call("agent.command", {
    sessionId,
    command: { type: "switch_version", entryId: "q2" },
  });
  assert.equal(leftReadOnly.cancelled, false, "the switch is accepted");
  assert.equal(
    leftReadOnly.leftVersionChangedFiles,
    false,
    "the version that was left only read files, so nothing has to be reported",
  );
  const leftEdited = await client.call("agent.command", {
    sessionId,
    command: { type: "switch_version", entryId: "q2b" },
  });
  assert.equal(leftEdited.cancelled, false, "the second switch is accepted");
  assert.equal(
    leftEdited.leftVersionChangedFiles,
    true,
    "the version that was left edited a file, so the reader has to be told it was not undone",
  );
});

test("while a reply is still being written, editing and switching are refused and the conversation stays where it is", async (t) => {
  const sessionId = "versions-refused-while-running";
  const firstQuestion = "Which files hold the version fixtures? (refusal check)";
  await writeSession(client, sessionId, [
    userEntry("q1", null, 1, firstQuestion),
    assistantEntry("a1", "q1", 2, [textBlock("They live in the tests directory.")]),
    userEntry("q2", "a1", 3, "What does a new session copy from this conversation?"),
    assistantEntry("a2", "q2", 4, [textBlock("It copies the conversation up to the chosen answer.")]),
    userEntry("q2b", "a1", 5, "Which files does a new session copy?"),
    assistantEntry("a2b", "q2b", 6, [textBlock("It copies the files of the chosen answer.")]),
  ]);
  await openLive(client, sessionId);
  const idleSwitch = await client.call("agent.command", {
    sessionId,
    command: { type: "switch_version", entryId: "q2" },
  });
  assert.equal(idleSwitch.cancelled, false, "a switch is accepted while nothing is running");

  const held = model.hold(firstQuestion, { partial: "Reading the", rest: " fixtures now." });
  t.after(() => held.release());
  const events = eventsOf(client, sessionId);
  t.after(() => events.off());
  const finished = events.next(ended);
  await client.call("agent.command", { sessionId, command: { type: "prompt", message: "Please continue here." } });
  await held.partialSent();

  await assert.rejects(
    client.call("agent.command", {
      sessionId,
      command: { type: "edit_message", entryId: "q2", message: "Which files does a new session copy?" },
    }),
    "editing a question is refused while a reply is being written",
  );
  await assert.rejects(
    client.call("agent.command", { sessionId, command: { type: "switch_version", entryId: "q2b" } }),
    "switching versions is refused while a reply is being written",
  );

  held.release();
  await finished;
  const messages = await conversationOf(client, sessionId);
  assert.deepEqual(shownConversation(messages), [
    ["user", firstQuestion],
    ["assistant", "They live in the tests directory."],
    ["user", "What does a new session copy from this conversation?"],
    ["assistant", "It copies the conversation up to the chosen answer."],
    ["user", "Please continue here."],
    ["assistant", "Reading the fixtures now."],
  ]);
  assert.equal(messages[2].versions?.entryIds?.length, 2, "the refused edit added no third version to the question");
});

test("switching versions does not rewrite the session file", async () => {
  const sessionId = "versions-file-untouched";
  const filePath = await writeSession(client, sessionId, [
    userEntry("q1", null, 1, "Where do the tests of this project live?"),
    assistantEntry("a1", "q1", 2, [textBlock("The tests live in the tests directory.")]),
    userEntry("q2", "a1", 3, "What does a new session copy from this conversation?"),
    assistantEntry("a2", "q2", 4, [textBlock("It copies the conversation up to the chosen answer.")]),
    userEntry("q2b", "a1", 5, "Which files does a new session copy?"),
    assistantEntry("a2b", "q2b", 6, [textBlock("It copies the files of the chosen answer.")]),
  ]);
  await openLive(client, sessionId);
  const before = digestOf(filePath);
  const switched = await client.call("agent.command", {
    sessionId,
    command: { type: "switch_version", entryId: "q2" },
  });
  assert.equal(switched.cancelled, false, "the switch is accepted");
  assert.equal(digestOf(filePath), before, "choosing a version writes nothing into the session file");
});

test("after a restart, the conversation reopens on the version the reader chose and continues from it", async (t) => {
  const sessionId = "versions-restart-choice";
  await writeSession(client, sessionId, [
    userEntry("q1", null, 1, "Where do the tests of this project live?"),
    assistantEntry("a1", "q1", 2, [textBlock("The tests live in the tests directory.")]),
    userEntry("q2", "a1", 3, "What does a new session copy from this conversation?"),
    assistantEntry("a2", "q2", 4, [textBlock("It copies the conversation up to the chosen answer.")]),
    userEntry("q2b", "a1", 5, "Which files does a new session copy?"),
    assistantEntry("a2b", "q2b", 6, [textBlock("It copies the files of the chosen answer.")]),
  ]);
  await openLive(client, sessionId);
  const switched = await client.call("agent.command", {
    sessionId,
    command: { type: "switch_version", entryId: "q2" },
  });
  assert.equal(switched.cancelled, false, "the switch is accepted");
  await closeFirstHost();

  const restarted = await startSecondHost("session-message-versions-restarted");
  t.after(() => restarted.close());
  const reopened = await conversationOf(restarted.client, sessionId);
  assert.deepEqual(
    shownConversation(reopened),
    [
      ["user", "Where do the tests of this project live?"],
      ["assistant", "The tests live in the tests directory."],
      ["user", "What does a new session copy from this conversation?"],
      ["assistant", "It copies the conversation up to the chosen answer."],
    ],
    "the conversation reopens on the version the reader chose, not on the record written last",
  );
  const events = eventsOf(restarted.client, sessionId);
  t.after(() => events.off());
  const finished = events.next(ended);
  await restarted.client.call("agent.command", {
    sessionId,
    command: { type: "prompt", message: "Please continue here." },
  });
  await finished;
  const continued = await conversationOf(restarted.client, sessionId);
  assert.deepEqual(shownConversation(continued), [
    ["user", "Where do the tests of this project live?"],
    ["assistant", "The tests live in the tests directory."],
    ["user", "What does a new session copy from this conversation?"],
    ["assistant", "It copies the conversation up to the chosen answer."],
    ["user", "Please continue here."],
    ["assistant", "Fixture reply."],
  ]);
});

test("after a restart, a record written later by another program wins over the chosen version", async (t) => {
  const sessionId = "versions-restart-newer-record";
  const before = await startSecondHost("session-message-versions-before-later-record");
  t.after(() => before.close());
  const filePath = await writeSession(before.client, sessionId, [
    userEntry("q1", null, 1, "Where do the tests of this project live?"),
    assistantEntry("a1", "q1", 2, [textBlock("The tests live in the tests directory.")]),
    userEntry("q2", "a1", 3, "What does a new session copy from this conversation?"),
    assistantEntry("a2", "q2", 4, [textBlock("It copies the conversation up to the chosen answer.")]),
    userEntry("q2b", "a1", 5, "Which files does a new session copy?"),
    assistantEntry("a2b", "q2b", 6, [textBlock("It copies the files of the chosen answer.")]),
  ]);
  await openLive(before.client, sessionId);
  const switched = await before.client.call("agent.command", {
    sessionId,
    command: { type: "switch_version", entryId: "q2" },
  });
  assert.equal(switched.cancelled, false, "the switch is accepted");
  await before.close();

  const appended = [
    userEntry("q4", "a2b", 20, "I continued this conversation in the terminal."),
    assistantEntry("a4", "q4", 21, [textBlock("The terminal turn is the newest record.")]),
  ];
  writeFileSync(
    filePath,
    `${readFileSync(filePath, "utf8")}${appended.map((entry) => JSON.stringify(entry)).join("\n")}\n`,
    "utf8",
  );

  const restarted = await startSecondHost("session-message-versions-later-record");
  t.after(() => restarted.close());
  const reopened = await conversationOf(restarted.client, sessionId);
  assert.deepEqual(shownConversation(reopened), [
    ["user", "Where do the tests of this project live?"],
    ["assistant", "The tests live in the tests directory."],
    ["user", "Which files does a new session copy?"],
    ["assistant", "It copies the files of the chosen answer."],
    ["user", "I continued this conversation in the terminal."],
    ["assistant", "The terminal turn is the newest record."],
  ]);
});
