import assert from "node:assert/strict";
import test, { after } from "node:test";
import { dom, loadRenderer, mount, restoreGlobals } from "../support/renderer.mjs";
import { installRendererApi } from "../support/renderer-api.mjs";

const api = await loadRenderer(
  "process-empty-shortcut",
  'export {ProcessEmpty} from "./src/renderer/components/processes/process-list.tsx";',
);
after(restoreGlobals);

async function emptyPanel(t, platform, language) {
  api.setAppLanguage(language);
  const host = installRendererApi(
    dom.window,
    api,
    () => ({
      call(method) {
        throw new Error(`unexpected ${method}`);
      },
    }),
    { bridge: { platform } },
  );
  return mount(t, api.ProcessEmpty, {}, { release: host.close });
}

test("on Windows and Linux the empty process panel hints Ctrl J", async (t) => {
  const view = await emptyPanel(t, "win32", "zh-CN");
  assert.match(view.container.textContent, /Ctrl J/);
  assert.doesNotMatch(view.container.textContent, /⌘J/);
  assert.match(view.container.textContent, /随时打开这里/);
});

test("on macOS the empty process panel hints ⌘J", async (t) => {
  const view = await emptyPanel(t, "darwin", "zh-CN");
  assert.match(view.container.textContent, /⌘J/);
  assert.match(view.container.textContent, /随时打开这里/);
});
