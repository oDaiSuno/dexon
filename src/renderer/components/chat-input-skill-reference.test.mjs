import { restoreGlobals, harness, rootEl } from "./chat-input-file-reference.harness.mjs";
import { importTestBundle } from "#test-bundle";
import assert from "node:assert/strict";
import path from "node:path";
import test, { after, afterEach, beforeEach } from "node:test";
import { createElement, createRef } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import {
  allByRole,
  button,
  click,
  input,
  keyDown,
  mouseDown,
  text,
  waitFor,
} from "../../../tests/support/dom-events.mjs";

// The composer is a contenteditable surface; the jsdom harness (imported
// first) provides the real DOM environment before the bundle loads.
const dom = harness.dom;

const { ChatInput, resetDraftCache, installApiShims, resetRpc } = await importTestBundle(
  "src/renderer/components/chat-input-skill-reference",
  {
    stdin: {
      contents:
        'export { ChatInput } from "./ChatInput.tsx"; export { resetDraftCache } from "../lib/draft-store.ts"; export {installApiShims} from "../lib/api-fetch.ts"; export {resetRpc} from "../lib/api-client.ts";',
      resolveDir: import.meta.dirname,
      sourcefile: "chat-input-skill-reference-test-entry.tsx",
      loader: "tsx",
    },
    tsconfig: path.join(import.meta.dirname, "../../../tsconfig.renderer.json"),
    external: ["react", "react-dom", "react-dom/*"],
  },
);
const installedSkills = ["fast-context", "groksearch"].map((name) => ({
  name,
  description: "Installed skill",
  filePath: `/skills/${name}/SKILL.md`,
  baseDir: `/skills/${name}`,
  disableModelInvocation: false,
  sourceInfo: { scope: "user" },
}));
let skillsReply = () => ({ skills: installedSkills });
harness.connectApi({ installApiShims, resetRpc }, { skills: () => skillsReply() });

const editorEl = () => rootEl.querySelector('[role="textbox"][aria-multiline="true"]');

let mounted = null;

async function mount(props = {}) {
  const handle = createRef();
  const element = createElement(ChatInput, {
    cwd: props.cwd === undefined ? "/workspace/project" : props.cwd,
    isStreaming: false,
    onAbort() {},
    onSend(message) {
      (props.sent ?? []).push(message);
    },
    navigation: props.navigation,
    ref: handle,
  });
  await act(async () => {
    mounted = createRoot(rootEl);
    mounted.render(element);
  });
  return handle;
}

async function unmount() {
  if (!mounted) return;
  const root = mounted;
  mounted = null;
  await act(async () => {
    root.unmount();
  });
  rootEl.textContent = "";
}

/** Put plain text into the editor with the caret at `caret` (default: end). */
async function setEditorText(text, caret = text.length) {
  const el = editorEl();
  el.textContent = text;
  const sel = dom.window.getSelection();
  const range = dom.window.document.createRange();
  if (el.firstChild) range.setStart(el.firstChild, caret);
  else range.setStart(el, 0);
  range.collapse(true);
  sel.removeAllRanges();
  sel.addRange(range);
  await act(async () => {
    el.dispatchEvent(new dom.window.InputEvent("input", { bubbles: true }));
  });
}

// An interrupted case must not leave its mounted root alive past the shared
// environment restore (ASTRA-R10-F001).
afterEach(() => unmount());
after(restoreGlobals);
// Each case owns its request history, storage and draft cache (ASTRA-R5-F001).
beforeEach(() => {
  skillsReply = () => ({ skills: installedSkills });
  harness.resetRequests();
  harness.storedValues.clear();
  resetDraftCache();
});

test("an open /skill query stays plain text so the slash palette keeps working", async () => {
  await mount();
  await setEditorText("/skill:fast");
  assert.equal(allByRole(editorEl(), "button", "Remove skill").length, 0, "the command is still open");
  assert.equal(editorEl().textContent, "/skill:fast");
  await unmount();
});

test("mid-message /skill text is prose, not a command chip", async () => {
  await mount();
  await setEditorText("请先读 /skill:fast-context 说明 ");
  assert.equal(allByRole(editorEl(), "button", "Remove skill").length, 0);
  assert.equal(editorEl().textContent, "请先读 /skill:fast-context 说明 ");
  await unmount();
});

const plusButton = () => rootEl.querySelector('button[aria-label="Add images or local file references"]');
const plusRow = (name) => allByRole(rootEl, "menuitem").find((row) => row.textContent?.includes(name));
const skillPicker = () => allByRole(rootEl, "menu", "Use a skill")[0];

async function openSkillPicker() {
  await click(plusButton());
  await mouseDown(plusRow("Use a skill"));
  return waitFor(() => {
    const picker = skillPicker();
    assert.ok(Boolean(picker), "the skill picker is open");
    return picker;
  });
}

test("the ＋ menu shows how many skills are installed before the skill picker is opened", async () => {
  await mount();
  await click(plusButton());
  await waitFor(() => assert.match(plusRow("Use a skill").textContent, /Use a skill.*2/));
});

test("pressing Enter while the ＋ menu is open opens the highlighted skill row instead of sending the draft", async () => {
  const sent = [];
  await mount({ sent });
  await setEditorText("draft that must stay");
  await click(plusButton());
  await keyDown(editorEl(), "Enter");
  assert.deepEqual(sent, [], "the draft is not sent while the menu is open");
  await waitFor(() => assert.ok(Boolean(skillPicker()), "Use a skill is highlighted when the menu opens"));
});

test("the arrow keys move the ＋ menu highlight and Enter picks the row it lands on", async () => {
  await mount();
  await click(plusButton());
  await keyDown(editorEl(), "ArrowUp");
  await keyDown(editorEl(), "Enter");
  assert.equal(Boolean(skillPicker()), false, "Add files was picked, so no skill picker opens");
  assert.equal(Boolean(plusRow("Add files")), false, "picking a row closes the menu");
});

test("the skill picker counts installed skills and its Back button returns to the ＋ menu", async () => {
  await mount();
  const picker = await openSkillPicker();
  await waitFor(() => assert.ok(Boolean(text(picker, "2 skills")), "the header counts the installed skills"));
  await click(button(picker, "Back"));
  assert.equal(Boolean(skillPicker()), false, "the skill picker is closed");
  assert.ok(Boolean(plusRow("Add files")), "the ＋ menu rows are shown again");
  assert.ok(Boolean(plusRow("Use a skill")));
});

test("a failed skill list can be retried from the skill picker", async () => {
  skillsReply = () => {
    throw new Error("skills unavailable");
  };
  await mount();
  const picker = await openSkillPicker();
  await waitFor(() => assert.ok(Boolean(text(picker, "Failed to load skills")), "the failure is explained"));
  skillsReply = () => ({ skills: installedSkills });
  await click(button(picker, "Retry"));
  await waitFor(() =>
    assert.deepEqual(
      allByRole(skillPicker(), "menuitem").map((row) => row.textContent?.match(/fast-context|groksearch/)?.[0]),
      ["fast-context", "groksearch"],
    ),
  );
});

test("a search with no matching skill names the keyword and leads to Plugins & Skills", async () => {
  const opened = [];
  await mount({
    navigation: { openResources: () => opened.push("resources"), openRemote() {}, openModelSettings() {} },
  });
  const picker = await openSkillPicker();
  await waitFor(() => assert.equal(allByRole(picker, "menuitem").length, 2));
  assert.ok(Boolean(button(picker, "Manage skills")), "the footer links to skill management");
  await input(picker.querySelector("input"), "deploy");
  assert.ok(Boolean(text(picker, "No skills match “deploy”")), "the empty result names the keyword");
  await click(button(picker, "Open Plugins & Skills"));
  assert.deepEqual(opened, ["resources"]);
  assert.equal(Boolean(skillPicker()), false, "leaving for Plugins & Skills closes the picker");
});
