import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  createAgentSessionFromServices,
  createAgentSessionServices,
  SessionManager,
} from "@earendil-works/pi-coding-agent";
import { fauxAssistantMessage, fauxProvider, fauxText } from "@earendil-works/pi-ai";
import { importTestBundle } from "#test-bundle";

const { AgentSessionWrapper, RunPolicy, buildSessionContext, projectDisplayMessages, entryToUiMessage } =
  await importTestBundle("automation-prompt-context", {
    packages: "external",
    tsconfig: "tsconfig.renderer.json",
    stdin: {
      contents: `export { AgentSessionWrapper } from "./src/agent-host/rpc-manager";
      export { RunPolicy } from "./src/agent-host/agent-session/run-policy";
      export { buildSessionContext, entryToUiMessage } from "./src/agent-host/session-reader";
      export { projectDisplayMessages } from "./src/agent-host/session-display-projection";`,
      resolveDir: process.cwd(),
      loader: "ts",
    },
  });

const badge = { mode: "modify", taskId: "daily-digest", taskName: "Daily digest", revision: 3 };
const payload = { badge, hiddenContext: "Private task configuration" };
const prefixed = (context, text) => `<automation_context>\n${context}\n</automation_context>\n\n${text}`;
const messageText = (message) =>
  typeof message.content === "string"
    ? message.content
    : message.content
        .filter((block) => block.type === "text")
        .map((block) => block.text)
        .join("");

async function openSession(t, extensions = []) {
  const base = await mkdtemp(path.join(tmpdir(), "dexon-automation-prompt-"));
  t.after(() => rm(base, { recursive: true, force: true }));
  const cwd = path.join(base, "project");
  const agentDir = path.join(base, "agent");
  const sessionDir = path.join(base, "sessions");
  await Promise.all([cwd, agentDir, sessionDir].map((directory) => mkdir(directory)));
  const bridge = {};
  const services = await createAgentSessionServices({
    cwd,
    agentDir,
    resourceLoaderOptions: {
      noSkills: true,
      noPromptTemplates: true,
      noThemes: true,
      noContextFiles: true,
      extensionFactories: [RunPolicy.extension(() => bridge.wrapper?.runPolicy), ...extensions],
    },
  });
  const faux = fauxProvider();
  services.modelRuntime.registerNativeProvider(faux.provider);
  const manager = SessionManager.create(cwd, sessionDir);
  const { session } = await createAgentSessionFromServices({
    services,
    sessionManager: manager,
    model: faux.getModel(),
  });
  const wrapper = new AgentSessionWrapper(session, { intents: new Map() });
  bridge.wrapper = wrapper;
  await session.bindExtensions({ mode: "rpc" });
  wrapper.start();
  t.after(() => wrapper.dispose({ abort: false, reason: "test" }));
  const events = [];
  wrapper.onEvent((event) => events.push(event));
  const requests = [];
  const respond = (callback) => {
    faux.setResponses([
      (context) => {
        requests.push(structuredClone(context.messages));
        return callback?.(context) ?? fauxAssistantMessage([fauxText("ok")]);
      },
    ]);
  };
  const ask = async (message, automationPrompt) => {
    respond();
    const done = Promise.withResolvers();
    const unsubscribe = wrapper.onEvent((event) => {
      if (event.type === "prompt_done") done.resolve();
      if (event.type === "prompt_error") done.reject(new Error(String(event.errorMessage)));
    });
    try {
      await wrapper.send({ type: "prompt", message, ...(automationPrompt ? { automationPrompt } : {}) });
      await done.promise;
    } finally {
      unsubscribe();
    }
    return requests.at(-1);
  };
  return { manager, session, wrapper, events, requests, ask, respond, faux };
}

test("automation prompts keep the stored question clean and expose only a badge live and after reload", async (t) => {
  const { manager, events, ask } = await openSession(t);
  const sent = await ask("Change the schedule", payload);
  const markers = manager
    .getBranch()
    .filter((entry) => entry.type === "custom" && entry.customType === "dexon.automation_prompt");
  assert.deepEqual(
    markers.map((entry) => entry.data),
    [payload],
  );
  assert.equal(
    messageText(sent.find((message) => message.role === "user")),
    prefixed(payload.hiddenContext, "Change the schedule"),
  );
  const live = events.filter(
    (event) => ["message_start", "message_end"].includes(event.type) && event.message?.role === "user",
  );
  assert.equal(live.length, 2);
  for (const event of live) {
    assert.equal(messageText(event.message), "Change the schedule");
    assert.deepEqual(event.message.automationPrompt, badge);
    assert.ok(!JSON.stringify(event).includes(payload.hiddenContext));
  }
  const disk = await readFile(manager.getSessionFile(), "utf8");
  const entries = disk
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line))
    .filter((entry) => entry.type !== "session");
  const stored = entries.find((entry) => entry.type === "message" && entry.message.role === "user");
  assert.equal(messageText(stored.message), "Change the schedule");
  assert.ok(!JSON.stringify(stored).includes(payload.hiddenContext));
  for (const messages of [
    buildSessionContext(entries).messages,
    projectDisplayMessages(entries).map((item) => item.message),
  ]) {
    assert.deepEqual(messages.find((message) => message.role === "user").automationPrompt, badge);
    assert.ok(!JSON.stringify(messages).includes(payload.hiddenContext));
  }
  assert.equal(entryToUiMessage(markers[0]), null);
  assert.ok(!JSON.stringify(events).includes(payload.hiddenContext));
});

function captureContextHook() {
  let hook;
  RunPolicy.extension(() => undefined).factory({
    on: (name, handler) => {
      if (name === "context") hook = handler;
    },
  });
  return hook;
}

test("historical automation context is request-local, repeatable, and never transfers to the next turn", async (t) => {
  const { session, manager, ask } = await openSession(t);
  await ask("Change the schedule", payload);
  const next = await ask("Explain the result");
  assert.deepEqual(next.filter((message) => message.role === "user").map(messageText), [
    prefixed(payload.hiddenContext, "Change the schedule"),
    "Explain the result",
  ]);
  assert.deepEqual(session.agent.state.messages.filter((message) => message.role === "user").map(messageText), [
    "Change the schedule",
    "Explain the result",
  ]);
  const hook = captureContextHook();
  const original = structuredClone(manager.buildSessionProjection().messages);
  const once = hook({ messages: original }, { sessionManager: manager }).messages;
  const twice = hook({ messages: once }, { sessionManager: manager }).messages;
  assert.deepEqual(twice, once);
  assert.equal(messageText(original.find((message) => message.role === "user")), "Change the schedule");
});

test("duplicate timestamps, compaction, context edits and branch changes retain the right user pairing", () => {
  const manager = SessionManager.inMemory();
  const add = (content) => manager.appendMessage({ role: "user", content, timestamp: 42 });
  manager.appendCustomEntry("dexon.automation_prompt", payload);
  const abandoned = add("same");
  const plain = add("same");
  const other = { badge: { mode: "adjust" }, hiddenContext: "Different context" };
  manager.appendCustomEntry("dexon.automation_prompt", other);
  const kept = add("same");
  const hook = captureContextHook();
  const apply = () =>
    hook({ messages: manager.buildSessionProjection().messages }, { sessionManager: manager }).messages;
  assert.deepEqual(
    apply()
      .filter((message) => message.role === "user")
      .map(messageText),
    [prefixed(payload.hiddenContext, "same"), "same", prefixed(other.hiddenContext, "same")],
  );
  manager.appendCompaction("summary", plain, 100);
  assert.deepEqual(
    apply()
      .filter((message) => message.role === "user")
      .map(messageText),
    ["same", prefixed(other.hiddenContext, "same")],
  );
  manager.appendContextEdit(kept, { content: "replacement" });
  assert.deepEqual(
    apply()
      .filter((message) => message.role === "user")
      .map(messageText),
    ["same", prefixed(other.hiddenContext, "replacement")],
  );
  manager.appendContextEdit(kept, null);
  assert.deepEqual(
    apply()
      .filter((message) => message.role === "user")
      .map(messageText),
    ["same"],
  );
  manager.branch(abandoned);
  add("new branch");
  assert.deepEqual(
    apply()
      .filter((message) => message.role === "user")
      .map(messageText),
    [prefixed(payload.hiddenContext, "same"), "new branch"],
  );
});

test("queued automation prompts follow their own delivery order even beside identical plain prompts", async (t) => {
  const { session, wrapper, events, manager, faux } = await openSession(t);
  const entered = Promise.withResolvers();
  const release = Promise.withResolvers();
  const requests = [];
  const reply = (context) => {
    requests.push(structuredClone(context.messages));
    return fauxAssistantMessage([fauxText("ok")]);
  };
  faux.setResponses([
    async (context) => {
      entered.resolve();
      await release.promise;
      return reply(context);
    },
    reply,
    reply,
    reply,
  ]);
  await wrapper.send({ type: "prompt", message: "initial" });
  await entered.promise;
  const followUp = { badge: { mode: "modify", taskId: "follow" }, hiddenContext: "Follow-up context" };
  const steer = { badge: { mode: "adjust", taskId: "steer" }, hiddenContext: "Steering context" };
  await wrapper.send({ type: "prompt", message: "same", streamingBehavior: "followUp", automationPrompt: followUp });
  await wrapper.send({ type: "prompt", message: "same", streamingBehavior: "steer" });
  await wrapper.send({ type: "prompt", message: "same", streamingBehavior: "steer", automationPrompt: steer });
  release.resolve();
  await session.waitForIdle();
  const sentUsers = requests.at(-1).filter((message) => message.role === "user");
  const firstAssistantEnd = events.findIndex(
    (event) => event.type === "message_end" && event.message?.role === "assistant",
  );
  const followUpStart = events.findIndex(
    (event) => event.type === "message_start" && event.message?.automationPrompt?.taskId === "follow",
  );
  assert.ok(firstAssistantEnd >= 0 && followUpStart > firstAssistantEnd);
  assert.deepEqual(sentUsers.map(messageText), [
    "initial",
    "same",
    prefixed(steer.hiddenContext, "same"),
    prefixed(followUp.hiddenContext, "same"),
  ]);
  const live = events
    .filter((event) => event.type === "message_end" && event.message?.role === "user")
    .map((event) => event.message);
  assert.deepEqual(
    live.map((message) => message.automationPrompt),
    [undefined, undefined, steer.badge, followUp.badge],
  );
  const reloaded = buildSessionContext(manager.getEntries()).messages.filter((message) => message.role === "user");
  assert.deepEqual(
    reloaded.map((message) => message.automationPrompt),
    [undefined, undefined, steer.badge, followUp.badge],
  );
  assert.deepEqual(reloaded.map(messageText), ["initial", "same", "same", "same"]);
});

test("hidden context remains verbatim when ordinary prompt cleanup and repeated hooks run", () => {
  const manager = SessionManager.inMemory();
  const hiddenContext =
    '<quotes>\n<quote id="1" from="assistant" entry="private-entry" pre="before" suf="after">\nprivate\n</quote>\n</quotes>';
  manager.appendCustomEntry("dexon.automation_prompt", { badge: { mode: "draft" }, hiddenContext });
  const rawQuestion =
    '<quotes>\n<quote id="1" from="assistant" entry="ui-only">\nquoted\n</quote>\n</quotes>\n\nquestion';
  const modelQuestion = '<quotes>\n<quote id="1" from="assistant">\nquoted\n</quote>\n</quotes>\n\nquestion';
  manager.appendMessage({ role: "user", content: rawQuestion, timestamp: 1 });
  const hook = captureContextHook();
  const original = manager.buildSessionProjection().messages;
  const first = hook({ messages: original }, { sessionManager: manager }).messages;
  const second = hook({ messages: first }, { sessionManager: manager }).messages;
  assert.equal(messageText(first[0]), prefixed(hiddenContext, modelQuestion));
  assert.deepEqual(second, first);
});

test("a handled prompt leaves no automation context for a subsequent ordinary question", async (t) => {
  const { ask, manager } = await openSession(t, [
    (pi) => {
      pi.on("input", (event) => (event.text === "handled" ? { action: "handled" } : undefined));
    },
  ]);
  await ask("handled", payload);
  const sent = await ask("ordinary question");
  assert.equal(messageText(sent.find((message) => message.role === "user")), "ordinary question");
  const reloaded = buildSessionContext(manager.getEntries()).messages.find((message) => message.role === "user");
  assert.equal(reloaded.automationPrompt, undefined);
});

test("clearing queued automation prompts prevents their badge and context from reaching a later question", async (t) => {
  const { session, wrapper, manager, faux, ask } = await openSession(t);
  const firstDone = Promise.withResolvers();
  const stopWatching = wrapper.onEvent((event) => {
    if (event.type === "prompt_done") firstDone.resolve();
  });
  const entered = Promise.withResolvers();
  const release = Promise.withResolvers();
  faux.setResponses([
    async () => {
      entered.resolve();
      await release.promise;
      return fauxAssistantMessage([fauxText("ok")]);
    },
  ]);
  await wrapper.send({ type: "prompt", message: "initial" });
  await entered.promise;
  const queued = Promise.withResolvers();
  const unsubscribe = wrapper.onEvent((event) => {
    if (event.type === "queue_update" && event.followUp?.includes("cancelled")) queued.resolve();
  });
  try {
    await wrapper.send({
      type: "prompt",
      message: "cancelled",
      streamingBehavior: "followUp",
      automationPrompt: payload,
    });
    await queued.promise;
    assert.deepEqual(await wrapper.send({ type: "clear_queue" }), { steering: [], followUp: ["cancelled"] });
  } finally {
    unsubscribe();
    release.resolve();
  }
  await session.waitForIdle();
  await firstDone.promise;
  stopWatching();
  const sent = await ask("ordinary question");
  assert.deepEqual(sent.filter((message) => message.role === "user").map(messageText), [
    "initial",
    "ordinary question",
  ]);
  assert.ok(buildSessionContext(manager.getEntries()).messages.every((message) => !message.automationPrompt));
});

test("display projections derive sanitized badges only from markers and never trust embedded prompt payloads", () => {
  const manager = SessionManager.inMemory();
  manager.appendCustomEntry("dexon.automation_prompt", {
    badge: { mode: "modify", taskName: "Daily digest", hiddenContext: "badge secret", revision: -1 },
    hiddenContext: "marker secret",
    extra: "ignored",
  });
  manager.appendMessage({ role: "user", content: "first", timestamp: 1, automationPrompt: payload });
  manager.appendMessage({ role: "user", content: "second", timestamp: 2, automationPrompt: payload });
  const entries = manager.getEntries();
  for (const messages of [
    buildSessionContext(entries).messages,
    projectDisplayMessages(entries).map((item) => item.message),
  ]) {
    assert.deepEqual(messages[0].automationPrompt, { mode: "modify", taskName: "Daily digest" });
    assert.equal(messages[1].automationPrompt, undefined);
    assert.ok(!JSON.stringify(messages).includes("hiddenContext"));
    assert.ok(!JSON.stringify(messages).includes("secret"));
  }
  const entryProjection = entries.map(entryToUiMessage).filter(Boolean);
  assert.ok(!JSON.stringify(entryProjection).includes("hiddenContext"));
  assert.ok(!JSON.stringify(entryProjection).includes(payload.hiddenContext));
  assert.ok(!JSON.stringify(entryProjection).includes("secret"));
});

test("request-only prefixing preserves image blocks and literal automation wrappers in the stored text", () => {
  const manager = SessionManager.inMemory();
  const image = { type: "image", data: "aGVsbG8=", mimeType: "image/png" };
  const literal = prefixed(payload.hiddenContext, "literal user text");
  const contents = [literal, [{ type: "text", text: "with image" }, image], [image]];
  contents.forEach((content, index) => {
    manager.appendCustomEntry("dexon.automation_prompt", payload);
    manager.appendMessage({ role: "user", content, timestamp: index });
  });
  const before = structuredClone(manager.getEntries());
  const hook = captureContextHook();
  const first = hook({ messages: manager.buildSessionProjection().messages }, { sessionManager: manager }).messages;
  const second = hook({ messages: first }, { sessionManager: manager }).messages;
  assert.equal(first[0].content, prefixed(payload.hiddenContext, literal));
  assert.deepEqual(first[1].content, [{ type: "text", text: prefixed(payload.hiddenContext, "with image") }, image]);
  assert.deepEqual(first[2].content, [{ type: "text", text: prefixed(payload.hiddenContext, "") }, image]);
  assert.deepEqual(second, first);
  assert.deepEqual(manager.getEntries(), before);
});

test("a handled ordinary steering command cannot consume the next automation prompt's queue marker", async (t) => {
  const { session, wrapper, faux } = await openSession(t, [
    (pi) => {
      pi.on("input", (event) => (event.text === "handled" ? { action: "handled" } : undefined));
    },
  ]);
  const entered = Promise.withResolvers();
  const release = Promise.withResolvers();
  const requests = [];
  const reply = (context) => {
    requests.push(structuredClone(context.messages));
    return fauxAssistantMessage([fauxText("ok")]);
  };
  faux.setResponses([
    async (context) => {
      entered.resolve();
      await release.promise;
      return reply(context);
    },
    reply,
  ]);
  await wrapper.send({ type: "prompt", message: "initial" });
  await entered.promise;
  const queued = Promise.withResolvers();
  const unsubscribe = wrapper.onEvent((event) => {
    if (event.type === "queue_update" && event.followUp?.includes("same")) queued.resolve();
  });
  try {
    await wrapper.send({ type: "steer", message: "handled" });
    await wrapper.send({ type: "prompt", message: "same", streamingBehavior: "followUp", automationPrompt: payload });
    await queued.promise;
  } finally {
    unsubscribe();
    release.resolve();
  }
  await session.waitForIdle();
  assert.deepEqual(
    requests
      .at(-1)
      .filter((message) => message.role === "user")
      .map(messageText),
    ["initial", prefixed(payload.hiddenContext, "same")],
  );
});
