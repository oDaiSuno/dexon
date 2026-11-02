import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { installManagedProcessSessionRedaction, redactManagedProcessPersistedMessage } from "./session-redaction.ts";

function createSession(t) {
  const directory = mkdtempSync(join(tmpdir(), "dexon-pi140-redaction-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return SessionManager.create(directory, directory);
}

function processMessages() {
  return ["process_start", "process_wait"].flatMap((toolName, index) => [
    {
      role: "assistant",
      content: [
        {
          type: "toolCall",
          id: `call-${index}`,
          name: toolName,
          arguments:
            toolName === "process_start"
              ? { command: "SECRET_COMMAND", cwd: "/SECRET_CWD", label: "frontend" }
              : { processId: "proc-a", runId: "run-a", contains: "SECRET_READY" },
        },
      ],
      api: "openai-responses",
      provider: "openai",
      model: "gpt-4o",
      usage: {
        input: 1,
        output: 1,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 2,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
      stopReason: "toolUse",
      timestamp: index * 2 + 1,
    },
    {
      role: "toolResult",
      toolCallId: `call-${index}`,
      toolName,
      content: [{ type: "text", text: `SECRET_${toolName}_OUTPUT` }],
      details: { output: `SECRET_${toolName}_DETAIL` },
      isError: false,
      timestamp: index * 2 + 2,
    },
  ]);
}

function assertRedacted(messages) {
  assert.deepEqual(messages[0].content[0].arguments, {
    command: "[redacted managed process command]",
    cwd: "[redacted managed process cwd]",
    label: "frontend",
  });
  assert.deepEqual(messages[2].content[0].arguments, {
    processId: "proc-a",
    runId: "run-a",
    contains: "[redacted readiness text]",
  });
  for (const result of [messages[1], messages[3]]) {
    assert.deepEqual(result.content, [
      {
        type: "text",
        text: "[Sensitive managed process result was not saved. Open Processes to view current state.]",
      },
    ]);
    assert.equal(result.details, undefined);
  }
  assert.doesNotMatch(JSON.stringify(messages), /SECRET/);
}

test("live process arguments and results survive projection while history and reopened files stay redacted", (t) => {
  const manager = createSession(t);
  installManagedProcessSessionRedaction(manager);
  const messages = processMessages();
  const original = structuredClone(messages);
  const ids = messages.map((message) => manager.appendMessage(message));
  const raw = structuredClone(manager.getEntries());

  const projection = manager.buildSessionProjection();
  assert.deepEqual(projection.messages, original);
  assert.deepEqual(
    projection.entries.flatMap((entry) => entry.messages),
    original,
  );
  assert.deepEqual(
    projection.entries.map((entry) => entry.sourceEntry),
    raw,
  );
  assert.deepEqual(manager.getEntries(), raw);
  assertRedacted(manager.getEntries().map((entry) => entry.message));
  assertRedacted(ids.map((id) => manager.getEntry(id).message));

  const file = manager.getSessionFile();
  assert.match(file, /\.jsonl$/);
  const disk = readFileSync(file, "utf8");
  assert.doesNotMatch(disk, /SECRET/);
  assertRedacted(
    disk
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line))
      .filter((entry) => entry.type === "message")
      .map((entry) => entry.message),
  );

  const reopened = SessionManager.open(file);
  installManagedProcessSessionRedaction(reopened);
  assertRedacted(reopened.getEntries().map((entry) => entry.message));
  assertRedacted(reopened.buildSessionProjection().messages);
  assertRedacted(reopened.buildSessionContext().messages);
  assert.deepEqual(messages, original);
});

test("context edits take precedence over live process messages only on their branch", (t) => {
  const manager = createSession(t);
  installManagedProcessSessionRedaction(manager);
  const messages = processMessages();
  const ids = messages.map((message) => manager.appendMessage(message));
  const uneditedLeaf = manager.getLeafId();
  const original = structuredClone(manager.getEntries());
  const content = [{ type: "text", text: "Reviewed process summary" }];
  const replaced = [
    { ...messages[0], content },
    {
      role: "toolResult",
      toolCallId: "call-0",
      toolName: "process_start",
      content,
      isError: false,
    },
    ...messages.slice(2),
  ];

  manager.appendContextEdit(ids[0], { content });
  const replacementLeaf = manager.appendContextEdit(ids[1], { content });
  assert.deepEqual(manager.buildSessionProjection().messages, replaced);
  assert.deepEqual(manager.buildSessionContext().messages, replaced);

  manager.appendContextEdit(ids[0], null);
  const omissionLeaf = manager.appendContextEdit(ids[1], null);
  assert.deepEqual(manager.buildSessionProjection().messages, messages.slice(2));
  assert.deepEqual(manager.buildSessionContext().messages, messages.slice(2));

  manager.branch(uneditedLeaf);
  assert.deepEqual(manager.buildSessionProjection().messages, messages);
  assert.deepEqual(manager.buildSessionContext().messages, messages);
  manager.branch(replacementLeaf);
  assert.deepEqual(manager.buildSessionProjection().messages, replaced);
  manager.branch(omissionLeaf);
  assert.deepEqual(manager.buildSessionProjection().messages, messages.slice(2));
  assert.deepEqual(
    ids.map((id) => manager.getEntry(id)),
    original,
  );
  assert.doesNotMatch(readFileSync(manager.getSessionFile(), "utf8"), /SECRET/);
});

test("context and projection preserve session settings across branch changes", (t) => {
  const manager = createSession(t);
  installManagedProcessSessionRedaction(manager);
  manager.appendModelChange("openai", "gpt-4o");
  manager.appendThinkingLevelChange("high");
  const messages = processMessages();
  const ids = messages.map((message) => manager.appendMessage(message));
  manager.appendModelChange("anthropic", "claude-sonnet-4-5");
  manager.appendThinkingLevelChange("low");
  const latestLeaf = manager.appendContextEdit(ids[3], null);

  manager.branch(ids[1]);
  const earlier = {
    messages: messages.slice(0, 2),
    thinkingLevel: "high",
    model: { provider: "openai", modelId: "gpt-4o" },
  };
  assert.deepEqual(manager.buildSessionContext(), earlier);
  const { entries, ...projection } = manager.buildSessionProjection();
  assert.deepEqual(projection, earlier);
  assert.deepEqual(
    entries.flatMap((entry) => entry.messages),
    earlier.messages,
  );
  manager.branch(latestLeaf);
  assert.deepEqual(manager.buildSessionContext(), {
    messages: messages.slice(0, 3),
    thinkingLevel: "low",
    model: { provider: "anthropic", modelId: "claude-sonnet-4-5" },
  });
  manager.resetLeaf();
  assert.deepEqual(manager.buildSessionContext(), { messages: [], thinkingLevel: "off", model: null });
  assert.doesNotMatch(readFileSync(manager.getSessionFile(), "utf8"), /SECRET/);
});

test("managed process command, stdin and output are omitted from persisted messages", () => {
  const assistant = redactManagedProcessPersistedMessage({
    role: "assistant",
    content: [
      { type: "text", text: "starting" },
      {
        type: "toolCall",
        id: "call-a",
        name: "process_start",
        arguments: { command: "SECRET_COMMAND", cwd: "/secret/path", label: "frontend" },
      },
      {
        type: "toolCall",
        id: "call-b",
        name: "process_write",
        arguments: { processId: "proc-a", runId: "run-a", text: "SECRET_STDIN" },
      },
    ],
  });
  const serializedAssistant = JSON.stringify(assistant);
  assert.equal(serializedAssistant.includes("SECRET_COMMAND"), false);
  assert.equal(serializedAssistant.includes("/secret/path"), false);
  assert.equal(serializedAssistant.includes("SECRET_STDIN"), false);
  assert.equal(serializedAssistant.includes("frontend"), true);

  const result = redactManagedProcessPersistedMessage({
    role: "toolResult",
    toolName: "process_read",
    content: [{ type: "text", text: "SECRET_OUTPUT" }],
    details: { raw: "SECRET_DETAIL" },
  });
  const serializedResult = JSON.stringify(result);
  assert.equal(serializedResult.includes("SECRET_OUTPUT"), false);
  assert.equal(serializedResult.includes("SECRET_DETAIL"), false);
  assert.match(serializedResult, /Sensitive managed process result was not saved/);
});

test("managed process errors retain only a safe whitelisted error projection", () => {
  const result = redactManagedProcessPersistedMessage({
    role: "toolResult",
    toolName: "process_start",
    toolCallId: "call-safe",
    isError: true,
    content: [
      {
        type: "text",
        text: "PROCESS_CONTAINMENT_UNAVAILABLE: CreateProcess failed at C:\\secret with command SECRET_COMMAND",
      },
    ],
    details: { win32: 5, path: "C:\\secret" },
    error: "SECRET_COMMAND",
  });
  assert.deepEqual(result, {
    role: "toolResult",
    toolName: "process_start",
    toolCallId: "call-safe",
    isError: true,
    errorCode: "PROCESS_CONTAINMENT_UNAVAILABLE",
    content: [
      {
        type: "text",
        text: "PROCESS_CONTAINMENT_UNAVAILABLE: Managed process request failed. Sensitive details were not saved.",
      },
    ],
  });
  assert.equal(JSON.stringify(result).includes("SECRET"), false);
  assert.equal(JSON.stringify(result).includes("C:\\\\secret"), false);
});

test("unrecognized error text is omitted without inventing a process id or refresh action", () => {
  const result = redactManagedProcessPersistedMessage({
    role: "toolResult",
    toolName: "process_start",
    isError: true,
    content: [{ type: "text", text: "PRIVATE_FAILURE" }],
  });
  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes("PRIVATE_FAILURE"), false);
  assert.equal(serialized.includes("process_read"), false);
  assert.equal(serialized.includes("errorCode"), false);
});

test("session redaction changes only the persisted copy", () => {
  const persisted = [];
  const manager = {
    appendMessage(message) {
      persisted.push(message);
      return "entry-a";
    },
  };
  installManagedProcessSessionRedaction(manager);
  installManagedProcessSessionRedaction(manager);
  const inMemory = {
    role: "toolResult",
    toolName: "process_wait",
    content: [{ type: "text", text: "LIVE_OUTPUT" }],
  };
  manager.appendMessage(inMemory);
  assert.equal(inMemory.content[0].text, "LIVE_OUTPUT");
  assert.equal(JSON.stringify(persisted).includes("LIVE_OUTPUT"), false);
  assert.equal(persisted.length, 1);
});

test("unrelated tool messages are preserved by identity", () => {
  const message = { role: "toolResult", toolName: "read", content: [{ type: "text", text: "file" }] };
  assert.equal(redactManagedProcessPersistedMessage(message), message);
});
