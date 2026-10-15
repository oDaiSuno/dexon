import assert from "node:assert/strict";
import test, { after } from "node:test";
import { dom, click, button, loadRenderer, mount, restoreGlobals } from "../support/renderer.mjs";
import { installRendererApi } from "../support/renderer-api.mjs";
const api = await loadRenderer(
  "file-explorer-refresh",
  'export {FileExplorer} from "./src/renderer/components/FileExplorer.tsx";',
);
after(restoreGlobals);

test("a changed collapsed folder reloads when reopened and reveals the new files", async (t) => {
  let changed = false;
  const host = installRendererApi(dom.window, api, () => ({
    call(method, params) {
      if (method === "git.status")
        return {
          isGit: false,
          branch: null,
          clean: true,
          staged: 0,
          modified: 0,
          untracked: 0,
          conflicted: 0,
          entries: [],
        };
      if (method === "files.watchStart" || method === "files.watchStop") return { ok: true };
      assert.equal(method, "files.list");
      const fileName = changed ? "new.txt" : "old.txt";
      const entries =
        params.path === "/workspace/src"
          ? [{ name: fileName, path: `/workspace/src/${fileName}`, type: "file", isDir: false, size: 1, mtime: 0 }]
          : [{ name: "src", path: "/workspace/src", type: "directory", isDir: true, size: 0, mtime: 0 }];
      return { entries };
    },
  }));
  const props = { cwd: "/workspace", refreshKey: 0, onOpenFile() {} };
  const view = await mount(t, api.FileExplorer, props, { release: host.close });
  await click(button(view.container, "Expand folder src"));
  assert.match(view.container.textContent, /old\.txt/);
  await click(button(view.container, "Collapse folder src"));
  changed = true;
  await view.update({ ...props, refreshKey: 1 });
  await click(button(view.container, "Expand folder src"));
  assert.match(view.container.textContent, /new\.txt/);
  assert.doesNotMatch(view.container.textContent, /old\.txt/);
});
