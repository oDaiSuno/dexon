import assert from "node:assert/strict";
import test from "node:test";
import { api, mountProjectProbe } from "./project-spaces-test-harness.mjs";
import { deferred, remoteServer } from "../remote-folder-picker/folder-browser-test-helpers.mjs";

const target = () => ({ location: { search: "", pathname: "/" }, history: { replaceState() {} }, dispatchEvent() {} });
const navProps = { isMobile: false, onMobileSidebarClose() {}, onTopPanelDismiss() {}, onSwitchSessionRequested() {} };

test("opening a mounted space on another server stops presenting the previous server's session even at the same path", async (t) => {
  const host = await mountProjectProbe(t, () => api.useWorkspaceNavigation(navProps), {
    servers: [remoteServer("gpu"), remoteServer("staging")],
    target: target(),
  });
  const session = {
    id: "same-id",
    environmentId: "gpu",
    cwd: "/work/app",
    path: "/sessions/a",
    firstMessage: "",
    created: "2026-01-01",
    modified: "2026-01-01",
    messageCount: 1,
  };
  await host.run(() => host.get().handleSelectSession(session));
  assert.equal(host.get().selectedSession.environmentId, "gpu");
  await host.run(({ workspaceStore }) => workspaceStore.openSpace({ environmentId: "staging", path: "/work/app" }));
  assert.equal(host.get().selectedSession, null, "the old session must not remain the send target after focus moves");
});

test("a created session keeps its captured server after focus moves elsewhere and hydrates only that server", async (t) => {
  const listing = deferred();
  const requested = deferred();
  const created = {
    id: "created-on-gpu",
    environmentId: "gpu",
    cwd: "/work/app",
    path: "/sessions/created",
    firstMessage: "",
    created: "2026-01-01",
    modified: "2026-01-01",
    messageCount: 1,
  };
  const host = await mountProjectProbe(t, () => api.useWorkspaceNavigation(navProps), {
    servers: [remoteServer("gpu"), remoteServer("staging")],
    target: target(),
    reply: (_id, method) => {
      if (method !== "sessions.list") return {};
      requested.resolve();
      return listing.promise;
    },
  });
  await host.run(({ environmentRegistry }) => environmentRegistry.initialize());
  await host.run(({ workspaceStore }) => workspaceStore.openSpace({ environmentId: "gpu", path: "/work/app" }));
  await host.run(({ workspaceStore }) => workspaceStore.openSpace({ environmentId: "staging", path: "/work/app" }));
  assert.equal(api.workspaceStore.getSnapshot().focus.environmentId, "staging");
  await host.run(async () => {
    host.get().handleSessionCreated(created);
    await requested.promise;
  });
  assert.equal(host.get().selectedSession?.environmentId, "gpu");
  await host.run(() =>
    listing.resolve({ sessions: [{ ...created, projectRoot: "/work/app" }], runningSessionIds: [] }),
  );
  assert.equal(host.get().selectedSession?.environmentId, "gpu");
  assert.equal(host.get().selectedSession?.projectRoot, "/work/app");
  assert.deepEqual(api.workspaceStore.getSnapshot().focus, {
    environmentId: "gpu",
    spaceKey: '["gpu","/work/app"]',
    sessionId: "created-on-gpu",
  });
  assert.deepEqual(
    host.requests.map(({ environmentId, method }) => ({ environmentId, method })),
    [{ environmentId: "gpu", method: "sessions.list" }],
  );
});

test("an external remote session request waits for the first directory instead of being lost while its server connects", async (t) => {
  const session = {
    id: "late-remote",
    cwd: "/work/app",
    path: "/sessions/late",
    firstMessage: "",
    created: "2026-01-01",
    modified: "2026-01-01",
    messageCount: 1,
  };
  const primary = { ...remoteServer("primary"), target: { kind: "primary" }, status: { phase: "available" } };
  const host = await mountProjectProbe(
    t,
    () => {
      globalThis.window.piBridge.getHostStatus = async () => "ready";
      globalThis.window.piBridge.requestHostPort = () => globalThis.window.piBridge.requestEnvironmentPort("primary");
      api.useEnvironmentDirectories({ selectedSessionId: null });
      return api.useWorkspaceNavigation(navProps);
    },
    {
      servers: [primary, remoteServer("gpu", { phase: "connecting", stage: "opening", attempt: 1, progress: null })],
      target: target(),
      reply: (id, method) =>
        method === "sessions.list" ? { sessions: id === "gpu" ? [session] : [], runningSessionIds: [] } : {},
    },
  );
  await host.run(({ requestOpenSession }) => requestOpenSession("late-remote"));
  assert.equal(host.get().selectedSession, null);
  await host.changeServers([primary, remoteServer("gpu")]);
  assert.equal(host.get().selectedSession?.id, "late-remote");
  assert.equal(host.get().selectedSession?.environmentId, "gpu");
});

test("an external session request survives the workspace's initial preferences load replacing its focus object", async (t) => {
  const preferences = deferred();
  const listing = deferred();
  const primary = { ...remoteServer("primary"), target: { kind: "primary" }, status: { phase: "available" } };
  const session = {
    id: "cold-start",
    cwd: "/work/app",
    path: "/sessions/cold",
    firstMessage: "",
    created: "2026-01-01",
    modified: "2026-01-01",
    messageCount: 1,
  };
  const host = await mountProjectProbe(
    t,
    () => {
      globalThis.window.piBridge.getHostStatus = async () => "ready";
      globalThis.window.piBridge.requestHostPort = () => globalThis.window.piBridge.requestEnvironmentPort("primary");
      return api.useWorkspaceNavigation(navProps);
    },
    {
      servers: [primary],
      target: target(),
      reply: (_id, method) => (method === "sessions.list" ? listing.promise : {}),
    },
  );
  await host.run(({ workspaceStore }) => {
    const bridge = { ...globalThis.window.piBridge, getUiState: () => preferences.promise };
    Object.defineProperty(globalThis.window, "piBridge", { configurable: true, value: bridge });
    void workspaceStore.initialize(bridge);
  });
  await host.run(({ requestOpenSession }) => requestOpenSession("cold-start"));
  await host.run(() => preferences.resolve({}));
  await host.run(() => listing.resolve({ sessions: [session], runningSessionIds: [] }));
  assert.equal(host.get().selectedSession?.id, "cold-start");
});

test("moving to another project clears both the shown conversation and its shared focus session", async (t) => {
  const host = await mountProjectProbe(t, () => api.useWorkspaceNavigation(navProps), {
    servers: [remoteServer("gpu")],
    target: target(),
  });
  await host.run(() =>
    host.get().handleSelectSession({
      id: "old",
      environmentId: "gpu",
      cwd: "/work/old",
      path: "/sessions/old",
      firstMessage: "",
      created: "2026-01-01",
      modified: "2026-01-01",
      messageCount: 1,
    }),
  );
  await host.run(() => host.get().handleCwdChange("/work/new", "/work/new"));
  assert.equal(host.get().selectedSession, null);
  assert.equal(api.workspaceStore.getSnapshot().focus.sessionId, null);
  assert.equal(api.workspaceStore.getSnapshot().focus.spaceKey, '["gpu","/work/new"]');
});

test("an empty conversation's chosen folder is scoped to its mounted space instead of following focus to another server", async (t) => {
  const host = await mountProjectProbe(t, () => api.useWorkspaceNavigation(navProps), {
    servers: [remoteServer("gpu"), remoteServer("staging")],
    target: target(),
  });
  await host.run(({ workspaceStore }) => workspaceStore.openSpace({ environmentId: "gpu", path: "/work/old" }));
  await host.run(() => host.get().handleNewSession("draft", "/work/old"));
  assert.equal(host.get().newSessionCwd, "/work/old");
  await host.run(({ workspaceStore }) => workspaceStore.openSpace({ environmentId: "staging", path: "/work/new" }));
  await host.run(() => host.get().noteCoordinatorCwd("/work/new"));
  assert.equal(host.get().newSessionCwd, null);
  assert.equal(host.get().activeCwd, "/work/new");
});
