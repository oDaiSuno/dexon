import { importTestBundle } from "#test-bundle";
import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
const { buildSessionHistoryPage, decodeHistoryCursor, readSessionEntryContent, StaleHistoryCursorError } =
  await importTestBundle("src/agent-host/session-history", {
    packages: "external",
    entryPoints: [path.join(import.meta.dirname, "session-history.ts")],
  });

const { branchAt, withBranchModelChoice } = await importTestBundle("src/agent-host/session-branch-for-history", {
  packages: "external",
  entryPoints: [path.join(import.meta.dirname, "session-branch.ts")],
});

const timestamp = "2026-08-06T00:00:00.000Z";
const modelChoice = { model: { provider: "provider", modelId: "model" }, thinkingLevel: null };

function chain(definitions) {
  let parentId = null;
  return definitions.map((definition, index) => {
    const entry = { id: `entry-${index}`, parentId, timestamp, ...definition };
    parentId = entry.id;
    return entry;
  });
}

function user(content) {
  return { type: "message", message: { role: "user", content } };
}

function assistant(content) {
  return {
    type: "message",
    message: { role: "assistant", content, provider: "provider", model: "model", timestamp: 1 },
  };
}

function toolResult(toolCallId, text) {
  return {
    type: "message",
    message: { role: "toolResult", toolCallId, content: [{ type: "text", text }], timestamp: 2 },
  };
}

test("history pages preserve complete turns and reconstruct the full display history", () => {
  const entries = chain([
    user("first"),
    assistant([{ type: "text", text: "first answer" }]),
    user("second"),
    assistant([{ type: "toolCall", toolCallId: "call", toolName: "read", input: { path: "file" } }]),
    toolResult("call", "tool output"),
    assistant([{ type: "text", text: "second answer" }]),
    user("third"),
    assistant([{ type: "text", text: "third answer" }]),
  ]);
  const revision = "revision-one";
  const newest = buildSessionHistoryPage({
    modelChoice,
    entries,
    historyWindow: { maxTurns: 1, maxBytes: 128 * 1024 },
    historyRevision: revision,
  });
  assert.deepEqual(
    newest.messages.map((message) => message.role),
    ["user", "assistant"],
  );
  assert.equal(newest.truncatedBefore, true);

  const middleCursor = decodeHistoryCursor(newest.previousCursor);
  const middle = buildSessionHistoryPage({
    modelChoice,
    entries,
    historyWindow: { maxTurns: 1, maxBytes: 128 * 1024 },
    historyRevision: revision,
    cursor: middleCursor,
  });
  assert.deepEqual(
    middle.messages.map((message) => message.role),
    ["user", "assistant", "toolResult", "assistant"],
  );

  const oldest = buildSessionHistoryPage({
    modelChoice,
    entries,
    historyWindow: { maxTurns: 1, maxBytes: 128 * 1024 },
    historyRevision: revision,
    cursor: decodeHistoryCursor(middle.previousCursor),
  });
  const reconstructedMessages = [...oldest.messages, ...middle.messages, ...newest.messages];
  const reconstructedEntryIds = [...oldest.entryIds, ...middle.entryIds, ...newest.entryIds];
  const full = buildSessionHistoryPage({ modelChoice, entries, historyRevision: revision });
  assert.deepEqual(reconstructedMessages, full.messages);
  assert.deepEqual(reconstructedEntryIds, full.entryIds);
});

test("oversized text blocks are deferred within the byte budget and can be read exactly", () => {
  const oversized = "large-output-".repeat(30_000);
  const entries = chain([
    user("inspect"),
    assistant([{ type: "toolCall", toolCallId: "call", toolName: "inspect", input: {} }]),
    toolResult("call", oversized),
    assistant([{ type: "text", text: "done" }]),
  ]);
  const maxBytes = 96 * 1024;
  const page = buildSessionHistoryPage({
    modelChoice,
    entries,
    historyWindow: { maxTurns: 20, maxBytes },
    historyRevision: "revision-two",
  });
  const result = page.messages.find((message) => message.role === "toolResult");
  const block = result.content[0];
  assert.equal(block.type, "text");
  assert.equal(block.deferredContent.entryId, "entry-2");
  assert.equal(block.deferredContent.originalBytes, Buffer.byteLength(oversized));
  assert.equal(Buffer.byteLength(JSON.stringify(page)) <= maxBytes, true);
  assert.deepEqual(readSessionEntryContent(entries, "entry-2", 0), { type: "text", text: oversized });
});

test("oversized inline images are deferred and restored as the original block", () => {
  const image = {
    type: "image",
    source: { type: "base64", media_type: "image/png", data: "a".repeat(180 * 1024) },
  };
  const entries = chain([user("image"), assistant([image, { type: "text", text: "caption" }])]);
  const page = buildSessionHistoryPage({
    modelChoice,
    entries,
    historyWindow: { maxTurns: 1, maxBytes: 64 * 1024 },
    historyRevision: "image-revision",
  });
  const assistantMessage = page.messages[1];
  assert.equal(assistantMessage.content[0].type, "image");
  assert.equal(assistantMessage.content[0].deferredContent.contentType, "image");
  assert.equal(Buffer.byteLength(JSON.stringify(page)) <= 64 * 1024, true);
  assert.deepEqual(readSessionEntryContent(entries, "entry-1", 0), image);
});

test("oversized thinking and tool inputs cannot empty the newest page", () => {
  const thinking = { type: "thinking", thinking: "reasoning-".repeat(30_000) };
  const toolCall = {
    type: "toolCall",
    toolCallId: "large-call",
    toolName: "write",
    input: { content: "generated-code-".repeat(30_000) },
  };
  const entries = chain([user("generate"), assistant([thinking, toolCall]), toolResult("large-call", "done")]);
  const maxBytes = 96 * 1024;
  const page = buildSessionHistoryPage({
    modelChoice,
    entries,
    historyWindow: { maxTurns: 1, maxBytes },
    historyRevision: "large-process-revision",
  });
  assert.equal(page.messages.length, 3);
  assert.equal(page.messages[1].content[0].deferredContent.contentType, "thinking");
  assert.equal(page.messages[1].content[1].deferredContent.contentType, "toolCall");
  assert.equal(Buffer.byteLength(JSON.stringify(page)) <= maxBytes, true);
  assert.deepEqual(readSessionEntryContent(entries, "entry-1", 0), thinking);
  assert.deepEqual(readSessionEntryContent(entries, "entry-1", 1), toolCall);
});

test("channel markers cross page boundaries and settings preserve the resolved model choice", () => {
  const entries = chain([
    user("old"),
    assistant([{ type: "text", text: "old answer" }]),
    { type: "thinking_level_change", thinkingLevel: "high" },
    { type: "model_change", provider: "next-provider", modelId: "next-model" },
    {
      type: "custom",
      customType: "dexon-channel-source",
      data: { channel: "telegram", runId: "external-turn" },
    },
    user("external"),
    assistant([{ type: "text", text: "reply" }]),
  ]);
  const page = buildSessionHistoryPage({
    entries,
    historyWindow: { maxTurns: 1, maxBytes: 64 * 1024 },
    historyRevision: "revision-three",
    modelChoice: { model: { provider: "next-provider", modelId: "next-model" }, thinkingLevel: "high" },
  });
  assert.equal(page.messages[0].role, "user");
  assert.equal(page.messages[0].channelSource, "telegram");
  assert.equal(page.thinkingLevel, "high");
  assert.deepEqual(page.model, { provider: "next-provider", modelId: "next-model" });
});

test("compaction and branch summaries survive page boundaries with aligned entry ids", () => {
  const entries = chain([
    user("old"),
    assistant([{ type: "text", text: "old answer" }]),
    {
      type: "compaction",
      summary: "compressed history",
      firstKeptEntryId: "entry-0",
      tokensBefore: 100,
    },
    {
      type: "branch_summary",
      summary: "alternate branch",
      fromId: "entry-1",
    },
    user("new"),
    assistant([{ type: "text", text: "new answer" }]),
  ]);
  const revision = "summary-revision";
  const full = buildSessionHistoryPage({ modelChoice, entries, historyRevision: revision });
  const pages = [];
  let cursor;
  do {
    const page = buildSessionHistoryPage({
      modelChoice,
      entries,
      historyWindow: { maxTurns: 1, maxBytes: 64 * 1024 },
      historyRevision: revision,
      ...(cursor ? { cursor: decodeHistoryCursor(cursor) } : {}),
    });
    pages.unshift(page);
    cursor = page.previousCursor;
  } while (cursor);
  assert.deepEqual(
    pages.flatMap((page) => page.messages),
    full.messages,
  );
  assert.deepEqual(
    pages.flatMap((page) => page.entryIds),
    full.entryIds,
  );
  assert.equal(
    full.messages.some((message) => message.role === "custom" && message.customType === "compaction"),
    true,
  );
  assert.equal(
    full.messages.some((message) => message.role === "user" && String(message.content).includes("another branch")),
    true,
  );
});

test("stale or malformed cursors are rejected", () => {
  const entries = chain([user("one"), assistant([{ type: "text", text: "answer" }]), user("two")]);
  const page = buildSessionHistoryPage({
    modelChoice,
    entries,
    historyWindow: { maxTurns: 1 },
    historyRevision: "current-revision",
  });
  const cursor = decodeHistoryCursor(page.previousCursor);
  assert.throws(
    () =>
      buildSessionHistoryPage({
        modelChoice,
        entries,
        historyWindow: { maxTurns: 1 },
        historyRevision: "replacement-revision",
        cursor,
      }),
    StaleHistoryCursorError,
  );
  assert.throws(() => decodeHistoryCursor("not-a-cursor"), /Invalid session history cursor/);
});

test("append-only growth keeps cursors valid while truncation invalidates them", () => {
  const entries = chain([
    user("one"),
    assistant([{ type: "text", text: "answer one" }]),
    user("two"),
    assistant([{ type: "text", text: "answer two" }]),
  ]);
  const revision = "append-stable-revision";
  const newest = buildSessionHistoryPage({
    modelChoice,
    entries,
    historyWindow: { maxTurns: 1 },
    historyRevision: revision,
  });
  const cursor = decodeHistoryCursor(newest.previousCursor);
  const appended = chain([
    user("one"),
    assistant([{ type: "text", text: "answer one" }]),
    user("two"),
    assistant([{ type: "text", text: "answer two" }]),
    user("three"),
  ]);
  const older = buildSessionHistoryPage({
    modelChoice,
    entries: appended,
    historyWindow: { maxTurns: 1 },
    historyRevision: revision,
    cursor,
  });
  assert.equal(older.messages[0].content, "one");
  assert.throws(
    () =>
      buildSessionHistoryPage({
        modelChoice,
        entries: entries.slice(0, 2),
        historyWindow: { maxTurns: 1 },
        historyRevision: revision,
        cursor,
      }),
    StaleHistoryCursorError,
  );
});

function longToolTurn() {
  const definitions = [user("analyze the repository")];
  for (let index = 0; index < 80; index += 1) {
    definitions.push(
      assistant([
        { type: "thinking", thinking: "reasoning-".repeat(150), thinkingSignature: "signature-".repeat(1200) },
        { type: "toolCall", toolCallId: `call-${index}`, toolName: "read", input: { path: `src/file-${index}.ts` } },
      ]),
      toolResult(`call-${index}`, "output-".repeat(2_200)),
    );
  }
  definitions.push(assistant([{ type: "text", text: "final summary" }]));
  const entries = chain(definitions);
  return { entries, displayEntryIds: entries.map((entry) => entry.id) };
}

function reportedSampleTurn() {
  const definitions = [user("analyze this session")];
  for (let index = 0; index < 80; index += 1) {
    definitions.push(
      assistant([
        { type: "thinking", thinking: "reasoning ".repeat(150), thinkingSignature: "signature ".repeat(900) },
        { type: "toolCall", toolCallId: `call-${index}`, toolName: "read", input: { path: `src/file-${index}.ts` } },
      ]),
      toolResult(`call-${index}`, "output ".repeat(430)),
    );
  }
  definitions.push(assistant([{ type: "text", text: "final summary" }]));
  return chain(definitions);
}

test("when the reported long session is reopened, the whole conversation is visible because hidden signatures no longer count", () => {
  const entries = reportedSampleTurn();
  const page = buildSessionHistoryPage({
    modelChoice,
    entries,
    historyWindow: { maxTurns: 20, maxBytes: 1024 * 1024 },
    historyRevision: "reported-sample-revision",
  });
  assert.equal(page.messages.length, 162);
  assert.equal(page.loadedMessages, 162);
  assert.equal(page.totalMessages, 162);
  assert.equal(page.truncatedBefore, false);
  assert.equal(page.previousCursor, undefined);
});

test("when the newest turn cannot fit the byte budget, the newest page still returns visible messages and a cursor", () => {
  const { entries } = longToolTurn();
  const page = buildSessionHistoryPage({
    modelChoice,
    entries,
    historyWindow: { maxTurns: 20, maxBytes: 1024 * 1024 },
    historyRevision: "long-session-revision",
  });
  assert.equal(page.messages.length > 0, true);
  assert.equal(page.truncatedBefore, true);
  assert.equal(typeof page.previousCursor, "string");
});

function readAllPages(entries, historyWindow, historyRevision) {
  const pages = [];
  let cursor;
  do {
    const page = buildSessionHistoryPage({
      modelChoice,
      entries,
      historyWindow,
      historyRevision,
      ...(cursor ? { cursor: decodeHistoryCursor(cursor) } : {}),
    });
    pages.unshift(page);
    cursor = page.previousCursor;
    if (pages.length > 2_000) throw new Error("history paging never reached the start of the branch");
  } while (cursor);
  return pages;
}

test("when a turn exceeds the byte budget, every page read back to the start yields each branch message once in order", () => {
  const { entries, displayEntryIds } = longToolTurn();
  const pages = readAllPages(entries, { maxTurns: 20, maxBytes: 1024 * 1024 }, "long-session-revision");
  assert.equal(pages.length > 1, true);
  assert.deepEqual(
    pages.flatMap((page) => page.entryIds),
    displayEntryIds,
  );
  assert.equal(pages.flatMap((page) => page.messages).length, displayEntryIds.length);
  assert.equal(pages.at(-1).truncatedBefore, true);
  assert.equal(pages[0].truncatedBefore, false);
  assert.equal(pages[0].previousCursor, undefined);
});

function toolCallIdsBefore(page, index) {
  return page.messages
    .slice(0, index)
    .flatMap((message) =>
      message.role === "assistant"
        ? message.content.filter((block) => block.type === "toolCall").map((block) => block.toolCallId)
        : [],
    );
}

test("when a page break lands inside a turn, no page starts with a tool result cut away from its call", () => {
  const { entries } = longToolTurn();
  const pages = readAllPages(entries, { maxTurns: 20, maxBytes: 1024 * 1024 }, "long-session-revision");
  assert.equal(pages.length > 1, true);
  for (const page of pages) {
    assert.notEqual(page.messages[0].role, "toolResult");
    page.messages.forEach((message, index) => {
      if (message.role !== "toolResult") return;
      assert.equal(toolCallIdsBefore(page, index).includes(message.toolCallId), true);
    });
  }
});

function bulkToolTurn() {
  const calls = Array.from({ length: 40 }, (_unused, index) => ({
    type: "toolCall",
    toolCallId: `bulk-${index}`,
    toolName: "read",
    input: { path: `p-${index}` },
  }));
  const definitions = [user("read everything"), assistant(calls)];
  for (let index = 0; index < 40; index += 1) definitions.push(toolResult(`bulk-${index}`, "chunk-".repeat(7_000)));
  const entries = chain(definitions);
  return { entries, displayEntryIds: entries.map((entry) => entry.id) };
}

test("when one tool call and its results are larger than a whole page, every page still makes progress and no message is lost", () => {
  const { entries, displayEntryIds } = bulkToolTurn();
  const pages = readAllPages(entries, { maxTurns: 20, maxBytes: 32 * 1024 }, "bulk-revision");
  assert.equal(pages.length > 1, true);
  assert.equal(
    pages.every((page) => page.messages.length > 0),
    true,
  );
  assert.deepEqual(
    pages.flatMap((page) => page.entryIds),
    displayEntryIds,
  );
});

test("when one message alone exceeds the page budget, it is still returned with every block deferred", () => {
  const giant = "giant-body-".repeat(300_000);
  const entries = chain([
    user([
      { type: "text", text: giant },
      { type: "text", text: giant },
    ]),
    assistant([{ type: "text", text: "noted" }]),
  ]);
  const page = buildSessionHistoryPage({
    modelChoice,
    entries,
    historyWindow: { maxTurns: 20, maxBytes: 1024 * 1024 },
    historyRevision: "giant-revision",
  });
  const restored = page.messages.find((message) => message.role === "user");
  assert.equal(restored.content.length, 2);
  assert.deepEqual(
    restored.content.map((block) => block.deferredContent.originalBytes),
    [Buffer.byteLength(giant), Buffer.byteLength(giant)],
  );
  assert.equal(page.entryIds[0], "entry-0");
  assert.equal(page.previousCursor, undefined);
});

test("when a turn holds many large blocks, reading every page covers each message once and keeps entry ids aligned", () => {
  const block = { type: "text", text: "block-body-".repeat(20_000) };
  const definitions = [user("inspect everything")];
  for (let index = 0; index < 40; index += 1) definitions.push(assistant([block, block, block, block, block, block]));
  const entries = chain(definitions);
  const pages = readAllPages(entries, { maxTurns: 20, maxBytes: 1024 * 1024 }, "large-block-revision");
  assert.equal(pages.length > 1, true);
  assert.deepEqual(
    pages.flatMap((page) => page.entryIds),
    entries.map((entry) => entry.id),
  );
});

test("when messages carry large hidden metadata, reading every page still covers each message once", () => {
  const definitions = [user("think hard")];
  for (let index = 0; index < 200; index += 1) {
    definitions.push(
      assistant([{ type: "thinking", thinking: `step-${index}`, thinkingSignature: "signature-".repeat(2_000) }]),
    );
  }
  const entries = chain(definitions);
  const pages = readAllPages(entries, { maxTurns: 20, maxBytes: 1024 * 1024 }, "hidden-metadata-revision");
  assert.deepEqual(
    pages.flatMap((page) => page.entryIds),
    entries.map((entry) => entry.id),
  );
});

function signedAssistant() {
  return chain([
    user("explain"),
    assistant([
      { type: "thinking", thinking: "why", thinkingSignature: "thinking-sig" },
      { type: "text", text: "answer", textSignature: "text-sig" },
      { type: "toolCall", toolCallId: "call", toolName: "read", input: { path: "a" }, thoughtSignature: "call-sig" },
    ]),
  ]);
}

test("when a history page is projected for display, thinking, text and tool-call signatures are not shipped", () => {
  const entries = signedAssistant();
  const page = buildSessionHistoryPage({
    modelChoice,
    entries,
    historyWindow: { maxTurns: 20, maxBytes: 64 * 1024 },
    historyRevision: "signature-revision",
  });
  assert.deepEqual(page.messages[1].content, [
    { type: "thinking", thinking: "why" },
    { type: "text", text: "answer" },
    { type: "toolCall", toolCallId: "call", toolName: "read", input: { path: "a" } },
  ]);
  assert.equal(entries[1].message.content[0].thinkingSignature, "thinking-sig");
  assert.equal(entries[1].message.content[1].textSignature, "text-sig");
});

test("when one block is read back for display, its model-only signatures are not shipped either", () => {
  const entries = signedAssistant();
  assert.deepEqual(readSessionEntryContent(entries, "entry-1", 0), { type: "thinking", thinking: "why" });
  assert.deepEqual(readSessionEntryContent(entries, "entry-1", 1), { type: "text", text: "answer" });
  assert.deepEqual(entries[1].message.content[0], {
    type: "thinking",
    thinking: "why",
    thinkingSignature: "thinking-sig",
  });
});

test("navigating to the empty root branch returns an empty page and outline instead of falling back to the last entry", () => {
  const entries = chain([user("first question"), assistant([{ type: "text", text: "first answer" }])]);
  const fullRoot = buildSessionHistoryPage({
    modelChoice,
    entries,
    leafId: null,
    historyRevision: "root-revision",
  });
  assert.deepEqual(fullRoot.messages, []);
  assert.deepEqual(fullRoot.entryIds, []);
  assert.deepEqual(fullRoot.outline, []);

  const pagedRoot = buildSessionHistoryPage({
    modelChoice,
    entries,
    leafId: null,
    historyWindow: { maxTurns: 5, maxBytes: 64 * 1024 },
    historyRevision: "root-revision",
  });
  assert.deepEqual(pagedRoot.messages, []);
  assert.deepEqual(pagedRoot.entryIds, []);
  assert.deepEqual(pagedRoot.outline, []);
});

test("full and paged history terminate cyclic parent links and preserve the stored records", () => {
  const entries = chain([user("first question"), assistant([{ type: "text", text: "first answer" }])]);
  entries[0].parentId = entries[1].id;
  const persisted = structuredClone(entries);
  for (const historyWindow of [undefined, { maxTurns: 1 }]) {
    const page = buildSessionHistoryPage({ entries, historyWindow, historyRevision: "cyclic-revision" });
    assert.deepEqual(page.entryIds, ["entry-0", "entry-1"]);
    assert.deepEqual(
      page.messages.map((message) => message.role),
      ["user", "assistant"],
    );
    assert.deepEqual(page.outline, [{ entryId: "entry-0", title: "first question" }]);
    assert.equal(page.previousCursor, undefined);
    assert.deepEqual(page.model, { provider: "provider", modelId: "model" });
  }
  assert.deepEqual(entries, persisted);
});

test("history remains readable when model and thinking records form a cycle before a question", () => {
  const entries = chain([
    { type: "model_change", provider: "provider", modelId: "catalog-model" },
    { type: "thinking_level_change", thinkingLevel: "high" },
    user("question after cyclic settings"),
    assistant([{ type: "text", text: "answer" }]),
  ]);
  entries[0].parentId = entries[1].id;
  for (const historyWindow of [undefined, { maxTurns: 1 }]) {
    const page = buildSessionHistoryPage({ entries, historyWindow, historyRevision: "cyclic-settings-revision" });
    assert.deepEqual(page.entryIds, ["entry-2", "entry-3"]);
    assert.deepEqual(page.model, { provider: "provider", modelId: "catalog-model" });
    assert.equal(page.thinkingLevel, "high");
  }
});

test("paging a resolved branch retains its live choice and re-anchors other branches to the cursor's recorded choice", () => {
  const entries = chain([
    { type: "model_change", provider: "provider", modelId: "recorded-model" },
    { type: "thinking_level_change", thinkingLevel: "high" },
    user("first question"),
    assistant([{ type: "text", text: "first answer" }]),
    user("second question"),
    assistant([{ type: "text", text: "second answer" }]),
    { type: "model_change", provider: "provider", modelId: "other-model", parentId: "entry-3" },
    user("alternate question"),
    assistant([{ type: "text", text: "alternate answer" }]),
  ]);
  const liveChoice = { model: { provider: "provider", modelId: "live-model" }, thinkingLevel: "off" };
  const liveBranch = withBranchModelChoice(branchAt(entries, "entry-5"), liveChoice);
  const historyRevision = "anchored-branch-revision";
  const historyWindow = { maxTurns: 1 };
  const newest = buildSessionHistoryPage({ branch: liveBranch, historyWindow, historyRevision });
  assert.deepEqual(newest.messages[0].versions, { entryIds: ["entry-4", "entry-7"], index: 0 });
  const cursor = decodeHistoryCursor(newest.previousCursor);
  const sameBranch = buildSessionHistoryPage({ branch: liveBranch, historyWindow, historyRevision, cursor });
  assert.deepEqual(sameBranch.entryIds, ["entry-2", "entry-3"]);
  assert.deepEqual(sameBranch.model, liveChoice.model);
  assert.equal(sameBranch.thinkingLevel, "off");
  const otherBranch = buildSessionHistoryPage({ branch: branchAt(entries), historyWindow, historyRevision, cursor });
  assert.deepEqual(otherBranch.entryIds, ["entry-2", "entry-3"]);
  assert.deepEqual(otherBranch.model, { provider: "provider", modelId: "recorded-model" });
  assert.equal(otherBranch.thinkingLevel, "high");
});

test("a missing cursor anchor is rejected instead of silently paging the latest branch", () => {
  const entries = chain([user("first"), assistant([{ type: "text", text: "answer" }]), user("second")]);
  const historyRevision = "missing-anchor-revision";
  const page = buildSessionHistoryPage({ entries, historyWindow: { maxTurns: 1 }, historyRevision });
  const cursor = { ...decodeHistoryCursor(page.previousCursor), anchorLeafId: "missing-leaf" };
  assert.throws(
    () => buildSessionHistoryPage({ branch: branchAt(entries), historyRevision, cursor }),
    StaleHistoryCursorError,
  );
});

test("empty root settings stay empty unless an explicit model choice overrides them", () => {
  const entries = chain([
    { type: "model_change", provider: "provider", modelId: "catalog-model" },
    { type: "thinking_level_change", thinkingLevel: "high" },
    user("question"),
    assistant([{ type: "text", text: "answer" }]),
  ]);
  for (const historyWindow of [undefined, { maxTurns: 1 }]) {
    const options = { branch: branchAt(entries, null), historyWindow, historyRevision: "root-settings-revision" };
    const root = buildSessionHistoryPage(options);
    assert.equal(root.model, null);
    assert.equal(root.thinkingLevel, "off");
    assert.deepEqual(root.messages, []);
    const chosen = buildSessionHistoryPage({ ...options, modelChoice });
    assert.deepEqual(chosen.model, modelChoice.model);
    assert.equal(chosen.thinkingLevel, "off");
    const cleared = buildSessionHistoryPage({
      branch: branchAt(entries),
      historyWindow,
      historyRevision: "cleared-choice-revision",
      modelChoice: { model: null, thinkingLevel: null },
    });
    assert.equal(cleared.model, null);
    assert.equal(cleared.thinkingLevel, "off");
  }
});
