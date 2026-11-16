import assert from "node:assert/strict";
import test, { after } from "node:test";
import { MessageChannel } from "node:worker_threads";
import { createDeferred } from "#test-timing";
import { dom, loadRenderer, restoreGlobals } from "../../../../tests/support/renderer.mjs";
import { installRendererApi } from "../../../../tests/support/renderer-api.mjs";

const api = await loadRenderer(
  "environment-directory-ownership",
  'export { createEnvironmentDirectory } from "./src/renderer/components/session-sidebar/environment-directory.ts";' +
    'export { getEnvironmentConnection } from "./src/renderer/lib/environment-registry.ts";' +
    'export { createRpcServer } from "./src/contract/rpc.ts";',
);
after(restoreGlobals);

for (const environmentId of ["primary", "gpu"]) {
  test(`${environmentId} directory stamps every listed and live session with its source environment`, async (t) => {
    const session = {
      id: "listed",
      path: "/sessions/listed",
      cwd: environmentId === "primary" ? "/Users/dev/app" : "/home/dev/app",
      created: "2026-01-01",
      modified: "2026-01-01",
      firstMessage: "",
      messageCount: 1,
    };
    const host = { listSessions: async () => ({ sessions: [session], runningSessionIds: [] }) };
    const boundary = installRendererApi(dom.window, api, () => host);
    let server;
    let port;
    if (environmentId !== "primary") {
      server = api.createRpcServer();
      server.handle({ "sessions.list": host.listSessions });
      const channel = new MessageChannel();
      port = channel.port1;
      server.attachPort(port);
      api.getEnvironmentConnection(environmentId).replacePort(channel.port2, 1);
    }
    const listed = createDeferred();
    const changed = createDeferred();
    const published = [];
    const directory = api.createEnvironmentDirectory(
      environmentId,
      (state) => {
        published.push(state);
        if (!state.loading) listed.resolve();
        if (state.sessions.some((item) => item.id === "live")) changed.resolve();
      },
      () => {},
    );
    t.after(() => {
      directory.dispose();
      api.getEnvironmentConnection(environmentId).close();
      if (port) {
        server.detachPort(port);
        port.close();
      }
      boundary.close();
    });
    await listed.promise;
    assert.deepEqual(published.at(-1).sessions, [{ ...session, environmentId }]);
    const event = { cwd: session.cwd, session: { ...session, id: "live", environmentId: "wrong-source" } };
    if (server) server.emit("sessions.changed", "", event);
    else boundary.emit("sessions.changed", "", event);
    await changed.promise;
    assert.equal(published.at(-1).sessions.length, 2);
    for (const state of published) for (const item of state.sessions) assert.equal(item.environmentId, environmentId);
  });
}
