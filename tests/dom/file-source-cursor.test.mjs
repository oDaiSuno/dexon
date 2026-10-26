import assert from "node:assert/strict";
import test, { after } from "node:test";
import { click, dom, loadRenderer, mount, restoreGlobals } from "../support/renderer.mjs";

const { TextFileReady, setAppLanguage } = await loadRenderer(
  "file-source-cursor",
  'export {TextFileReady} from "./src/renderer/components/file-viewer/text-file-viewer.tsx";',
);
setAppLanguage("zh-CN");
after(restoreGlobals);

const CONTENT = "const a = 1;\n  const hovered = useState(null);\nexport {};\n";

function viewer(patch = {}) {
  const noop = () => {};
  return {
    filePath: "/workspace/src/sample.txt",
    cwd: "/workspace",
    data: { content: CONTENT, language: "text", size: CONTENT.length },
    headContent: null,
    hasDiff: false,
    diffSummary: null,
    viewMode: "source",
    setViewMode: noop,
    previewMode: false,
    setPreviewMode: noop,
    wrapLines: false,
    setWrapLines: noop,
    watching: false,
    ...patch,
  };
}

function textNode(container, needle) {
  const walker = dom.window.document.createTreeWalker(container, dom.window.NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) if (node.data.includes(needle)) return node;
  throw new Error(`no text ${needle}`);
}

function placeCaret(node, offset) {
  const selection = dom.window.getSelection();
  selection.removeAllRanges();
  if (!node) return;
  const range = dom.window.document.createRange();
  range.setStart(node, offset);
  range.collapse(true);
  selection.addRange(range);
}

const currentRows = (container) => [...container.querySelectorAll('[aria-current="true"]')];

test("before any click the status bar shows only the encoding and no line is marked current", async (t) => {
  const view = await mount(t, TextFileReady, viewer());
  assert.match(view.container.textContent, /UTF-8 · LF/);
  assert.doesNotMatch(view.container.textContent, /第 \d+ 行，第 \d+ 列/);
  assert.equal(currentRows(view.container).length, 0);
});

test("clicking inside a code line marks that line current and the status bar shows its line and the clicked column", async (t) => {
  const view = await mount(t, TextFileReady, viewer());
  const node = textNode(view.container, "const hovered");
  placeCaret(node, 8);
  await click(node.parentElement);
  assert.match(view.container.textContent, /第 2 行，第 9 列/);
  const rows = currentRows(view.container);
  assert.equal(rows.length, 1);
  assert.ok(rows[0].contains(node), "the clicked line is the one marked current");
});

test("clicking a line number moves the current line there and reports column 1", async (t) => {
  const view = await mount(t, TextFileReady, viewer());
  const first = textNode(view.container, "const hovered");
  placeCaret(first, 4);
  await click(first.parentElement);
  placeCaret(null);
  const gutter = [...view.container.querySelectorAll('[aria-hidden="true"]')].find((el) => el.textContent === "3");
  await click(gutter);
  assert.match(view.container.textContent, /第 3 行，第 1 列/);
  const rows = currentRows(view.container);
  assert.equal(rows.length, 1);
  assert.ok(rows[0].contains(textNode(view.container, "export {};")));
});

test("the line and column are not shown while the changes view is open", async (t) => {
  const view = await mount(t, TextFileReady, viewer());
  const node = textNode(view.container, "const hovered");
  placeCaret(node, 2);
  await click(node.parentElement);
  assert.match(view.container.textContent, /第 2 行，第 3 列/);
  await view.update(
    viewer({
      headContent: "const a = 1;\n",
      hasDiff: true,
      diffSummary: { added: 2, removed: 0, hunks: 1 },
      viewMode: "diff",
    }),
  );
  assert.doesNotMatch(view.container.textContent, /第 \d+ 行，第 \d+ 列/);
});
