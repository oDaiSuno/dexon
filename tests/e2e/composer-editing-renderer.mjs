import { createElement, createRef } from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { ChatInput } from "../../src/renderer/components/ChatInput.tsx";
import { setAppLanguage } from "../../src/renderer/i18n.ts";
import { installApiShims } from "../../src/renderer/lib/api-fetch.ts";
import { resetRpc } from "../../src/renderer/lib/api-client.ts";
import { installRendererApi } from "../support/renderer-api.mjs";
import { allByRole, getByRole } from "../support/dom-queries.mjs";
import "./production-styles.mjs";

const window = globalThis.window;
const document = globalThis.document;
setAppLanguage("en-US");

const PROJECT_FILES = ["src/main.ts", "src/renderer/App.tsx", "README.md"];
const SKILLS = ["fast-context", "groksearch"].map((name) => ({
  name,
  description: "Installed skill",
  filePath: `/skills/${name}/SKILL.md`,
  baseDir: `/skills/${name}`,
  disableModelInvocation: false,
  sourceInfo: { scope: "user" },
}));

const sent = [];
const staged = [];
const revealed = [];
let sendReply = () => undefined;
let stagedCount = 0;

// Only the other process answers here: project search, installed skills,
// clipboard image staging and the OS file reveal. The composer stays real.
const boundary = installRendererApi(
  window,
  { installApiShims, resetRpc },
  () => ({
    call(method) {
      if (method === "skills.list") return { skills: SKILLS };
      if (method === "files.index") return { files: PROJECT_FILES, truncated: false };
      throw new Error(`Unexpected composer Host request: ${method}`);
    },
  }),
  {
    bridge: {
      getPathForFile: (file) => file.testPath ?? "",
      async stageClipboardImage(request) {
        stagedCount += 1;
        const path = `/tmp/pi-clipboard-${stagedCount}.${request.ext}`;
        staged.push({ ext: request.ext, bytes: request.base64.length, path });
        return { ok: true, staged: { path } };
      },
      inspectLocalFiles: async ({ paths }) =>
        paths.map((path) => ({ path, exists: true, isFile: true, insideCwd: false })),
      showItemInFolder: async (path) => void revealed.push(path),
    },
  },
);

const root = createRoot(document.getElementById("root"));
const handle = createRef();
let props = { draftKey: "composer-a", visible: true, epoch: 0 };

function render() {
  flushSync(() =>
    root.render(
      createElement(
        "div",
        { style: { position: "fixed", left: "50%", bottom: 24, width: 760, transform: "translateX(-50%)" } },
        createElement(ChatInput, {
          key: props.epoch,
          ref: handle,
          cwd: "/workspace/project",
          draftKey: props.draftKey,
          visible: props.visible,
          isStreaming: false,
          model: { provider: "fixture", modelId: "fixture-model" },
          modelList: [{ id: "fixture-model", name: "Fixture", provider: "fixture" }],
          onAbort() {},
          onSend(message) {
            sent.push(message);
            return sendReply(message);
          },
        }),
      ),
    ),
  );
}

function composer() {
  return getByRole(document, "group", "Message input");
}

function editor() {
  return getByRole(composer(), "textbox");
}

function isChip(node) {
  return (
    node.nodeType === 1 && node.getAttribute("role") === "button" && node.getAttribute("contenteditable") === "false"
  );
}

function visibleText(node) {
  if (node.nodeType === 3) return node.data;
  if (isChip(node)) return `[${node.textContent.trim()}]`;
  if (node.nodeName === "BR") return "\n";
  const inner = [...node.childNodes].map(visibleText).join("");
  return node !== editor() && /^(DIV|P)$/.test(node.nodeName) ? `\n${inner}` : inner;
}

function chips() {
  return allByRole(editor(), "button")
    .filter((element) => !element.parentElement.closest('[role="button"]'))
    .map((element) => element.textContent.trim());
}

window.composerEditing = {
  configure(next = {}) {
    props = { ...props, ...next };
    render();
  },
  remount(next = {}) {
    sent.length = 0;
    staged.length = 0;
    revealed.length = 0;
    sendReply = () => undefined;
    props = { ...props, ...next, epoch: props.epoch + 1 };
    render();
  },
  focus() {
    editor().focus();
  },
  placeCaretAtEnd() {
    const range = document.createRange();
    range.selectNodeContents(editor());
    range.collapse(false);
    const selection = document.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
  },
  selectAll() {
    editor().focus();
    document.getSelection().selectAllChildren(editor());
  },
  view() {
    const element = editor();
    return {
      text: visibleText(element).replace(/\n$/, ""),
      chips: chips(),
      focused: document.activeElement === element,
    };
  },
  chipCenter(name) {
    const chip = allByRole(editor(), "button", name)[0];
    if (!chip) throw new Error(`No chip named ${name}`);
    const box = chip.getBoundingClientRect();
    return { x: Math.round(box.x + box.width / 2), y: Math.round(box.y + box.height / 2) };
  },
  removeButtonCenter(name) {
    const chip = allByRole(editor(), "button", name)[0];
    if (!chip) throw new Error(`No chip named ${name}`);
    const remove = allByRole(chip, "button").find((element) => element !== chip);
    const box = remove.getBoundingClientRect();
    return { x: Math.round(box.x + box.width / 2), y: Math.round(box.y + box.height / 2) };
  },
  elementCenter(role, name) {
    const element = getByRole(document, role, name);
    const box = element.getBoundingClientRect();
    return { x: Math.round(box.x + box.width / 2), y: Math.round(box.y + box.height / 2) };
  },
  menuItemCenter(itemName, menuName) {
    const menus = menuName === undefined ? allByRole(document, "menu") : [getByRole(document, "menu", menuName)];
    const item = menus
      .flatMap((menu) => allByRole(menu, "menuitem"))
      .find((element) => element.textContent.includes(itemName));
    if (!item) return null;
    const box = item.getBoundingClientRect();
    return { x: Math.round(box.x + box.width / 2), y: Math.round(box.y + box.height / 2) };
  },
  optionCenter(label) {
    const option = allByRole(document, "button").find((element) => element.textContent.includes(label));
    if (!option) throw new Error(`No suggestion ${label}`);
    const box = option.getBoundingClientRect();
    return { x: Math.round(box.x + box.width / 2), y: Math.round(box.y + box.height / 2) };
  },
  hasSuggestion(label) {
    return allByRole(document, "button").some((element) => element.textContent.includes(label));
  },
  addFiles(files) {
    return handle.current.addFiles(files);
  },
  insertIfEmpty(text) {
    handle.current.insertIfEmpty(text);
  },
  sendFails(enabled) {
    sendReply = enabled ? () => ({ ok: false }) : () => undefined;
  },
  sent: () => [...sent],
  staged: () => structuredClone(staged),
  revealed: () => [...revealed],
  storedDraft(key) {
    const raw = window.localStorage.getItem(`dexon-draft:${key}`);
    return raw ? JSON.parse(raw).value : null;
  },
  bannerText() {
    return allByRole(document, "alert").map((element) => element.textContent.trim());
  },
  close() {
    try {
      flushSync(() => root.unmount());
    } finally {
      boundary.close();
    }
  },
};
render();
