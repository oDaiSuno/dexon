import assert from "node:assert/strict";
import test, { after } from "node:test";
import { dom, loadRenderer, mount, restoreGlobals, waitFor } from "../support/renderer.mjs";
import { installRendererApi } from "../support/renderer-api.mjs";

const api = await loadRenderer(
  "file-viewer-markdown-math",
  'export {FileViewer} from "./src/renderer/components/FileViewer.tsx";',
);
after(restoreGlobals);

const CONTENT = "参数 \\[可选参数\\]，价格 $5 和 $10。\n";

function visibleText(element) {
  const copy = element.cloneNode(true);
  for (const source of copy.querySelectorAll(".katex-mathml")) source.remove();
  return copy.textContent.replace(/\s+/g, " ").trim();
}

test("when a markdown file holding \\[可选参数\\] and $5 和 $10 is previewed, the preview keeps today's rendering", async (t) => {
  const host = installRendererApi(dom.window, api, () => ({
    call(method) {
      if (method === "files.read") {
        return { content: CONTENT, language: "markdown", encoding: "utf8", size: CONTENT.length };
      }
      if (method === "git.headContent") return { comparable: false };
      return { ok: true };
    },
  }));
  const view = await mount(
    t,
    api.FileViewer,
    { filePath: "/workspace/docs/notes.md", cwd: "/workspace", sourceSessionId: "session-one" },
    { release: host.close },
  );
  await waitFor(() => assert.ok(view.container.querySelector("p"), "the markdown file opens in the rendered preview"));

  const paragraph = view.container.querySelector("p");
  const shown = visibleText(paragraph);
  assert.ok(shown.startsWith("参数 [可选参数]，价格"), "the escaped bracket pair stays plain text");
  assert.doesNotMatch(shown, /\\/, "no backslash stays visible");
  assert.ok(shown.endsWith("10。"), "the text after the price pair stays outside the formula");
  assert.equal(view.container.querySelectorAll(".katex").length, 1, "the price pair still reads as one formula");
  assert.equal(view.container.querySelectorAll(".katex-display").length, 0, "the price formula stays inline");
  assert.equal(view.container.querySelectorAll(".katex-error").length, 0, "no red error appears");
});
