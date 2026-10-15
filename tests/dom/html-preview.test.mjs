import assert from "node:assert/strict";
import test, { after } from "node:test";
import { createDeferred } from "#test-timing";
import { dom, act, click, button, loadRenderer, mount, restoreGlobals } from "../support/renderer.mjs";
import { installRendererApi } from "../support/renderer-api.mjs";
const api = await loadRenderer(
  "html-preview-behavior",
  'export {FileViewer} from "./src/renderer/components/FileViewer.tsx";',
);
after(restoreGlobals);

async function openPreview(t, createHtmlPreview, releaseHtmlPreview = async () => {}) {
  const host = installRendererApi(
    dom.window,
    api,
    () => ({
      call(method) {
        if (method === "files.watchStart" || method === "files.watchStop") return { ok: true };
        assert.equal(method, "files.read");
        return { content: "<p>Preview fixture</p>", language: "html", encoding: "utf8", size: 22 };
      },
    }),
    { bridge: { createHtmlPreview, releaseHtmlPreview } },
  );
  const view = await mount(
    t,
    api.FileViewer,
    {
      filePath: "/workspace/example.html",
      cwd: "/workspace",
      sourceSessionId: "session-one",
    },
    { release: host.close },
  );
  await click(button(view.container, "Preview"));
  return view;
}

test("an HTML preview creation failure is shown instead of an empty preview", async (t) => {
  const view = await openPreview(t, async () => {
    throw new Error("preview storage unavailable");
  });
  assert.match(
    view.container.querySelector('[role="alert"]').textContent,
    /HTML preview could not be created.*preview storage unavailable/,
  );
  assert.equal(view.container.querySelector("iframe"), null);
});

test("leaving an active preview releases its URL even when release fails", async (t) => {
  const urls = new Set();
  const view = await openPreview(
    t,
    async () => {
      urls.add("pi-preview://active");
      return "pi-preview://active";
    },
    async (url) => {
      urls.delete(url);
      throw new Error("release failed");
    },
  );
  assert.equal(view.container.querySelector("iframe").getAttribute("src"), "pi-preview://active");
  await click(button(view.container, "Code"));
  assert.deepEqual([...urls], []);
  assert.equal(view.container.querySelector("iframe"), null);
});

test("a URL created after leaving preview is released and never displayed", async (t) => {
  const pending = createDeferred();
  const urls = new Set();
  const view = await openPreview(
    t,
    () => pending.promise,
    async (url) => {
      urls.delete(url);
    },
  );
  await click(button(view.container, "Code"));
  await act(async () => {
    urls.add("pi-preview://late");
    pending.resolve("pi-preview://late");
  });
  assert.deepEqual([...urls], []);
  assert.equal(view.container.querySelector("iframe"), null);
});
