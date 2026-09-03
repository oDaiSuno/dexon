import { importTestBundle } from "#test-bundle";
import assert from "node:assert/strict";
import path from "node:path";
import test, { after } from "node:test";
import { createElement, createRef } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { restoreGlobals, harness, rootEl } from "./chat-input-file-reference.harness.mjs";

// The composer is a contenteditable surface; the jsdom harness (imported
// first) provides the real DOM environment before the bundle loads.
const dom = harness.dom;
const storedValues = harness.storedValues;
const fetchRequests = harness.fetchRequests;
const showItemInFolderCalls = harness.showItemInFolderCalls;

const { ChatInput } = await importTestBundle("src/renderer/components/chat-input-file-reference", {
  stdin: {
    contents: 'export { ChatInput } from "./ChatInput.tsx";',
    resolveDir: import.meta.dirname,
    sourcefile: "chat-input-file-reference-test-entry.tsx",
    loader: "tsx",
  },
  tsconfig: path.join(import.meta.dirname, "../../../tsconfig.renderer.json"),
  external: ["react", "react-dom", "react-dom/*"],
});

after(() => {
  restoreGlobals();
});

const editorEl = () => rootEl.querySelector(".composer-editor");
const flush = () => new Promise((resolve) => setTimeout(resolve, 10));
const settle = async (ms) => {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  });
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
  await act(async () => {
    el.dispatchEvent(new dom.window.InputEvent("input", { bubbles: true }));
  });
}

async function pressKey(key, options = {}) {
  await act(async () => {
    editorEl().dispatchEvent(
      new dom.window.KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...options }),
    );
  });
}

/** Serialized value of the editable surface (what the send pipeline sees). */
function serializedValue() {
  const el = editorEl();
  const parts = [];
  for (const child of Array.from(el.childNodes)) {
    if (child.nodeType === dom.window.Node.TEXT_NODE) parts.push(child.textContent);
    else if (child.hasAttribute?.("data-attachment-token")) {
      parts.push(child.dataset.path.includes(" ") ? `@"${child.dataset.path}"` : `@${child.dataset.path}`);
    } else if (child.tagName === "BR") parts.push("\n");
  }
  return parts.join("");
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
  const promise = new Promise((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}

function response(data) {
  return {
    ok: true,
    async json() {
      return data;
    },
  };
}

// ── tests ──────────────────────────────────────────────────────────────────

test("@ project file autocomplete completes into a chip and sends the literal token", async () => {
  const sent = [];
  await mount({ sent });

  await setEditorText("@src/");
  await settle(180);
  assert.equal(fetchRequests.length, 1);
  assert.match(fetchRequests[0], /^\/api\/file-index\?cwd=/);
  assert.ok(
    menuRowLabels().some((label) => label.includes("main.ts")),
    "menu lists the matching project file",
  );

  await pressKey("ArrowDown");
  await pressKey("Enter"); // complete
  assert.equal(editorEl().querySelectorAll("[data-attachment-token]").length, 1);
  assert.equal(serializedValue(), "@src/main.ts ");
  assert.deepEqual(sent, [], "completion Enter must not submit the prompt");

  await pressKey("Enter"); // submit
  assert.deepEqual(sent, ["@src/main.ts"]);
  assert.equal(editorEl().querySelectorAll("[data-attachment-token]").length, 0);

  await unmount();
});

test("@ autocomplete requests each query and ignores a late response for an older token", async () => {
  const pending = [];
  harness.setFetch(() => {
    const request = deferred();
    pending.push(request);
    return request.promise;
  });
  try {
    await mount();
    const requestStart = fetchRequests.length;

    await setEditorText("@mai");
    await settle(180);
    assert.match(fetchRequests[requestStart], /[?&]q=mai(?:&|$)/);

    await setEditorText("@read");
    await settle(180);
    assert.match(fetchRequests[requestStart + 1], /[?&]q=read(?:&|$)/);

    await act(async () => {
      pending[1].resolve(response({ matches: [{ path: "README.md", isDir: false }], truncated: false }));
      await flush();
    });
    assert.match(rootEl.textContent ?? "", /README\.md/);

    await act(async () => {
      pending[0].resolve(response({ matches: [{ path: "src/main.ts", isDir: false }], truncated: false }));
      await flush();
    });
    assert.doesNotMatch(rootEl.textContent ?? "", /main\.ts/);
  } finally {
    harness.resetFetch();
    await unmount();
  }
});

test("@ autocomplete shows degraded scope and reuses a recent query from the bounded cache", async () => {
  harness.setFetch(async () =>
    response({
      matches: [{ path: "Desktop/nested.txt", isDir: false }],
      truncated: false,
      degradedReason: "search-unavailable",
    }),
  );
  try {
    await mount();
    const requestStart = fetchRequests.length;
    await setEditorText("@nest");
    await settle(180);
    assert.match(rootEl.textContent ?? "", /limited to this folder/);
    assert.equal(fetchRequests.length, requestStart + 1);

    await setEditorText("");
    await setEditorText("@nest");
    assert.equal(fetchRequests.length, requestStart + 1, "second lookup hits the bounded cache");
    assert.match(rootEl.textContent ?? "", /Desktop\/nested\.txt/);
  } finally {
    harness.resetFetch();
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
  assert.equal(editorEl().querySelectorAll("[data-attachment-token]").length, 1);
  await typeText("@src/main.ts explain both ");
  assert.equal(serializedValue(), `@"/tmp/notes local.txt" @src/main.ts explain both `);

  await pressKey("Enter");
  assert.deepEqual(sent, [`@"/tmp/notes local.txt" @src/main.ts explain both`]);

  await unmount();
});

test("＋ button expands the attachment menu and each row opens its own picker", async () => {
  await mount();
  const plusButton = rootEl.querySelector('button[aria-label="Add images or local file references"]');
  assert.ok(plusButton, "＋ attach button is rendered");
  assert.notEqual(plusButton.getAttribute("aria-expanded"), "true");

  await act(async () => {
    plusButton.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
  });
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
  await act(async () => {
    firstRow.dispatchEvent(new dom.window.MouseEvent("mousedown", { bubbles: true }));
  });
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
  await act(async () => {
    sendButton.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
  });

  assert.deepEqual(queued, ["compare @/tmp/pi-clipboard-a.png with the last one"]);
  assert.equal(serializedValue(), "");
  assert.equal(editorEl().querySelectorAll("[data-attachment-token]").length, 0);
  await unmount();
});

test("pasted clipboard images are staged and referenced as chips", async () => {
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

  const handle = await mount();
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
    assert.equal(
      editorEl().querySelectorAll('[data-attachment-token][data-path="/tmp/pi-clipboard-staged.png"]').length,
      1,
    );
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

test("backspace at a chip boundary removes the whole reference atomically", async () => {
  const handle = await mount();
  await act(async () => {
    handle.current.insertToken("/tmp/a.png");
    await Promise.resolve();
  });
  assert.equal(serializedValue(), "@/tmp/a.png ");
  await typeText("more");

  // Place the caret right after the chip (before the separator space).
  const el = editorEl();
  const chip = el.querySelector("[data-attachment-token]");
  const sel = dom.window.getSelection();
  const range = dom.window.document.createRange();
  range.setStart(el, Array.from(el.childNodes).indexOf(chip) + 1);
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
  assert.equal(el.querySelectorAll("[data-attachment-token]").length, 0);
  assert.equal(serializedValue(), "more");

  await unmount();
});

test("chips reveal in the file manager and the ✕ removes them", async () => {
  const handle = await mount();
  await act(async () => {
    handle.current.insertToken("/tmp/reveal-me.md");
    await Promise.resolve();
  });
  const chip = editorEl().querySelector("[data-attachment-token]");
  assert.ok(chip);

  await act(async () => {
    chip.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
  });
  assert.deepEqual(showItemInFolderCalls, ["/tmp/reveal-me.md"]);

  await act(async () => {
    chip.querySelector("[data-chip-remove]").dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
  });
  assert.equal(editorEl().querySelectorAll("[data-attachment-token]").length, 0);
  assert.equal(serializedValue(), "");

  await unmount();
});

test("serialized values rebuild into chips and round-trip idempotently", async () => {
  const handle = await mount();
  const text = `@"my dir/notes.md" and @/tmp/a.png check`;
  await act(async () => {
    handle.current.prependText(text);
    await Promise.resolve();
  });
  assert.equal(editorEl().querySelectorAll("[data-attachment-token]").length, 2);
  assert.equal(serializedValue(), text);

  await typeText(" now");
  assert.equal(serializedValue(), `${text} now`);

  await unmount();
});

test("typing a path then a space materializes it into a chip", async () => {
  await mount();
  await setEditorText("look at @src/main.ts");
  assert.equal(editorEl().querySelectorAll("[data-attachment-token]").length, 0, "open query stays plain text");

  await act(async () => {
    editorEl().dispatchEvent(
      new dom.window.InputEvent("beforeinput", { bubbles: true, cancelable: true, inputType: "insertText", data: " " }),
    );
  });
  assert.equal(editorEl().querySelectorAll('[data-attachment-token][data-path="src/main.ts"]').length, 1);
  assert.equal(serializedValue(), "look at @src/main.ts ");

  await unmount();
});

test("Esc then a space closes a drill-down directory as a chip", async () => {
  await mount();
  await setEditorText("@src/");
  await settle(180);
  await pressKey("Escape"); // close the menu, the query stays plain text
  assert.equal(editorEl().querySelectorAll("[data-attachment-token]").length, 0);

  await act(async () => {
    editorEl().dispatchEvent(
      new dom.window.InputEvent("beforeinput", { bubbles: true, cancelable: true, inputType: "insertText", data: " " }),
    );
  });
  assert.equal(editorEl().querySelectorAll('[data-attachment-token][data-path="src/"]').length, 1);
  assert.equal(serializedValue(), "@src/ ");

  await unmount();
});

test("a space inside an unfinished quoted query closes it as a chip", async () => {
  await mount();
  // State after a quoted drill-down completion: caret before the closing quote.
  await setEditorText('@"my dir/"', 9);
  assert.equal(serializedValue(), '@"my dir/"');

  await act(async () => {
    editorEl().dispatchEvent(
      new dom.window.InputEvent("beforeinput", { bubbles: true, cancelable: true, inputType: "insertText", data: " " }),
    );
  });
  assert.equal(editorEl().querySelectorAll('[data-attachment-token][data-path="my dir/"]').length, 1);
  assert.equal(serializedValue(), '@"my dir/" ');

  await unmount();
});

test("a non-path @word keeps its space as plain text", async () => {
  await mount();
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
  assert.equal(editorEl().querySelectorAll("[data-attachment-token]").length, 0);
  assert.equal(serializedValue(), "hey @hello ");

  await unmount();
});
