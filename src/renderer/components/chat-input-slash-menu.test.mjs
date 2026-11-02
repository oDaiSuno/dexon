import { restoreGlobals, harness, rootEl } from "./chat-input-file-reference.harness.mjs";
import { importTestBundle } from "#test-bundle";
import assert from "node:assert/strict";
import path from "node:path";
import test, { after, afterEach, beforeEach } from "node:test";
import { createElement } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { keyDown } from "../../../tests/support/dom-events.mjs";

const dom = harness.dom;

const { ChatInput, resetDraftCache, installApiShims, resetRpc, setAppLanguage } = await importTestBundle(
  "src/renderer/components/chat-input-slash-menu",
  {
    stdin: {
      contents:
        'export { ChatInput } from "./ChatInput.tsx"; export { resetDraftCache } from "../lib/draft-store.ts"; export {installApiShims} from "../lib/api-fetch.ts"; export {resetRpc} from "../lib/api-client.ts"; export {setAppLanguage} from "../i18n.ts";',
      resolveDir: import.meta.dirname,
      sourcefile: "chat-input-slash-menu-test-entry.tsx",
      loader: "tsx",
    },
    tsconfig: path.join(import.meta.dirname, "../../../tsconfig.renderer.json"),
    external: ["react", "react-dom", "react-dom/*"],
  },
);
const installedSkills = ["poteto-mode", "poteto-help"].map((name) => ({
  name,
  description: "Installed skill",
  filePath: `/skills/${name}/SKILL.md`,
  baseDir: `/skills/${name}`,
  disableModelInvocation: true,
}));
let skillsReply = () => ({ skills: installedSkills });
harness.connectApi({ installApiShims, resetRpc }, { skills: () => skillsReply() });

const sourceInfo = { path: "/plugins/x", source: "local", scope: "user", origin: "top-level" };
const pluginCommands = [
  { name: "subagents", description: "Split a big task across sub agents", source: "extension", sourceInfo },
  {
    name: "review-pr",
    description: "Review the current pull request",
    source: "prompt",
    sourceInfo,
    argumentHint: "<pr-number>",
  },
  { name: "explain", description: "Explain the selected code", source: "prompt", sourceInfo },
];

const editorEl = () => rootEl.querySelector('[role="textbox"][aria-multiline="true"]');
let mounted = null;
let props;

async function mount(options = {}) {
  props = {
    cwd: "/workspace/project",
    isStreaming: false,
    onAbort() {},
    onSend() {},
    slashCommands: pluginCommands,
    ...options,
  };
  await act(async () => {
    mounted = createRoot(rootEl);
    mounted.render(createElement(ChatInput, props));
  });
}

async function unmount() {
  if (!mounted) return;
  const root = mounted;
  mounted = null;
  await act(async () => root.unmount());
  rootEl.textContent = "";
}

async function update(next) {
  props = { ...props, ...next };
  await act(async () => mounted.render(createElement(ChatInput, props)));
}

async function type(text, caret = text.length) {
  const el = editorEl();
  await act(async () => {
    el.focus();
    el.textContent = text;
    const range = dom.window.document.createRange();
    range.setStart(el.firstChild, caret);
    range.collapse(true);
    dom.window.getSelection().removeAllRanges();
    dom.window.getSelection().addRange(range);
    el.dispatchEvent(new dom.window.InputEvent("input", { bubbles: true }));
  });
}

const palette = () =>
  rootEl.querySelector('[role="group"][aria-label^="Slash commands"], [role="group"][aria-label^="斜杠命令"]');
const card = (name) =>
  [...palette().querySelectorAll("button")].find((button) => button.textContent.startsWith(`/${name}`));

afterEach(async () => {
  await unmount();
  setAppLanguage("en-US");
});
after(restoreGlobals);
beforeEach(() => {
  setAppLanguage("en-US");
  harness.resetRequests();
  harness.storedValues.clear();
  resetDraftCache();
  skillsReply = () => ({ skills: installedSkills });
});

test("when nothing matches the typed command, the palette says no command is related to it", async () => {
  await mount();
  await type("/deploy");
  assert.match(palette().textContent, /No commands or skills match “\/deploy”/);
});

test("in Chinese, when nothing matches the typed command, the palette says no command is related to it", async () => {
  setAppLanguage("zh-CN");
  await mount();
  await type("/deploy");
  assert.match(palette().textContent, /没有匹配“\/deploy”的命令或技能/);
});

test("built-in commands that take text show what to type after the name, and commands without arguments show nothing extra", async () => {
  setAppLanguage("zh-CN");
  await mount();
  await type("/");
  assert.match(card("compact").textContent, /^\/compact‹说明›/);
  assert.match(card("name").textContent, /^\/name‹名称›/);
  assert.doesNotMatch(card("session").textContent, /‹/);
  assert.doesNotMatch(card("copy").textContent, /‹/);
  assert.doesNotMatch(card("reload").textContent, /‹/);
});

test("in English, built-in commands that take text show what to type after the name", async () => {
  await mount();
  await type("/");
  assert.match(card("compact").textContent, /^\/compact‹instructions›/);
  assert.match(card("name").textContent, /^\/name‹name›/);
});

test("plugin commands show their own argument hint when they have one and nothing when they do not", async () => {
  await mount();
  await type("/");
  assert.match(card("review-pr").textContent, /^\/review-pr<pr-number>Review the current pull request/);
  assert.match(card("explain").textContent, /^\/explainExplain the selected code/);
  assert.match(card("subagents").textContent, /^\/subagentsSplit a big task across sub agents/);
});

test("typing a bare skill prefix recommends skills immediately without typing skill:", async () => {
  await mount();
  await type("/potet");
  assert.ok(card("skill:poteto-help"));
  assert.ok(card("skill:poteto-mode"));
  assert.equal(palette().querySelector("button").textContent.startsWith("/skill:poteto-help"), true);
  assert.equal(card("skill:poteto-help").querySelector(".type-mono-label-strong").textContent, "potet");
});

test("matching still finds a command whose name only contains the typed text", async () => {
  await mount();
  await type("/agent");
  assert.ok(card("subagents"));
});

test("bare slash shows four source groups and the approved skill-only hint in both languages", async () => {
  for (const [language, labels, title] of [
    ["en-US", ["Built-in", "Extensions", "Prompts", "Skills"], "Commands & skills"],
    ["zh-CN", ["内置", "扩展", "提示词", "技能"], "命令与技能"],
  ]) {
    setAppLanguage(language);
    await mount();
    await type("/");
    assert.deepEqual(
      [...palette().querySelectorAll("section .type-meta-caps")].map((node) => node.textContent),
      labels,
    );
    assert.ok(palette().textContent.includes(title));
    assert.match(palette().textContent, /\/skill:/);
    await unmount();
  }
});

test("skill scope and full-label matching share the same recommendations and correct highlight spans", async () => {
  await mount();
  await type("/skill:pot");
  assert.equal(palette().querySelectorAll("button").length, 2);
  assert.equal(card("skill:poteto-help").querySelector(".type-mono-label-strong").textContent, "pot");
  await type("/ski");
  assert.equal(card("skill:poteto-help").querySelector(".type-mono-label-strong").textContent, "ski");
  await type("/mode");
  assert.ok(card("skill:poteto-mode"));
  assert.equal(card("skill:poteto-mode").querySelector(".type-mono-label-strong").textContent, "mode");
  await type("/pmode");
  assert.equal(palette().querySelectorAll("button").length, 0);
});

test("the caret can open recommendations before a trailing prompt but not in a word, path or selected text", async () => {
  await mount();
  await type("/potet explain this", 6);
  assert.ok(card("skill:poteto-help"));
  await type("/poteto", 4);
  assert.equal(palette(), null);
  await type("/etc/hosts");
  assert.equal(palette(), null);
  await type("/potet");
  const range = dom.window.document.createRange();
  range.setStart(editorEl().firstChild, 1);
  range.setEnd(editorEl().firstChild, 6);
  dom.window.getSelection().removeAllRanges();
  dom.window.getSelection().addRange(range);
  await act(async () => {
    editorEl().dispatchEvent(new dom.window.InputEvent("input", { bubbles: true }));
  });
  assert.equal(palette(), null);
});

const activeCard = () =>
  [...palette().querySelectorAll("button")].find((node) => node.querySelector("kbd")?.textContent === "↵");

test("narrowing the query resets the highlight to the best match instead of clamping it to the last match", async () => {
  await mount();
  await type("/");
  for (let count = 0; count < 8; count += 1) await keyDown(editorEl(), "ArrowRight");
  await type("/potet");
  assert.ok(activeCard().textContent.startsWith("/skill:poteto-help"));
});

test("a selected skill keeps its identity when a late command result changes its position", async () => {
  await mount({ slashCommands: [], slashCommandsLoading: true });
  await type("/potet");
  assert.ok(card("skill:poteto-help"), "loaded skills remain visible while commands are loading");
  await keyDown(editorEl(), "ArrowRight");
  assert.ok(activeCard().textContent.startsWith("/skill:poteto-mode"));
  await update({ slashCommands: [{ name: "potet", source: "extension" }], slashCommandsLoading: false });
  assert.ok(activeCard().textContent.startsWith("/skill:poteto-mode"));
  assert.ok(palette().querySelector("button").textContent.startsWith("/potet"));
});

test("Enter and Tab cannot send an unmatched command, but Escape allows sending it as plain text", async () => {
  const sent = [];
  await mount({
    onSend(message) {
      sent.push(message);
    },
  });
  await type("/poteto-mdoe");
  assert.equal((await keyDown(editorEl(), "Tab")).defaultPrevented, true);
  assert.equal((await keyDown(editorEl(), "Enter")).defaultPrevented, true);
  assert.deepEqual(sent, []);
  assert.match(palette().textContent, /Enter blocked to prevent accidental send/);
  await keyDown(editorEl(), "Escape");
  assert.equal(palette(), null);
  await keyDown(editorEl(), "Enter");
  assert.deepEqual(sent, ["/poteto-mdoe"]);
});

test("an empty loading palette blocks Enter and Tab without blocking Shift Enter", async () => {
  let finish;
  skillsReply = () =>
    new Promise((resolve) => {
      finish = resolve;
    });
  const sent = [];
  await mount({
    slashCommandsLoading: true,
    onSend(message) {
      sent.push(message);
    },
  });
  await type("/potet");
  assert.match(palette().textContent, /Reading commands/);
  assert.equal((await keyDown(editorEl(), "Enter")).defaultPrevented, true);
  assert.equal((await keyDown(editorEl(), "Tab")).defaultPrevented, true);
  assert.equal((await keyDown(editorEl(), "Enter", { shiftKey: true })).defaultPrevented, false);
  assert.deepEqual(sent, []);
  await act(async () => finish({ skills: installedSkills }));
  assert.ok(card("skill:poteto-help"));
});

test("slash menu arrows run before history navigation and closing the menu restores history keys", async () => {
  await mount({ promptHistory: [{ text: "older prompt", at: 1 }] });
  await type("/potet");
  for (const key of ["ArrowUp", "ArrowDown", "ArrowRight", "ArrowLeft"]) {
    assert.equal((await keyDown(editorEl(), key)).defaultPrevented, true);
    assert.equal(editorEl().textContent, "/potet");
    assert.ok(palette());
  }
  assert.equal(dom.window.getSelection().anchorOffset, 6);
  await keyDown(editorEl(), "Escape");
  assert.equal(palette(), null);
  await keyDown(editorEl(), "ArrowUp");
  await keyDown(editorEl(), "ArrowUp");
  assert.equal(editorEl().textContent, "older prompt");
  assert.equal(palette(), null);
  await keyDown(editorEl(), "Escape");
  assert.equal(editorEl().textContent, "/potet");
  assert.equal(palette(), null);
});

test("a restored leading slash query stays closed until an edit requests completion", async () => {
  harness.storedValues.set("dexon-draft:restored-slash", JSON.stringify({ schemaVersion: 3, value: "/potet" }));
  await mount({ draftKey: "restored-slash" });
  assert.equal(palette(), null);
  await type("/poteto");
  assert.ok(card("skill:poteto-help"));
});
