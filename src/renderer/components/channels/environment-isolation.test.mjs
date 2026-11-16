import assert from "node:assert/strict";
import test, { after } from "node:test";
import { act, dom, loadRenderer, mount, restoreGlobals, waitFor } from "../../../../tests/support/renderer.mjs";
import { createFolderBrowserHost, remoteServer } from "../remote-folder-picker/folder-browser-test-helpers.mjs";

const api = await loadRenderer(
  "channel-environment-isolation",
  'export {useChannelsState} from "./src/renderer/components/channels/channels-config/use-channels-state.ts"; export {workspaceStore} from "./src/renderer/lib/workspace-store.ts"; export {environmentRegistry} from "./src/renderer/lib/environment-registry.ts";',
);
after(restoreGlobals);

test("desktop channels stay on primary for loading, events and login while a remote workspace is focused", async (t) => {
  const snapshot = { accounts: [], statuses: [], pairings: [], bindings: [], activities: [] };
  const boundary = await createFolderBrowserHost(api, {
    target: dom.window,
    servers: [remoteServer("primary"), remoteServer("gpu")],
    reply(_id, method) {
      if (method === "channels.list") return snapshot;
      if (method === "sessions.list") return { sessions: [] };
      if (method === "channels.loginStart") return { channel: "weixin", phase: "confirmed", sessionKey: "login" };
      throw new Error(`Unexpected channel request: ${method}`);
    },
  });
  t.after(() => boundary.close());
  api.environmentRegistry.initialize();
  await act(async () => api.workspaceStore.openSpace({ environmentId: "gpu", path: "/same" }));
  let channels;
  function Probe() {
    channels = api.useChannelsState();
    return null;
  }
  const view = await mount(t, Probe);
  await waitFor(() => assert.equal(channels.loading, false));
  assert.deepEqual(channels.snapshot, snapshot);
  const initialRequests = boundary.requests.length;
  await act(async () => boundary.emit("gpu", "channels.status", "*", {}));
  assert.equal(boundary.requests.length, initialRequests);
  await act(async () => boundary.emit("primary", "channels.status", "*", {}));
  await waitFor(() => assert.equal(boundary.requests.length, initialRequests + 2));
  await act(async () => channels.beginLogin());
  assert.equal(channels.login.phase, "confirmed");
  assert.deepEqual(boundary.requests.find((request) => request.method === "channels.loginStart").params, {
    channel: "weixin",
    force: true,
  });
  assert.ok(boundary.requests.every((request) => request.environmentId === "primary"));
  assert.equal(boundary.requests.filter((request) => request.environmentId === "gpu").length, 0);
  await view.unmount();
});
