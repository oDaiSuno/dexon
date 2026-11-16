import assert from "node:assert/strict";
import test, { after } from "node:test";
import { act, dom, loadRenderer, mount, restoreGlobals, waitFor } from "../support/renderer.mjs";
import {
  createFolderBrowserHost,
  remoteServer,
} from "../../src/renderer/components/remote-folder-picker/folder-browser-test-helpers.mjs";

const api = await loadRenderer(
  "workspace-home-reconnect",
  `export {useShellSpace} from "./src/renderer/components/app-shell/use-shell-space.ts";
   export {workspaceStore} from "./src/renderer/lib/workspace-store.ts";
   export {environmentRegistry} from "./src/renderer/lib/environment-registry.ts";`,
);
api.setAppLanguage("en-US");
after(restoreGlobals);

test("home directories recover after a cold-start disconnect for primary and remote environments", async (t) => {
  let failHome = true;
  const primaryServer = {
    id: "primary",
    label: "Primary",
    enabled: true,
    target: { kind: "primary" },
    status: { phase: "connected", generation: 1, since: 0 },
    descriptor: null,
  };
  const gpuServer = remoteServer("gpu");

  const host = await createFolderBrowserHost(api, {
    target: dom.window,
    servers: [primaryServer, gpuServer],
    reply(envId, method) {
      if (method === "system.home") {
        if (failHome) throw Object.assign(new Error("Host starting"), { code: "DISCONNECTED" });
        return { home: envId === "primary" ? "/Users/local" : "/home/remote" };
      }
      if (method === "sessions.list") return { sessions: [], runningSessionIds: [], sessionStatuses: {} };
      if (method === "git.branch") return { isGit: false, branch: null };
      if (method === "worktrees.list") return { worktrees: [] };
      return { ok: true };
    },
  });
  dom.window.piBridge.getHostStatus = async () => "ready";
  dom.window.piBridge.onHostStatus = () => () => {};
  t.after(async () => act(async () => host.close()));

  api.environmentRegistry.initialize();
  await act(async () => {
    api.workspaceStore.openSpace({ environmentId: "gpu", path: "/home/remote/project" });
  });

  const coordination = {
    spaceCwd: null,
    spacePhase: { phase: "idle" },
    attemptedCwd: null,
    personalCwd: null,
    remembered: false,
    rememberFailed: false,
    noteExternalCwd() {},
    retry() {},
    returnToPersonalSpace: async () => null,
    openCurrentFolder: async () => {},
    openFolder: async () => {},
  };

  let shellState;
  const chatInputRef = { current: null };
  function Probe() {
    shellState = api.useShellSpace({
      refreshKey: 0,
      coordination,
      selectedSession: {
        id: "gpu-s1",
        environmentId: "gpu",
        path: "/tmp/gpu-s1.jsonl",
        cwd: "/home/remote/project",
        projectRoot: "/home/remote/project",
        created: "2026-08-06T00:00:00.000Z",
        modified: "2026-08-06T00:00:00.000Z",
        messageCount: 1,
        firstMessage: "hi",
      },
      spaceFrozenSessionId: null,
      chatInputRef,
      onCwdCommitted() {},
      location: { environmentId: "gpu", path: "/home/remote/project" },
      onBranchSwitched() {},
    });
    return null;
  }

  await mount(t, Probe);
  await waitFor(() => {
    assert.ok(host.requests.some((r) => r.environmentId === "gpu" && r.method === "system.home"));
    assert.ok(host.requests.some((r) => r.environmentId === "primary" && r.method === "system.home"));
  });

  await host.disconnect("gpu");
  await host.disconnect("primary");
  failHome = false;
  await host.reconnect("gpu", 2);
  await host.reconnect("primary", 2);
  await act(async () => new Promise((resolve) => setTimeout(resolve, 50)));

  const homeRequestsAfterReconnect = host.requests.filter((r) => r.method === "system.home");
  console.log(
    JSON.stringify({
      totalSystemHomeCalls: homeRequestsAfterReconnect.length,
      gpuHomeDirAfterReconnect: shellState.space.homeDir,
      gpuDisplayPathAfterReconnect: shellState.space.project?.displayPath,
    }),
  );

  assert.ok(homeRequestsAfterReconnect.filter((r) => r.environmentId === "primary").length >= 2);
  assert.equal(shellState.space.homeDir, "/home/remote", "system.home must recover on reconnect");
  assert.equal(shellState.space.project?.displayPath, "~/project", "remote ~ abbreviation must recover on reconnect");
});
