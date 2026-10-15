import { restoreGlobals, harness, rootEl } from "./chat-input-file-reference.harness.mjs";
import { importTestBundle } from "#test-bundle";
import assert from "node:assert/strict";
import path from "node:path";
import test, { after, afterEach, beforeEach } from "node:test";
import { createElement, createRef } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { allByRole, button, click, getByRole, mouseDown } from "../../../tests/support/dom-events.mjs";

// The composer is a contenteditable surface; the jsdom harness (imported
// first) provides the real DOM environment before the bundle loads.
const dom = harness.dom;
const storedValues = harness.storedValues;
const requests = harness.requests;
const showItemInFolderCalls = harness.showItemInFolderCalls;

const { ChatInput, resetDraftCache, installApiShims, resetRpc } = await importTestBundle(
  "src/renderer/components/chat-input-file-reference",
  {
    stdin: {
      contents:
        'export { ChatInput } from "./ChatInput.tsx"; export { resetDraftCache } from "../lib/draft-store.ts"; export {installApiShims} from "../lib/api-fetch.ts"; export {resetRpc} from "../lib/api-client.ts";',
      resolveDir: import.meta.dirname,
      sourcefile: "chat-input-file-reference-test-entry.tsx",
      loader: "tsx",
    },
    tsconfig: path.join(import.meta.dirname, "../../../tsconfig.renderer.json"),
    external: ["react", "react-dom", "react-dom/*"],
  },
);
harness.connectApi({ installApiShims, resetRpc });

// An interrupted case must not leave its mounted root, and the root's pending
// work, alive past the shared environment restore (ASTRA-R10-F001).
afterEach(() => unmount());
after(() => restoreGlobals());

// Every test owns its request history, storage and draft cache: the shared
// harness accumulators and the bundled draft store must not leak state across
// cases regardless of registration order (ASTRA-R5-F001).
beforeEach(() => {
  harness.resetRequests();
  harness.storedValues.clear();
  resetDraftCache();
});

const editorEl = () => rootEl.querySelector('[role="textbox"][aria-multiline="true"]');
const flushMicrotasks = async () => {
  await act(async () => Promise.all([Promise.resolve(), Promise.resolve()]));
};

let mounted = null;
async function mount(props = {}) {
  const handle = createRef();
  const element = createElement(ChatInput, {
    cwd: props.cwd === undefined ? "/workspace/project" : props.cwd,
    isStreaming: props.isStreaming ?? false,
    draftKey: props.draftKey,
    onAbort() {},
    onSend(message) {
      (props.sent ?? []).push(message);
    },
    onFollowUp: props.onFollowUp,
    ref: handle,
  });
  await act(async () => ((mounted = createRoot(rootEl)), mounted.render(element)));
  return handle;
}

async function unmount() {
  if (!mounted) return;
  const root = mounted;
  mounted = null;
  await act(async () => root.unmount());
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
  await act(async () => el.dispatchEvent(new dom.window.InputEvent("input", { bubbles: true })));
}

/** Type text at the current caret (keeps existing nodes, incl. chips). */
async function typeText(text) {
  const el = editorEl();
  const sel = dom.window.getSelection();
  const range = sel.rangeCount && el.contains(sel.anchorNode) ? sel.getRangeAt(0) : null;
  assert.ok(range && range.collapsed, "typeText needs a collapsed caret inside the editor");
  const node = dom.window.document.createTextNode(text);
  range.insertNode(node);
  range.setStart(node, text.length);
  range.collapse(true);
  sel.removeAllRanges();
  sel.addRange(range);
  await act(async () => el.dispatchEvent(new dom.window.InputEvent("input", { bubbles: true })));
}

async function pressKey(key, options = {}) {
  await act(async () =>
    editorEl().dispatchEvent(
      new dom.window.KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...options }),
    ),
  );
}

function menuRowLabels() {
  return Array.from(rootEl.querySelectorAll("button"))
    .map((button) => button.textContent ?? "")
    .filter(
      (text) => text.includes(".ts") || text.includes(".tsx") || text.includes("README") || text.includes(".txt"),
    );
}

function deferred() {
  let resolve;
  const promise = new Promise((nextResolve) => (resolve = nextResolve));
  return { promise, resolve };
}

// ── tests ──────────────────────────────────────────────────────────────────

test("@ project file autocomplete completes into a chip and sends the literal token", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const sent = [];
  await mount({ sent });

  await setEditorText("@src/");
  t.mock.timers.tick(0);
  await flushMicrotasks();
  assert.equal(requests.length, 1);
  assert.equal(requests[0].method, "files.index");
  assert.deepEqual(requests[0].params, { root: "/workspace/project", query: "src/" });
  assert.ok(
    menuRowLabels().some((label) => label.includes("main.ts")),
    "menu lists the matching project file",
  );

  await pressKey("ArrowDown");
  await pressKey("Enter"); // complete
  assert.ok(getByRole(editorEl(), "button", "main.ts"));
  assert.deepEqual(sent, [], "completion Enter must not submit the prompt");

  await pressKey("Enter"); // submit
  assert.deepEqual(sent, ["@src/main.ts"]);
  assert.equal(button(editorEl(), "main.ts"), undefined);
  assert.equal(editorEl().textContent, "");

  await unmount();
});

test("@ autocomplete requests each query and ignores a late response for an older token", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const pending = [];
  harness.setFileSearch(() => {
    const request = deferred();
    pending.push(request);
    return request.promise;
  });
  try {
    await mount();
    const requestStart = requests.length;

    await setEditorText("@mai");
    t.mock.timers.tick(150);
    await flushMicrotasks();
    assert.deepEqual(requests[requestStart], {
      method: "files.index",
      params: { root: "/workspace/project", query: "mai" },
    });

    await setEditorText("@read");
    t.mock.timers.tick(150);
    await flushMicrotasks();
    assert.deepEqual(requests[requestStart + 1], {
      method: "files.index",
      params: { root: "/workspace/project", query: "read" },
    });

    await act(async () => {
      pending[1].resolve({ files: ["README.md"], matches: [{ path: "README.md", isDir: false }], truncated: false });
      await new Promise((resolve) => setImmediate(resolve));
    });
    assert.match(rootEl.textContent ?? "", /README\.md/);

    await act(async () => {
      pending[0].resolve({
        files: ["src/main.ts"],
        matches: [{ path: "src/main.ts", isDir: false }],
        truncated: false,
      });
      await new Promise((resolve) => setImmediate(resolve));
    });
    assert.doesNotMatch(rootEl.textContent ?? "", /main\.ts/);
  } finally {
    harness.resetFileSearch();
    await unmount();
  }
});

test("@ autocomplete shows degraded scope and reuses a recent query from the bounded cache", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  harness.setFileSearch(async () => ({
    files: ["Desktop/nested.txt"],
    matches: [{ path: "Desktop/nested.txt", isDir: false }],
    truncated: false,
    degradedReason: "search-unavailable",
  }));
  try {
    await mount();
    const requestStart = requests.length;
    await setEditorText("@nest");
    t.mock.timers.tick(150);
    await flushMicrotasks();
    assert.match(rootEl.textContent ?? "", /limited to this folder/);
    assert.equal(requests.length, requestStart + 1);

    await setEditorText("");
    await setEditorText("@nest");
    assert.equal(requests.length, requestStart + 1, "second lookup hits the bounded cache");
    assert.match(rootEl.textContent ?? "", /Desktop\/nested\.txt/);
  } finally {
    harness.resetFileSearch();
    await unmount();
  }
});

test("local file references are sent as literal @path tokens", async () => {
  const sent = [];
  const handle = await mount({ sent });

  await act(async () => {
    handle.current.addFiles([{ name: "notes local.txt", testPath: "/tmp/notes local.txt", type: "text/plain" }]);
    await Promise.resolve();
  });
  assert.ok(getByRole(editorEl(), "button", "notes local.txt"));
  await typeText("@src/main.ts explain both ");
  assert.ok(getByRole(editorEl(), "button", "main.ts"));
  assert.match(editorEl().textContent, /explain both $/);

  await pressKey("Enter");
  assert.deepEqual(sent, [`@"/tmp/notes local.txt" @src/main.ts explain both`]);

  await unmount();
});

test("＋ button expands the attachment menu and each row opens its own picker", async () => {
  await mount();
  const plusButton = rootEl.querySelector('button[aria-label="Add images or local file references"]');
  assert.ok(plusButton, "＋ attach button is rendered");
  assert.notEqual(plusButton.getAttribute("aria-expanded"), "true");

  await click(plusButton);
  const rowNames = () =>
    Array.from(rootEl.querySelectorAll("button"))
      .map((button) => button.textContent ?? "")
      .filter((text) => /Add photos|Add files/.test(text))
      .map((text) => /Add photos|Add files/.exec(text)[0]);
  assert.deepEqual(rowNames(), ["Add files"], "menu lists the single file entry point");
  assert.equal(plusButton.getAttribute("aria-expanded"), "true");

  const firstRow = Array.from(rootEl.querySelectorAll("button")).find((button) =>
    (button.textContent ?? "").includes("Add files"),
  );
  await mouseDown(firstRow);
  assert.deepEqual(rowNames(), [], "picking an entry point closes the menu");

  await unmount();
});

test("streaming queue delivers token references as plain queued text", async () => {
  const draftKey = `image-queue-${Date.now()}`;
  storedValues.set(
    `dexon-draft:${draftKey}`,
    JSON.stringify({
      schemaVersion: 3,
      value: "compare @/tmp/pi-clipboard-a.png with the last one",
      updatedAt: Date.now(),
    }),
  );
  const queued = [];
  await mount({ isStreaming: true, draftKey, onFollowUp: (message) => queued.push(message) });

  const sendButton = rootEl.querySelector('button[aria-label="Send"]');
  assert.ok(sendButton, "armed send square replaces the stop button while streaming");
  await click(sendButton);

  assert.deepEqual(queued, ["compare @/tmp/pi-clipboard-a.png with the last one"]);
  assert.equal(editorEl().textContent, "");
  assert.equal(allByRole(editorEl(), "button", "Remove").length, 0);
  await unmount();
});

test("an image without a local path is staged, displayed, and sent by its staged path", async () => {
  const createObjectUrlDescriptor = Object.getOwnPropertyDescriptor(URL, "createObjectURL");
  const createImageBitmapDescriptor = Object.getOwnPropertyDescriptor(globalThis, "createImageBitmap");
  const stageRequests = [];
  const previousStageImplementation = harness.getStageClipboardImage();
  harness.setStageClipboardImage(async (request) => {
    stageRequests.push(request);
    return { ok: true, staged: { path: "/tmp/pi-clipboard-staged.png" } };
  });
  Object.defineProperty(URL, "createObjectURL", { configurable: true, value: () => "blob:staged-preview" });
  Object.defineProperty(globalThis, "createImageBitmap", {
    configurable: true,
    value: async () => ({ width: 800, height: 600, close() {} }),
  });

  const sent = [];
  const handle = await mount({ sent });
  try {
    await act(async () => {
      handle.current.addFiles([
        {
          name: "shot.png",
          type: "image/png",
          arrayBuffer: async () => Uint8Array.from(Buffer.from("a")).buffer,
        },
      ]);
      await Promise.resolve();
      await Promise.resolve();
    });

    assert.equal(stageRequests.length, 1);
    assert.deepEqual(stageRequests[0], { base64: "YQ==", ext: "png" });
    assert.ok(getByRole(editorEl(), "button", "pi-clipboard-staged.png"));

    await click(button(rootEl, "Send"));
    assert.deepEqual(sent, ["@/tmp/pi-clipboard-staged.png"]);
  } finally {
    harness.setStageClipboardImage(previousStageImplementation);
    if (createObjectUrlDescriptor) Object.defineProperty(URL, "createObjectURL", createObjectUrlDescriptor);
    else delete URL.createObjectURL;
    if (createImageBitmapDescriptor)
      Object.defineProperty(globalThis, "createImageBitmap", createImageBitmapDescriptor);
    else delete globalThis.createImageBitmap;
    await unmount();
  }
});

test("backspace removes the attachment chip and sends only the remaining text", async () => {
  const sent = [];
  const handle = await mount({ sent });
  await act(async () => {
    handle.current.addFiles([{ name: "a.png", testPath: "/tmp/a.png", type: "image/png" }]);
    await Promise.resolve();
  });
  assert.ok(getByRole(editorEl(), "button", "a.png"));
  await typeText("more");

  // Place the caret right after the chip (before the separator space).
  const el = editorEl();
  const chip = getByRole(el, "button", "a.png");
  const sel = dom.window.getSelection();
  const range = dom.window.document.createRange();
  range.setStartAfter(chip);
  range.collapse(true);
  sel.removeAllRanges();
  sel.addRange(range);

  const prevented = await act(async () =>
    el.dispatchEvent(
      new dom.window.InputEvent("beforeinput", {
        bubbles: true,
        cancelable: true,
        inputType: "deleteContentBackward",
      }),
    ),
  );
  assert.equal(prevented, false, "the atomic delete must be prevented at the DOM level");
  assert.equal(button(el, "a.png"), undefined);
  assert.equal(el.textContent, "more");

  await click(button(rootEl, "Send"));
  assert.deepEqual(sent, ["more"]);

  await unmount();
});

test("an attachment reveals its file and removing it excludes the path from the next send", async () => {
  const sent = [];
  const handle = await mount({ sent });
  await act(async () => {
    handle.current.addFiles([{ name: "reveal-me.md", testPath: "/tmp/reveal-me.md", type: "text/markdown" }]);
    await Promise.resolve();
  });
  const chip = getByRole(editorEl(), "button", "reveal-me.md");

  await click(chip);
  assert.deepEqual(showItemInFolderCalls, ["/tmp/reveal-me.md"]);

  await click(button(chip, "Remove"));
  assert.equal(button(editorEl(), "reveal-me.md"), undefined);
  assert.equal(editorEl().textContent, "");

  await typeText("keep this message");
  await click(button(rootEl, "Send"));
  assert.deepEqual(sent, ["keep this message"]);

  await unmount();
});

test("rebuilt attachment chips preserve their paths and edited message text when sent", async () => {
  const sent = [];
  const handle = await mount({ sent });
  const text = `@"my dir/notes.md" and @/tmp/a.png check`;
  await act(async () => {
    handle.current.prependText(text);
    await Promise.resolve();
  });
  assert.equal(allByRole(editorEl(), "button", "Remove").length, 2);
  assert.ok(getByRole(editorEl(), "button", "notes.md"));
  assert.ok(getByRole(editorEl(), "button", "a.png"));

  await typeText(" now");
  await click(button(rootEl, "Send"));
  assert.deepEqual(sent, [`@"my dir/notes.md" and @/tmp/a.png check now`]);

  await unmount();
});

test("typing a path then a space displays a chip and sends the path with later text", async () => {
  const sent = [];
  await mount({ sent });
  await setEditorText("look at @src/main.ts");
  assert.equal(allByRole(editorEl(), "button", "Remove").length, 0, "open query stays plain text");
  assert.equal(editorEl().textContent, "look at @src/main.ts");
  Object.defineProperty(editorEl(), "scrollHeight", { configurable: true, value: 123 });

  await act(async () => {
    editorEl().dispatchEvent(
      new dom.window.InputEvent("beforeinput", { bubbles: true, cancelable: true, inputType: "insertText", data: " " }),
    );
  });
  assert.ok(getByRole(editorEl(), "button", "main.ts"));
  assert.equal(editorEl().style.height, "123px", "visible chip replacement synchronizes editor height");

  await typeText("please");
  await click(button(rootEl, "Send"));
  assert.deepEqual(sent, ["look at @src/main.ts please"]);

  await unmount();
});

test("Esc then a space turns a directory query into a chip that sends with later text", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const sent = [];
  await mount({ sent });
  await setEditorText("@src/");
  t.mock.timers.tick(0);
  await flushMicrotasks();
  await pressKey("Escape"); // close the menu, the query stays plain text
  assert.equal(allByRole(editorEl(), "button", "Remove").length, 0);
  assert.equal(editorEl().textContent, "@src/");

  await act(async () => {
    editorEl().dispatchEvent(
      new dom.window.InputEvent("beforeinput", { bubbles: true, cancelable: true, inputType: "insertText", data: " " }),
    );
  });
  assert.ok(getByRole(editorEl(), "button", "src"));

  await typeText("inspect it");
  await click(button(rootEl, "Send"));
  assert.deepEqual(sent, ["@src/ inspect it"]);

  await unmount();
});

test("closing a quoted directory query displays a chip and preserves its quoted path when sent", async () => {
  const sent = [];
  await mount({ sent });
  // State after a quoted drill-down completion: caret before the closing quote.
  await setEditorText('@"my dir/"', 9);
  assert.equal(editorEl().textContent, '@"my dir/"');

  await act(async () => {
    editorEl().dispatchEvent(
      new dom.window.InputEvent("beforeinput", { bubbles: true, cancelable: true, inputType: "insertText", data: " " }),
    );
  });
  assert.ok(getByRole(editorEl(), "button", "my dir"));

  await typeText("inspect it");
  await click(button(rootEl, "Send"));
  assert.deepEqual(sent, ['@"my dir/" inspect it']);

  await unmount();
});

test("a non-path @word keeps its space as plain text", async () => {
  const sent = [];
  await mount({ sent });
  await setEditorText("hey @hello");
  // jsdom performs no default editing: when the composer does not prevent
  // the event, the browser default (inserting the space) is simulated here.
  const prevented = await act(async () =>
    editorEl().dispatchEvent(
      new dom.window.InputEvent("beforeinput", { bubbles: true, cancelable: true, inputType: "insertText", data: " " }),
    ),
  );
  assert.equal(prevented, true, "a non-path space must not be intercepted");
  await typeText(" ");
  assert.equal(allByRole(editorEl(), "button", "Remove").length, 0);
  assert.equal(editorEl().textContent, "hey @hello ");

  await click(button(rootEl, "Send"));
  assert.deepEqual(sent, ["hey @hello"]);

  await unmount();
});

test("a late failed suggestion response cannot override a newer success", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const pending = [];
  const rejectable = () => {
    let resolve;
    let reject;
    const promise = new Promise((onResolve, onReject) => {
      resolve = onResolve;
      reject = onReject;
    });
    return { promise, resolve, reject };
  };
  harness.setFileSearch(() => {
    const request = rejectable();
    pending.push(request);
    return request.promise;
  });
  try {
    await mount();
    await setEditorText("@mai");
    t.mock.timers.tick(150);
    await flushMicrotasks();

    await setEditorText("");
    await flushMicrotasks();
    await setEditorText("@mai");
    t.mock.timers.tick(150);
    await flushMicrotasks();
    assert.equal(pending.length, 2, "the retype issues a second, newer request for the same token");

    await act(async () => {
      pending[1].resolve({ files: ["README.md"], matches: [{ path: "README.md", isDir: false }], truncated: false });
      await new Promise((resolve) => setImmediate(resolve));
    });
    assert.match(rootEl.textContent ?? "", /README\.md/);

    await act(async () => {
      pending[0].reject(new Error("suggestions exploded"));
      await new Promise((resolve) => setImmediate(resolve));
    });
    assert.match(rootEl.textContent ?? "", /README\.md/, "the newer success stays");
    assert.doesNotMatch(rootEl.textContent ?? "", /temporarily unavailable/);
  } finally {
    harness.resetFileSearch();
    await unmount();
  }
});

test("a failed suggestion for the current token announces itself", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  harness.setFileSearch(() => Promise.reject(new Error("suggestions exploded")));
  try {
    await mount();
    await setEditorText("@mai");
    t.mock.timers.tick(150);
    await flushMicrotasks();
    await act(async () => {
      await new Promise((resolve) => setImmediate(resolve));
    });
    assert.match(rootEl.textContent ?? "", /temporarily unavailable/);
  } finally {
    harness.resetFileSearch();
    await unmount();
  }
});

test("an unsupported attach surfaces as a dismissible alert banner", async () => {
  const handle = await mount();
  await act(async () => {
    handle.current.addFiles([{ name: "note.txt", type: "text/plain" }]);
    await Promise.resolve();
    await Promise.resolve();
  });
  const banner = rootEl.querySelector('[role="alert"]');
  assert.ok(banner, "the attach failure is announced as an alert");
  assert.match(banner.textContent ?? "", /no local path/);
  await click(banner.querySelector("button"));
  assert.equal(rootEl.querySelector('[role="alert"]'), null, "dismiss clears the notice");
});
