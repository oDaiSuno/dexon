import assert from "node:assert/strict";
import test, { after } from "node:test";
import { act, dom, loadRenderer, mount, restoreGlobals, waitFor } from "../support/renderer.mjs";
import { createFolderBrowserHost } from "../../src/renderer/components/remote-folder-picker/folder-browser-test-helpers.mjs";

const api = await loadRenderer(
  "managed-processes-reconnect",
  `
export {ProcessPanel} from "./src/renderer/components/ProcessPanel.tsx";
export {workspaceStore} from "./src/renderer/lib/workspace-store.ts";
export {environmentRegistry} from "./src/renderer/lib/environment-registry.ts";
`,
);
api.setAppLanguage("en-US");
after(restoreGlobals);

test("an explicitly owned process panel reloads both its list and selected output after a gap", async (t) => {
  let recovered = false;
  const host = await createFolderBrowserHost(api, {
    target: dom.window,
    reply(_id, method) {
      if (method === "processes.list")
        return {
          revision: recovered ? 1 : 90,
          processes: [
            {
              processId: "server",
              runId: "run",
              generation: 1,
              label: recovered ? "Recovered server" : "Old server",
              kind: "server",
              state: recovered ? "exited" : "running",
              readiness: "not-requested",
              ownerSessionId: "s",
              cwdDisplay: "/work/app",
              commandDisplay: "node app.mjs",
              createdAt: 1,
              stdinOpen: false,
              endpoints: [],
              networkWarnings: [],
              restartCount: 0,
              output: { retainedBytes: 0, droppedBytes: 0, droppedRecords: 0 },
            },
          ],
        };
      if (method === "processes.read")
        return {
          records: [
            { runId: "run", seq: 1, stream: "stdout", timestamp: 1, text: recovered ? "Missed output" : "Old output" },
          ],
          nextCursor: "cursor",
          truncated: false,
        };
      throw new Error(`unexpected ${method}`);
    },
  });
  t.after(async () => act(async () => host.close()));
  api.environmentRegistry.initialize();
  const view = await mount(t, api.ProcessPanel, { environmentId: "gpu" });
  await waitFor(() => assert.match(view.container.textContent, /Old output/));
  await host.disconnect("gpu");
  recovered = true;
  await host.reconnect("gpu", 2);
  await waitFor(() => assert.match(view.container.textContent, /Recovered server/));
  await waitFor(() => assert.match(view.container.textContent, /Missed output/));
  assert.doesNotMatch(view.container.querySelector('[role="log"]').textContent, /Old output/);
  for (const method of ["processes.list", "processes.read"]) {
    assert.ok(host.requests.filter((request) => request.method === method).length >= 2);
  }
  assert.ok(host.requests.every((request) => request.environmentId === "gpu"));
});
