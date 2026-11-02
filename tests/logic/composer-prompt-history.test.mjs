import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { importTestBundle } from "#test-bundle";

const history = await importTestBundle("composer-prompt-history", {
  entryPoints: [path.resolve("src/renderer/components/chat-input/prompt-history.ts")],
  tsconfig: path.resolve("tsconfig.renderer.json"),
});

const buffer = await importTestBundle("composer-buffer", {
  entryPoints: [path.resolve("src/renderer/components/chat-input/composer-buffer.ts")],
  tsconfig: path.resolve("tsconfig.renderer.json"),
});

const { historyIntent } = await importTestBundle("composer-history-keys", {
  entryPoints: [path.resolve("src/renderer/components/chat-input/use-composer-keys.ts")],
  tsconfig: path.resolve("tsconfig.renderer.json"),
  external: ["react"],
});
const trigger = await importTestBundle("composer-history-triggers", {
  entryPoints: [path.resolve("src/renderer/components/chat-input/composer-trigger.ts")],
  tsconfig: path.resolve("tsconfig.renderer.json"),
});

const image = { type: "image", source: { type: "base64", media_type: "image/png", data: "AA==" } };
const deferredContent = { entryId: "deferred", originalBytes: 2048 };

test("history recalls only complete local user prompts and joins their text blocks", () => {
  const messages = [
    { role: "user", content: "  local prompt  ", timestamp: 10 },
    { role: "assistant", content: [{ type: "text", text: "assistant answer" }] },
    { role: "toolResult", content: [{ type: "text", text: "tool output" }] },
    { role: "custom", content: "custom notice" },
    { role: "user", content: [{ type: "text", text: "first" }, image, { type: "text", text: "second" }] },
    { role: "user", content: [image] },
    { role: "user", content: " \n " },
    { role: "user", content: "remote weixin", channelSource: "weixin" },
    { role: "user", content: "remote telegram", channelSource: "telegram" },
    { role: "user", content: "remote feishu", channelSource: "feishu" },
    { role: "user", content: "delegated task", sessionSource: { sessionId: "child" } },
    { role: "user", content: "branch context", syntheticSource: "branch_summary" },
    { role: "user", content: [{ type: "text", text: "partial text", deferredContent }] },
    {
      role: "user",
      content: [
        { type: "text", text: "partial image" },
        { ...image, deferredContent },
      ],
    },
  ];
  assert.deepEqual(history.recallablePrompts(messages), [
    { text: "local prompt", at: 10 },
    { text: "first\nsecond", at: null },
  ]);
});

test("expanded and typed skills recall their command and preserve a bare skill's closing space", () => {
  const messages = [
    {
      role: "user",
      content:
        '<skill name="fast-context" location="/skills/fast-context/SKILL.md">\nInstructions\n</skill>\n\nexplain this project',
      timestamp: 20,
    },
    {
      role: "user",
      content: '<skill name="review" location="/skills/review/SKILL.md">\nReview instructions\n</skill>',
    },
    { role: "user", content: "/skill:fast-context " },
    { role: "user", content: " /compact " },
    { role: "user", content: "/skill:review check errors" },
  ];
  assert.deepEqual(history.recallablePrompts(messages), [
    { text: "/skill:fast-context explain this project", at: 20 },
    { text: "/skill:review ", at: null },
    { text: "/skill:fast-context ", at: null },
    { text: "/compact", at: null },
    { text: "/skill:review check errors", at: null },
  ]);
});

test("history merges timestamps newest first and removes only consecutive repeats", () => {
  assert.deepEqual(
    history.buildPromptHistory(
      [
        { text: "unknown first", at: null },
        { text: "unknown second", at: null },
        { text: "repeat", at: 10 },
        { text: "repeat", at: 11 },
        { text: "middle", at: 30 },
        { text: "repeat", at: 50 },
      ],
      [
        { text: "/compact", at: 20 },
        { text: "/name", at: 40 },
        { text: "repeat", at: 60 },
      ],
    ),
    ["repeat", "/name", "middle", "/compact", "repeat", "unknown second", "unknown first"],
  );
  assert.equal(history.buildPromptHistory([], []), null);
});

test("history keeps the latest 100 distinct consecutive prompts", () => {
  const prompts = Array.from({ length: 105 }, (_, index) => ({ text: `prompt ${index + 1}`, at: index + 1 }));
  const result = history.buildPromptHistory(prompts, []);
  assert.equal(result.length, 100);
  assert.equal(result[0], "prompt 105");
  assert.equal(result[99], "prompt 6");
});

test("handled local commands stay scoped and transfer once to the created session", () => {
  history.recordLocalCommand("new:/history-ledger", " /compact ", 20);
  history.recordLocalCommand("history-unrelated", "/reload", 25);
  history.recordLocalCommand("history-session", "/name existing", 30);
  history.recordLocalCommand("new:/history-ledger", "  ", 40);
  history.carryLocalCommands("new:/history-ledger", "history-session");
  history.carryLocalCommands("new:/history-ledger", "history-session");
  history.carryLocalCommands("history-session", "history-session");
  assert.deepEqual(history.localCommandsFor("new:/history-ledger"), []);
  assert.deepEqual(history.localCommandsFor("history-unrelated"), [{ text: "/reload", at: 25 }]);
  assert.deepEqual(history.localCommandsFor("history-session"), [
    { text: "/compact", at: 20 },
    { text: "/name existing", at: 30 },
  ]);
  assert.deepEqual(
    history.buildPromptHistory([{ text: "agent prompt", at: 22 }], history.localCommandsFor("history-session")),
    ["/name existing", "agent prompt", "/compact"],
  );
  for (let index = 1; index <= 105; index++)
    history.recordLocalCommand("history-ledger-limit", `/name ${index}`, index);
  const commands = history.localCommandsFor("history-ledger-limit");
  assert.equal(commands.length, 100);
  assert.deepEqual(commands[0], { text: "/name 6", at: 6 });
  assert.deepEqual(commands[99], { text: "/name 105", at: 105 });
});

const source = () =>
  history.buildPromptHistory(
    [
      { text: "oldest\nsecond line", at: 1 },
      { text: "middle", at: 2 },
      { text: "newest", at: 3 },
    ],
    [],
  );

test("browsing freezes history and moves older at start and newer at end without changing the working draft", () => {
  const original = buffer.loadedBuffer("  working\ndraft \n", null);
  assert.equal(buffer.browseBuffer(original, "newer", source), null);
  assert.equal(
    buffer.browseBuffer(original, "older", () => null),
    null,
  );
  const newest = buffer.browseBuffer(original, "older", source);
  assert.equal(buffer.shownText(newest), "newest");
  assert.equal(buffer.restoreCaretOf(newest), "start");
  const updatedSource = () => history.buildPromptHistory([{ text: "new arrival", at: 4 }], []);
  const middle = buffer.browseBuffer(newest, "older", updatedSource);
  const oldest = buffer.browseBuffer(middle, "older", updatedSource);
  assert.equal(buffer.shownText(middle), "middle");
  assert.equal(buffer.shownText(oldest), "oldest\nsecond line");
  assert.equal(buffer.browseBuffer(oldest, "older", source), null);
  const forward = buffer.browseBuffer(oldest, "newer", updatedSource);
  assert.equal(buffer.shownText(forward), "middle");
  assert.equal(buffer.restoreCaretOf(forward), "end");
  const latest = buffer.browseBuffer(forward, "newer", updatedSource);
  const returned = buffer.browseBuffer(latest, "newer", updatedSource);
  assert.equal(buffer.shownText(returned), "  working\ndraft \n");
  assert.equal(buffer.restoreCaretOf(returned), "end");
  for (const state of [newest, middle, oldest, forward, latest, returned, buffer.returnedBuffer(oldest)]) {
    assert.deepEqual(state.draft, { text: "  working\ndraft \n", revision: 1 });
  }
});

test("only a changed preview becomes a revised working draft and take returns the working draft instead of the preview", () => {
  const preview = buffer.browseBuffer(buffer.loadedBuffer("unsent work", null), "older", source);
  const unchanged = buffer.editBuffer(preview, "newest");
  assert.equal(unchanged.draft.revision, 1);
  assert.equal(buffer.shownText(buffer.returnedBuffer(unchanged)), "unsent work");
  const edited = buffer.editBuffer(preview, "edited newest");
  assert.equal(buffer.shownText(edited), "edited newest");
  assert.equal(edited.draft.revision, 2);
  assert.equal(edited.recall, null);
  const taken = buffer.takeBuffer(preview);
  assert.equal(taken.text, "unsent work");
  assert.equal(buffer.shownText(taken.buffer), "");
  assert.equal(taken.buffer.draft.revision, 2);
  const migrated = buffer.migratedBuffer(preview, "unsent work @/tmp/restored.png");
  assert.equal(buffer.shownText(migrated), "newest");
  assert.equal(migrated.draft.revision, 2);
  assert.equal(buffer.shownText(buffer.returnedBuffer(migrated)), "unsent work @/tmp/restored.png");
});

test("submitting an unchanged preview sends it and keeps the working draft and its revision", () => {
  const preview = buffer.browseBuffer(buffer.loadedBuffer("unsent work", null), "older", source);
  const submitted = buffer.submitBuffer(preview, "session-original");
  assert.equal(submitted.ticket.message, "newest");
  assert.equal(submitted.ticket.scopeKey, "session-original");
  assert.equal(buffer.shownText(submitted.buffer), "unsent work");
  assert.equal(submitted.buffer.draft.revision, 1);
  assert.equal(submitted.clearsStoredDraft, false);
  const failed = buffer.restoreFailedBuffer(submitted.buffer, submitted.ticket);
  assert.equal(failed.action, "restore");
  assert.equal(buffer.shownText(failed.buffer), "newest");
  assert.equal(buffer.shownText(buffer.returnedBuffer(failed.buffer)), "unsent work");
});

test("a failed draft restores its original whitespace unless a newer edit or loaded scope owns the buffer", () => {
  const original = buffer.loadedBuffer("  draft @src/main.ts \n", null);
  const submitted = buffer.submitBuffer(original, "old-session");
  assert.equal(submitted.ticket.message, "draft @src/main.ts");
  assert.equal(buffer.shownText(submitted.buffer), "");
  assert.equal(submitted.clearsStoredDraft, true);
  const failed = buffer.restoreFailedBuffer(submitted.buffer, submitted.ticket);
  assert.equal(failed.action, "restore");
  assert.equal(buffer.shownText(failed.buffer), "  draft @src/main.ts \n");
  assert.equal(failed.buffer.draft.revision, 3);
  const edited = buffer.editBuffer(submitted.buffer, "newer work");
  const preserved = buffer.restoreFailedBuffer(edited, submitted.ticket);
  assert.equal(preserved.action, "preserve");
  assert.equal(buffer.shownText(preserved.buffer), "newer work");
  const reloaded = buffer.loadedBuffer("other session work", submitted.buffer);
  const stale = buffer.restoreFailedBuffer(reloaded, submitted.ticket);
  assert.equal(stale.action, "preserve");
  assert.equal(buffer.shownText(stale.buffer), "other session work");
  assert.equal(buffer.submitBuffer(buffer.loadedBuffer(" \n ", null), undefined), null);
});

test("browsing after submit does not prevent failure recovery but editing after a preview submit does", () => {
  const original = buffer.loadedBuffer("working draft", null);
  const submitted = buffer.submitBuffer(original, "session");
  const browsing = buffer.browseBuffer(submitted.buffer, "older", source);
  const restored = buffer.restoreFailedBuffer(browsing, submitted.ticket);
  assert.equal(restored.action, "restore");
  assert.equal(buffer.shownText(restored.buffer), "working draft");
  const preview = buffer.browseBuffer(original, "older", source);
  const resent = buffer.submitBuffer(preview, "session");
  const edited = buffer.editBuffer(resent.buffer, "newer working draft");
  const preserved = buffer.restoreFailedBuffer(edited, resent.ticket);
  assert.equal(preserved.action, "preserve");
  assert.equal(buffer.shownText(preserved.buffer), "newer working draft");
  assert.equal(preserved.buffer.recall, null);
});

const keyEvent = (key, modifiers = {}) => ({
  key,
  shiftKey: false,
  altKey: false,
  metaKey: false,
  ctrlKey: false,
  ...modifiers,
});
const caret = (values = {}) => ({
  kind: "caret",
  atStart: false,
  atEnd: false,
  onFirstRow: false,
  onLastRow: false,
  ...values,
});

test("history keys act only on unmodified caret edges and Escape returns only an active preview", () => {
  assert.equal(
    historyIntent(keyEvent("ArrowUp"), false, () => caret({ onFirstRow: true })),
    "caret-to-start",
  );
  assert.equal(
    historyIntent(keyEvent("ArrowUp"), false, () => caret({ atStart: true, onFirstRow: true })),
    "older",
  );
  assert.equal(
    historyIntent(keyEvent("ArrowUp"), true, () => caret({ onFirstRow: true })),
    "older",
  );
  assert.equal(
    historyIntent(keyEvent("ArrowDown"), true, () => caret({ onLastRow: true })),
    "newer",
  );
  assert.equal(
    historyIntent(keyEvent("ArrowDown"), false, () => caret({ onLastRow: true })),
    null,
  );
  assert.equal(
    historyIntent(keyEvent("ArrowUp"), true, () => caret()),
    null,
  );
  assert.equal(
    historyIntent(keyEvent("ArrowDown"), true, () => caret({ onFirstRow: true })),
    null,
  );
  assert.equal(
    historyIntent(keyEvent("ArrowUp"), true, () => ({ kind: "range" })),
    null,
  );
  assert.equal(
    historyIntent(keyEvent("ArrowUp"), true, () => null),
    null,
  );
  for (const modifier of ["shiftKey", "altKey", "metaKey", "ctrlKey"]) {
    assert.equal(
      historyIntent(keyEvent("ArrowUp", { [modifier]: true }), true, () => caret({ atStart: true })),
      null,
    );
    assert.equal(
      historyIntent(keyEvent("Escape", { [modifier]: true }), true, () => null),
      null,
    );
  }
  assert.equal(
    historyIntent(keyEvent("Escape"), true, () => null),
    "return",
  );
  assert.equal(
    historyIntent(keyEvent("Escape"), false, () => null),
    null,
  );
});

test("restoring a slash or at prompt suppresses its menu through caret movement until the user changes the trigger", () => {
  for (const [text, changed] of [
    ["/compact", "/compactx"],
    ["look @src/", "look @src/m"],
  ]) {
    const snapshot = { text, masked: text, caret: { kind: "caret", offset: text.length } };
    const restored = trigger.nextTriggerGate(
      trigger.initialTriggerGate,
      { type: "changed", change: { cause: "restore", snapshot } },
      true,
    );
    assert.equal(trigger.openTrigger(restored, true), null);
    const moved = trigger.nextTriggerGate(restored, { type: "changed", change: { cause: "caret", snapshot } }, true);
    assert.equal(trigger.openTrigger(moved, true), null);
    const edited = trigger.nextTriggerGate(
      moved,
      {
        type: "changed",
        change: {
          cause: "edit",
          snapshot: {
            text: changed,
            masked: changed,
            caret: { kind: "caret", offset: changed.length },
          },
        },
      },
      true,
    );
    assert.equal(trigger.openTrigger(edited, true)?.kind, text.startsWith("/") ? "slash" : "at");
  }
});
