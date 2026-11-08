import { restoreGlobals, harness, rootEl } from "./chat-input-file-reference.harness.mjs";
import { importTestBundle } from "#test-bundle";
import assert from "node:assert/strict";
import path from "node:path";
import test, { after, afterEach } from "node:test";

const {
  applyComposerEdit,
  createTokenChip,
  createSkillChip,
  planReplaceAll,
  readComposerText,
  readSnapshot,
  resetComposerContent,
} = await importTestBundle("chat-input-composer-edit", {
  stdin: {
    contents:
      'export { applyComposerEdit, planReplaceAll, resetComposerContent } from "./chat-input/composer-edit.ts"; export { createTokenChip, createSkillChip } from "./chat-input/composer-dom.ts"; export { readComposerText, readSnapshot } from "./chat-input/composer-text-map.ts";',
    resolveDir: import.meta.dirname,
    sourcefile: "chat-input-composer-edit-test-entry.ts",
    loader: "ts",
  },
  tsconfig: path.join(import.meta.dirname, "../../../tsconfig.renderer.json"),
});

const doc = harness.dom.window.document;
const chips = {
  attachment: (filePath) =>
    createTokenChip(filePath, {
      isImage: false,
      previewUrl: null,
      missing: false,
      title: filePath,
      removeLabel: "Remove",
    }),
  skill: (name) => createSkillChip(name, { description: null, removeLabel: "Remove skill" }),
};

afterEach(() => rootEl.replaceChildren());
after(() => restoreGlobals());

function editorWith(text) {
  const editor = doc.createElement("div");
  editor.setAttribute("contenteditable", "true");
  rootEl.append(editor);
  resetComposerContent(editor, text, chips);
  editor.focus();
  return editor;
}

for (const nativeMode of ["missing", "false", "no-op"]) {
  test(`a partial edit preserves surrounding text and its exact caret when native editing is ${nativeMode}`, (t) => {
    if (nativeMode !== "missing") {
      Object.defineProperty(doc, "execCommand", {
        configurable: true,
        value: () => nativeMode === "no-op",
      });
      t.after(() => delete doc.execCommand);
    }
    const editor = editorWith("before OLD after @/tmp/kept.md ");
    const applied = applyComposerEdit(
      editor,
      { start: 7, end: 10, content: [{ type: "attachment", path: "/tmp/new file.md" }], caretFromEnd: 0 },
      chips,
    );

    assert.equal(applied, true);
    assert.deepEqual(readSnapshot(editor), {
      text: 'before @"/tmp/new file.md" after @/tmp/kept.md ',
      masked: `before ${"\uFFFC".repeat(19)} after ${"\uFFFC".repeat(13)} `,
      caret: { kind: "caret", offset: 26 },
    });
    assert.deepEqual(
      Array.from(editor.querySelectorAll('[role="button"][title]:not([aria-label])'), (chip) => chip.title),
      ["/tmp/new file.md", "/tmp/kept.md"],
    );
  });
}

test("a partial edit keeps an inserted trailing newline before the untouched suffix", () => {
  const editor = editorWith("before OLD after");
  assert.equal(
    applyComposerEdit(editor, { start: 7, end: 10, content: [{ type: "text", text: "NEW\n" }] }, chips),
    true,
  );
  assert.deepEqual(readSnapshot(editor), {
    text: "before NEW\n after",
    masked: "before NEW\n after",
    caret: { kind: "caret", offset: 11 },
  });
});

for (const { name, content, caretFromEnd, text, offset } of [
  { name: "deleting a selection", content: [], text: "before  after", offset: 7 },
  {
    name: "placing the caret inside inserted text",
    content: [{ type: "text", text: "NEW" }],
    caretFromEnd: 1,
    text: "before NEW after",
    offset: 9,
  },
  {
    name: "clamping the requested caret to the start",
    content: [{ type: "text", text: "NEW" }],
    caretFromEnd: 100,
    text: "before NEW after",
    offset: 0,
  },
]) {
  test(`fallback supports ${name}`, () => {
    const editor = editorWith("before OLD after");
    assert.equal(applyComposerEdit(editor, { start: 7, end: 10, content, caretFromEnd }, chips), true);
    assert.deepEqual(readSnapshot(editor), { text, masked: text, caret: { kind: "caret", offset } });
    assert.equal(doc.activeElement, editor);
  });
}

test("replacing the whole draft preserves a final newline and places the caret after it", () => {
  const editor = editorWith("old");
  const request = planReplaceAll(readComposerText(editor), "new\n");
  assert.equal(applyComposerEdit(editor, request, chips), true);
  assert.deepEqual(readSnapshot(editor), {
    text: "new\n",
    masked: "new\n",
    caret: { kind: "caret", offset: 4 },
  });
});

test("an edit raised during a native input event cannot run a recursive fallback", (t) => {
  const editor = editorWith("before OLD after");
  let nestedResult;
  editor.addEventListener("input", () => {
    nestedResult = applyComposerEdit(editor, { start: 0, end: 0, content: [{ type: "text", text: "leak " }] }, chips);
  });
  Object.defineProperty(doc, "execCommand", {
    configurable: true,
    value: () => {
      editor.dispatchEvent(new harness.dom.window.InputEvent("input", { bubbles: true }));
      return true;
    },
  });
  t.after(() => delete doc.execCommand);

  assert.equal(applyComposerEdit(editor, { start: 7, end: 10, content: [{ type: "text", text: "NEW" }] }, chips), true);
  assert.equal(nestedResult, false);
  assert.deepEqual(readSnapshot(editor), {
    text: "before NEW after",
    masked: "before NEW after",
    caret: { kind: "caret", offset: 10 },
  });
});
