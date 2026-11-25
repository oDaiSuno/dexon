import assert from "node:assert/strict";
import test, { after } from "node:test";
import { act, byRole, click, dom, loadRenderer, mount, restoreGlobals, settle } from "../support/renderer.mjs";

const { ToolCallBlock, setAppLanguage } = await loadRenderer(
  "codemode-row",
  'export { ToolCallBlock } from "./src/renderer/components/messages/ToolCallBlock.tsx";',
);
setAppLanguage("en-US");
after(restoreGlobals);

const code = 'const answer = 42;\nconsole.log("answer", answer);';
const block = { type: "toolCall", toolCallId: "code-1", toolName: "codemode", input: { code } };
const props = { block, stateKey: "code-1" };
const read = { id: "read-1", name: "read", args: '{"path":"src/app.ts"}', status: "ok", durationMs: 200 };
const terminal = { id: "bash-1", name: "bash", args: '{"command":"npm test"}', status: "running" };

function payload(calls, text = "") {
  return { content: text ? [{ type: "text", text }] : [], details: { calls } };
}

function result(calls, text, extra = {}) {
  return { role: "toolResult", toolCallId: "code-1", toolName: "codemode", ...payload(calls, text), ...extra };
}

async function expand(view) {
  const row = byRole(view.container, "button", /^(Run script|Stopped script)/);
  assert.equal(row.getAttribute("aria-expanded"), "false");
  await click(row);
  await settle();
  assert.equal(row.getAttribute("aria-expanded"), "true");
  return row;
}

test("a running script counts only successful steps and hides source and raw JSON while collapsed", async (t) => {
  const view = await mount(t, ToolCallBlock, {
    ...props,
    liveUpdate: {
      toolCallId: "code-1",
      startedAt: Date.now(),
      partialResult: payload([
        read,
        { id: "failed-1", name: "read", args: '{"path":"missing.txt"}', status: "error" },
        { id: "cancelled-1", name: "ls", args: "{}", status: "cancelled" },
        terminal,
      ]),
    },
  });
  const row = byRole(view.container, "button", /Run script/);
  assert.ok(row);
  assert.match(row.textContent, /Running: Terminal npm test · 1 steps completed/);
  assert.doesNotMatch(row.textContent, /4 steps completed/);
  assert.equal(row.getAttribute("aria-expanded"), "false");
  assert.doesNotMatch(view.container.textContent, /const answer|console\.log|read-1|"path"|"calls"/);
  assert.equal(byRole(view.container, "region", "Execution steps"), undefined);
  assert.equal(view.container.querySelector("pre"), null);
});

test("expanding a result strips the runtime header and lets the reader reveal, hide and copy source", async (t) => {
  const writes = [];
  const original = Object.getOwnPropertyDescriptor(dom.window.navigator, "clipboard");
  Object.defineProperty(dom.window.navigator, "clipboard", {
    configurable: true,
    value: { writeText: async (text) => writes.push(text) },
  });
  t.after(() => {
    if (original) Object.defineProperty(dom.window.navigator, "clipboard", original);
    else delete dom.window.navigator.clipboard;
  });
  const view = await mount(t, ToolCallBlock, {
    ...props,
    result: result([read], "Script completed. Wall time 0.2 seconds\nOutput:\nanswer 42"),
  });
  await expand(view);
  assert.ok(byRole(view.container, "heading", "Execution steps · 1"));
  const output = byRole(view.container, "region", "Results");
  assert.ok(output);
  assert.equal(output.querySelector("pre").textContent, "answer 42");
  assert.doesNotMatch(view.container.textContent, /Script completed|Wall time|Output:|const answer/);
  await click(byRole(output, "button", "Copy output"));
  await settle();
  assert.deepEqual(writes, ["answer 42"]);
  const source = byRole(view.container, "button", /View script source/);
  assert.equal(source.getAttribute("aria-expanded"), "false");
  assert.match(source.textContent, /JavaScript · 2 lines/);
  await click(source);
  assert.equal(source.getAttribute("aria-expanded"), "true");
  assert.ok(byRole(view.container, "button", /^Script source/));
  const sourcePanel = dom.window.document.getElementById(source.getAttribute("aria-controls"));
  assert.equal(sourcePanel.getAttribute("aria-hidden"), "false");
  assert.match(sourcePanel.textContent, /const answer = 42;/);
  assert.match(sourcePanel.textContent, /console\.log\("answer", answer\);/);
  await click(byRole(view.container, "button", "Copy code"));
  assert.deepEqual(writes, ["answer 42", code]);
  await click(source);
  assert.equal(source.getAttribute("aria-expanded"), "false");
  assert.equal(sourcePanel.getAttribute("aria-hidden"), "true");
  assert.ok(sourcePanel.hasAttribute("inert"));
});

test("a failed step owns one error callout and preserves stdout separately", async (t) => {
  const failure = "Error: permission denied\n    at run (sandbox.js:2:1)";
  const view = await mount(t, ToolCallBlock, {
    ...props,
    result: result(
      [read, { ...terminal, status: "error", error: "Error: permission denied", durationMs: 300 }],
      `Script failed. Wall time 0.5 seconds\nOutput:\nloaded configuration\nScript error:\n${failure}`,
      { isError: true },
    ),
  });
  await expand(view);
  const steps = byRole(view.container, "region", "Execution steps");
  assert.ok(byRole(steps, "heading", "Execution steps · 1 succeeded · 1 failed · 0 cancelled"));
  const items = [...steps.querySelectorAll("li")];
  const callouts = [...view.container.querySelectorAll('[role="status"]')];
  assert.equal(items.length, 2);
  assert.equal(callouts.length, 1);
  assert.ok(items[1].contains(callouts[0]));
  assert.equal(items[0].querySelector('[role="status"]'), null);
  assert.match(callouts[0].textContent, /Failed/);
  assert.equal(callouts[0].querySelector("pre").textContent, failure);
  const output = byRole(view.container, "region", "Output produced before failure");
  assert.equal(output.querySelector("pre").textContent, "loaded configuration");
  assert.doesNotMatch(output.textContent, /permission denied|Script error|Script failed|Wall time/);
});

test("file and full-output links retain the environment while browser links dispatch a tab event", async (t) => {
  const opened = [];
  const tabs = [];
  const onTab = (event) => tabs.push(event.detail);
  dom.window.addEventListener("dexon:open-browser-tab", onTab);
  t.after(() => dom.window.removeEventListener("dexon:open-browser-tab", onTab));
  const calls = [
    read,
    { id: "edit-1", name: "edit", args: '{"path":"src/view.tsx"}', status: "ok" },
    { id: "write-1", name: "write", args: '{"path":"notes/result.txt"}', status: "ok" },
    { id: "browser-1", name: "browser_snapshot", args: '{"tabId":"tab-7"}', status: "ok" },
  ];
  const view = await mount(t, ToolCallBlock, {
    ...props,
    cwd: "/workspace/project",
    environmentId: "remote-fixture",
    onOpenFile: (...args) => opened.push(args),
    result: result(calls, "shortened output", {
      details: { calls, fullOutputPath: "/tmp/codemode-full.txt" },
    }),
  });
  await expand(view);
  await click(byRole(view.container, "button", "src/app.ts"));
  await click(byRole(view.container, "button", "src/view.tsx"));
  await click(byRole(view.container, "button", "notes/result.txt"));
  await click(byRole(view.container, "button", "Tab tab-7"));
  await click(byRole(view.container, "button", /Open full output in the right panel/));
  assert.deepEqual(opened, [
    ["/workspace/project/src/app.ts", "remote-fixture"],
    ["/workspace/project/src/view.tsx", "remote-fixture"],
    ["/workspace/project/notes/result.txt", "remote-fixture"],
    ["/tmp/codemode-full.txt", "remote-fixture"],
  ]);
  assert.deepEqual(tabs, [{ tabId: "tab-7" }]);
});

test("cancelled live steps settle as cancelled and the stopped row no longer counts elapsed time", async (t) => {
  const startedAt = Date.now() - 1000;
  const liveUpdate = { toolCallId: "code-1", startedAt, partialResult: payload([read, terminal]) };
  const view = await mount(t, ToolCallBlock, { ...props, liveUpdate });
  const row = await expand(view);
  assert.match(row.textContent, /Running: Terminal npm test · 1 steps completed/);
  assert.ok(byRole(view.container, "heading", "Execution steps · Running"));
  await view.update({ ...props, liveUpdate: { ...liveUpdate, endedAt: startedAt + 1600 } });
  await settle();
  assert.ok(byRole(view.container, "button", /Stopped script/));
  assert.match(row.textContent, /1 completed · 1 cancelled/);
  assert.match(row.textContent, /1\.6s/);
  assert.doesNotMatch(row.textContent, /Running|steps completed/);
  const steps = byRole(view.container, "region", "Execution steps");
  assert.ok(byRole(steps, "heading", "Execution steps · 1 succeeded · 0 failed · 1 cancelled"));
  assert.equal(byRole(view.container, "status"), undefined);
  assert.doesNotMatch(steps.textContent, /Click the stop button below/);
  const cancelledStep = steps.querySelectorAll("li")[1];
  assert.match(cancelledStep.textContent, /Cancelled:/);
  assert.match(cancelledStep.textContent, /npm test/);
  assert.doesNotMatch(cancelledStep.textContent, /running:/);
  const stoppedText = row.textContent;
  await act(async () => new Promise((resolve) => setTimeout(resolve, 1100)));
  assert.equal(row.textContent, stoppedText);
});

test("a loaded image opens the real zoom viewer and native cancel or Escape closes it", async (t) => {
  const prototype = dom.window.HTMLDialogElement.prototype;
  const originals = new Map();
  let view;
  t.after(async () => {
    try {
      await view?.unmount();
    } finally {
      for (const [name, original] of originals) {
        if (original) Object.defineProperty(prototype, name, original);
        else delete prototype[name];
      }
    }
  });
  for (const [name, implementation] of Object.entries({
    showModal() {
      this.open = true;
    },
    close() {
      this.open = false;
    },
  })) {
    if (typeof prototype[name] === "function") continue;
    originals.set(name, Object.getOwnPropertyDescriptor(prototype, name));
    Object.defineProperty(prototype, name, { configurable: true, value: implementation });
  }
  const src = "data:image/png;base64,iVBORw0KGgo=";
  view = await mount(t, ToolCallBlock, {
    ...props,
    result: result([], "", {
      content: [{ type: "image", source: { type: "url", url: src } }],
    }),
  });
  await expand(view);
  const thumbnail = byRole(view.container, "button", "Image 1 · Enlarge image");
  assert.equal(thumbnail.disabled, true);
  const image = thumbnail.querySelector("img");
  Object.defineProperties(image, {
    naturalWidth: { configurable: true, value: 640 },
    naturalHeight: { configurable: true, value: 480 },
  });
  await act(async () => image.dispatchEvent(new dom.window.Event("load")));
  assert.equal(thumbnail.disabled, false);
  assert.match(view.container.textContent, /640 × 480/);
  await click(thumbnail);
  await settle();
  let dialog = dom.window.document.querySelector("dialog[open]");
  assert.ok(dialog);
  assert.equal(dialog.getAttribute("aria-modal"), "true");
  assert.ok(byRole(dialog, "heading", "Image 1"));
  assert.ok(byRole(dialog, "region", "Image 1"));
  assert.ok(byRole(dialog, "button", "Zoom in"));
  assert.ok(byRole(dialog, "button", "Zoom out"));
  assert.equal(dialog.querySelector("img").src, src);
  const cancel = new dom.window.Event("cancel", { cancelable: true });
  await act(async () => dialog.dispatchEvent(cancel));
  assert.equal(cancel.defaultPrevented, true);
  assert.equal(dom.window.document.querySelector("dialog"), null);
  await click(byRole(view.container, "button", "Enlarge image"));
  dialog = dom.window.document.querySelector("dialog[open]");
  assert.ok(dialog);
  const escape = new dom.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
  await act(async () => dialog.dispatchEvent(escape));
  assert.equal(escape.defaultPrevented, true);
  assert.equal(dom.window.document.querySelector("dialog"), null);
});
