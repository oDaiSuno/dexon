import assert from "node:assert/strict";
import test, { after } from "node:test";
import { MessageChannel } from "node:worker_threads";
import {
  dom,
  act,
  loadRenderer,
  mount,
  click,
  waitFor,
  restoreGlobals,
  settle,
} from "../../../../tests/support/renderer.mjs";
import { installRendererApi } from "../../../../tests/support/renderer-api.mjs";
import { browserState } from "../../../../tests/support/browser-state.mjs";
import { createSessionDetail } from "../../hooks/agent-session/session-hook-harness.mjs";

const api = await loadRenderer(
  "workspace-path-isolation",
  'export { AppShell } from "./src/renderer/components/AppShell.tsx";' +
    'export { workspaceStore } from "./src/renderer/lib/workspace-store.ts";' +
    'export { environmentRegistry } from "./src/renderer/lib/environment-registry.ts";' +
    'export { createRpcServer } from "./src/contract/rpc.ts";',
);
after(restoreGlobals);

for (const expanded of [false, true]) {
  test(`remote to local and empty focus never sends a remote path to primary with the panel ${expanded ? "expanded" : "collapsed"}`, async (t) => {
    const requests = [];
    const details = {
      primary: createSessionDetail("local", {
        cwd: "/Users/dev/local",
        messages: [{ role: "user", content: "Local conversation", timestamp: 1 }],
      }),
      gpu: createSessionDetail("remote", {
        cwd: "/home/dev/remote",
        messages: [{ role: "user", content: "Remote conversation", timestamp: 1 }],
      }),
    };
    details.primary.info.environmentId = "primary";
    details.gpu.info.environmentId = "gpu";
    details.primary.info.name = "Local history";
    details.gpu.info.name = "Remote history";
    const reply = (environmentId, method, params) => {
      requests.push({ environmentId, method, params });
      const detail = details[environmentId];
      if (method === "host.ping") return { ok: true };
      if (method === "sessions.list") return { sessions: detail ? [detail.info] : [], runningSessionIds: [] };
      if (method === "sessions.get") return detail;
      if (method === "agent.state") return { running: false, state: {} };
      if (method === "models.list")
        return { models: [], nameMap: {}, thinkingLevels: {}, thinkingLevelMaps: {}, catalog: {}, defaultModel: null };
      if (method === "system.home") return { home: environmentId === "primary" ? "/Users/dev" : "/home/dev" };
      if (method === "system.defaultCwd") return { cwd: "/Users/dev/local" };
      if (method === "system.validateCwd") return { ok: true, path: params.path };
      if (method === "worktrees.list")
        return { projectRoot: params.cwd ?? params.projectRoot, isGit: false, isTopLevel: false, worktrees: [] };
      if (method === "git.status") return { isGit: false, branch: null, clean: true, entries: [] };
      if (method === "git.branch") return { isGit: false, branch: null };
      if (method === "files.list")
        return {
          entries: [
            {
              name: `${environmentId}-file.txt`,
              path: `${params.path}/${environmentId}-file.txt`,
              type: "file",
              isDir: false,
              size: 1,
              mtime: 0,
            },
          ],
        };
      if (method === "files.index") return { files: [], truncated: false };
      if (method === "files.watchStart" || method === "files.watchStop") return { ok: true };
      if (method === "skills.list") return { skills: [] };
      if (method === "processes.list") return { revision: 1, processes: [] };
      if (method === "channels.list") return { accounts: [], statuses: [], pairings: [], bindings: [], activities: [] };
      if (method === "agent.command") return {};
      if (method === "agent.generateTitle") return { title: null };
      throw new Error(`Unexpected isolation request ${method}`);
    };
    const spaces = [
      { environmentId: "primary", path: "/Users/dev/local" },
      { environmentId: "gpu", path: "/home/dev/remote" },
    ];
    const bridge = {
      getUiState: async () => ({ projectSpaces: { version: 2, spaces, seeded: ["primary", "gpu"] } }),
      setUiState: async () => {},
      listEnvironments: async () => ({
        revision: 1,
        policy: { detachedDaemon: true, autoReconnect: true },
        environments: ["gpu", "staging"].map((id) => ({
          id,
          label: id === "gpu" ? "GPU" : "Staging",
          enabled: true,
          target: { kind: "ssh", sshAlias: id },
          status: { phase: "connected", generation: 1, since: 0 },
          descriptor: null,
        })),
      }),
      onEnvironmentsChanged: () => () => {},
      onMenu: () => () => {},
      onHostRestarted: () => () => {},
      getUpdateState: async () => ({ phase: "idle", currentVersion: "0.0.0", automaticChecksEnabled: false }),
      onUpdateState: () => () => {},
      onBrowserEvent: () => () => {},
      browserGetState: async () => browserState(),
      browserSetSurfaceVisible: async () => {},
    };
    dom.window.localStorage.clear();
    dom.window.history.replaceState(null, "", "/");
    const boundary = installRendererApi(
      dom.window,
      api,
      () => ({ call: (method, params) => reply("primary", method, params) }),
      { bridge },
    );
    api.environmentRegistry.initialize();
    await api.workspaceStore.initialize(dom.window.piBridge);
    const remotes = ["gpu", "staging"].map((environmentId) => {
      const server = api.createRpcServer();
      server.handle(
        Object.fromEntries(
          [
            "host.ping",
            "sessions.list",
            "sessions.get",
            "agent.state",
            "models.list",
            "system.home",
            "system.validateCwd",
            "worktrees.list",
            "git.status",
            "git.branch",
            "files.list",
            "files.index",
            "files.watchStart",
            "files.watchStop",
            "skills.list",
            "agent.command",
            "agent.generateTitle",
            "processes.list",
          ].map((method) => [method, (params) => reply(environmentId, method, params)]),
        ),
      );
      const { port1, port2 } = new MessageChannel();
      server.attachPort(port1);
      api.environmentRegistry.getConnection(environmentId).replacePort(port2, 1);
      return { environmentId, server, port1 };
    });
    const view = await mount(
      t,
      api.AppShell,
      {
        chatAppearance: { fontSize: "standard", layout: "fixed" },
        chatAppearanceSaving: false,
        onChatAppearanceChange: async () => {},
      },
      {
        release: () => {
          for (const { environmentId, server, port1 } of remotes) {
            api.environmentRegistry.getConnection(environmentId).close();
            server.detachPort(port1);
            port1.close();
          }
          boundary.close();
        },
      },
    );
    const history = (name) =>
      waitFor(() => {
        const button = [...view.container.querySelectorAll("button")].find(
          (item) => item.getAttribute("aria-label") === name,
        );
        assert.ok(
          button,
          `history row ${name} is available: ${[...view.container.querySelectorAll("button")].map((item) => item.getAttribute("aria-label") ?? item.textContent).join(" | ")}`,
        );
        return button;
      });
    const expand = async (name) => {
      const button = await history(name);
      if (button.getAttribute("aria-expanded") !== "true") await click(button);
    };
    const show = async (name, marker) => {
      await click(await history(name));
      await waitFor(() => assert.match(view.container.textContent, marker));
      await settle();
    };
    if (expanded) {
      const toggle = [...view.container.querySelectorAll("button")].find(
        (item) => item.getAttribute("aria-label") === "Show file panel",
      );
      await click(toggle);
    }
    const panel = view.container.querySelector('[role="separator"][aria-label="Resize right panel"]').parentElement;
    assert.equal(panel.getAttribute("aria-hidden"), expanded ? null : "true");
    await expand("remote");
    await show("Remote history", /Remote conversation/);
    assert.ok(
      requests.some(
        (item) =>
          item.environmentId === "gpu" && item.method === "files.list" && item.params.path === "/home/dev/remote",
      ),
    );
    const beforeLocal = requests.length;
    await expand("Default space");
    await show("Local history", /Local conversation/);
    await waitFor(() => assert.match(panel.textContent, /primary-file\.txt/));
    assert.doesNotMatch(panel.textContent, /gpu-file\.txt/);
    assert.ok(
      requests
        .slice(beforeLocal)
        .some(
          (item) =>
            item.environmentId === "primary" && item.method === "files.list" && item.params.path === "/Users/dev/local",
        ),
    );
    await act(async () => api.workspaceStore.openSpace({ environmentId: "staging", path: "/unmounted" }));
    await waitFor(() => assert.match(view.container.textContent, /Get Started/));
    await settle();
    assert.equal(view.container.querySelector('[role="textbox"][aria-multiline="true"]'), null);
    assert.deepEqual(
      requests.filter((item) => JSON.stringify(item.params ?? {}).includes("/unmounted")),
      [],
    );
    assert.deepEqual(
      requests.filter(
        (item) =>
          item.environmentId === "staging" &&
          (item.params?.cwd || item.params?.path || item.params?.sessionId || item.params?.projectRoot),
      ),
      [],
    );
    await expand("remote");
    await show("Remote history", /Remote conversation/);
    assert.ok(view.container.querySelector('[role="textbox"][aria-multiline="true"]'));
    await act(async () => api.workspaceStore.unmountEnvironment("gpu"));
    await settle();
    assert.doesNotMatch(view.container.textContent, /Remote conversation/);
    assert.equal(
      view.container.querySelector('[role="textbox"][aria-multiline="true"]'),
      null,
      "empty focus cannot manufacture a draft at the previous remote path",
    );
    assert.deepEqual(
      requests.filter(
        (item) => item.environmentId === "primary" && JSON.stringify(item.params ?? {}).includes("/home/"),
      ),
      [],
    );
    assert.deepEqual(
      requests.filter((item) => item.environmentId === "gpu" && JSON.stringify(item.params ?? {}).includes("/Users/")),
      [],
    );
  });
}
