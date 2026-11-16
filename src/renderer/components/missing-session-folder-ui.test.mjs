import assert from "node:assert/strict";
import test, { after } from "node:test";
import { mkdtemp, mkdir, rm, access } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { MessageChannel } from "node:worker_threads";
import {
  dom,
  act,
  loadRenderer,
  mount,
  click,
  byRole,
  keyDown,
  waitFor,
  restoreGlobals,
} from "../../../tests/support/renderer.mjs";
import { installRendererApi } from "../../../tests/support/renderer-api.mjs";
import { browserState } from "../../../tests/support/browser-state.mjs";
import { createSessionDetail } from "../hooks/agent-session/session-hook-harness.mjs";

const api = await loadRenderer(
  "missing-session-folder-ui",
  'export { AppShell } from "./src/renderer/components/AppShell.tsx"; export { workspaceStore } from "./src/renderer/lib/workspace-store.ts"; export { environmentRegistry } from "./src/renderer/lib/environment-registry.ts"; export { createRpcServer } from "./src/contract/rpc.ts";',
);
const keyboardDescriptor = Object.getOwnPropertyDescriptor(globalThis, "KeyboardEvent");
Object.defineProperty(globalThis, "KeyboardEvent", { configurable: true, value: dom.window.KeyboardEvent });
after(() => {
  if (keyboardDescriptor) Object.defineProperty(globalThis, "KeyboardEvent", keyboardDescriptor);
  else delete globalThis.KeyboardEvent;
  restoreGlobals();
});

for (const [environmentId, fallback] of [
  ["primary", true],
  ["primary", false],
  ["gpu", true],
]) {
  test(`a missing ${environmentId} folder remains readable and recovers through existing folders and default space (${fallback ? "scope" : "presence"})`, async (t) => {
    const base = await mkdtemp(path.join(os.tmpdir(), "dexon-missing-ui-"));
    t.after(() => rm(base, { recursive: true, force: true }));
    const missing = path.join(base, "deleted");
    const chosen = path.join(base, "chosen");
    const personal = path.join(base, "personal");
    await Promise.all([mkdir(missing), mkdir(chosen), mkdir(personal)]);
    await rm(missing, { recursive: true });
    const detail = createSessionDetail("deleted-history", { cwd: missing });
    detail.info.environmentId = environmentId;
    detail.info.name = "Deleted history";
    const requests = [];
    let pickerCalls = 0;
    let defaultSpaceFails = false;
    const reply = (owner, method, params) => {
      requests.push({ owner, method, params });
      if (method === "host.ping") return { ok: true };
      if (method === "sessions.list")
        return { sessions: owner === environmentId ? [detail.info] : [], runningSessionIds: [] };
      if (method === "sessions.get") return detail;
      if (method === "agent.state") return { running: false, state: {} };
      if (method === "models.list")
        return {
          models: [{ provider: "fixture", id: "global", name: "Global model" }],
          nameMap: {},
          defaultModel: null,
          catalog: {},
          ...(fallback && params?.cwd === missing
            ? { scope: { kind: "global-fallback", missingFolderPath: missing } }
            : {}),
        };
      if (method === "system.home") return { home: base };
      if (method === "system.defaultCwd") {
        if (defaultSpaceFails) throw new Error("disk quota exceeded");
        return { cwd: personal };
      }
      if (method === "system.validateCwd") return { ok: params.path !== missing, path: params.path };
      if (method === "projects.browse")
        return {
          ok: true,
          path: chosen,
          displayPath: chosen,
          home: chosen,
          parent: null,
          git: null,
          folders: [],
          truncated: false,
        };
      if (method === "worktrees.list")
        return { projectRoot: params.cwd ?? params.projectRoot, isGit: false, isTopLevel: false, worktrees: [] };
      if (method === "git.status") return { isGit: false, branch: null, clean: true, entries: [] };
      if (method === "git.branch") return { isGit: false, branch: null };
      if (method === "files.list") return { entries: [] };
      if (method === "files.index") return { files: [], truncated: false };
      if (method === "files.watchStart" || method === "files.watchStop") return { ok: true };
      if (method === "skills.list") return { skills: [] };
      if (method === "processes.list") return { revision: 1, processes: [] };
      if (method === "channels.list") return { accounts: [], statuses: [], pairings: [], bindings: [], activities: [] };
      if (method === "agent.command") return {};
      if (method === "agent.new") return { sessionId: "new-writable" };
      if (method === "agent.generateTitle") return { title: null };
      throw new Error(`Unexpected missing-folder request ${method}`);
    };
    const bridge = {
      getUiState: async () => ({
        projectSpaces: {
          version: 2,
          spaces: [
            { environmentId, path: missing },
            { environmentId: "primary", path: personal },
          ],
          seeded: ["primary", "gpu"],
        },
      }),
      setUiState: async () => {},
      selectDirectory: async () => {
        pickerCalls += 1;
        return chosen;
      },
      listEnvironments: async () => ({
        revision: 1,
        policy: { detachedDaemon: true, autoReconnect: true },
        environments: [
          {
            id: "gpu",
            label: "GPU",
            enabled: true,
            target: { kind: "ssh", sshAlias: "gpu" },
            status: { phase: "connected", generation: 1, since: 0 },
            descriptor: null,
          },
        ],
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
    const server = api.createRpcServer();
    const { port1, port2 } = new MessageChannel();
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
          "projects.browse",
          "worktrees.list",
          "git.status",
          "git.branch",
          "files.list",
          "files.index",
          "files.watchStart",
          "files.watchStop",
          "skills.list",
          "agent.command",
          "agent.new",
          "agent.generateTitle",
          "processes.list",
        ].map((method) => [method, (params) => reply("gpu", method, params)]),
      ),
    );
    server.attachPort(port1);
    api.environmentRegistry.getConnection("gpu").replacePort(port2, 1);
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
          api.environmentRegistry.getConnection("gpu").close();
          server.detachPort(port1);
          port1.close();
          boundary.close();
        },
      },
    );
    const openHistory = async () => {
      await act(async () => api.workspaceStore.openSpace({ environmentId, path: missing }));
      const space = await waitFor(() => {
        const found = [...view.container.querySelectorAll("button")].find(
          (item) => item.getAttribute("aria-label") === "deleted",
        );
        assert.ok(found);
        return found;
      });
      if (space.getAttribute("aria-expanded") === "false") await click(space);
      const row = await waitFor(() => {
        const found = [...view.container.querySelectorAll("button")].find(
          (item) => item.getAttribute("aria-label") === "Deleted history",
        );
        assert.ok(found, "the historical conversation is accessible");
        return found;
      });
      await click(row);
      await waitFor(() => assert.match(view.container.textContent, /fixture reply/));
      await waitFor(() => assert.ok(byRole(view.container, "button", "Choose existing folder for new chat")));
    };
    const type = async (message) => {
      const editor = view.container.querySelector('[role="textbox"][aria-multiline="true"]');
      await act(async () => {
        editor.textContent = message;
        editor.dispatchEvent(new dom.window.InputEvent("input", { bubbles: true }));
      });
      return editor;
    };
    await openHistory();
    assert.match(view.container.textContent, /protected as read-only/);
    const editor = await type("keep history safe");
    await keyDown(editor, "Enter");
    assert.equal(
      requests.some((request) => request.method === "agent.command" && request.params.command.type === "prompt"),
      false,
    );
    await click(byRole(view.container, "button", "Edit"));
    await click(byRole(view.container, "button", "Send"));
    await waitFor(() => assert.match(view.container.textContent, /cannot send from that folder/i));
    assert.equal(
      requests.some((request) => request.method === "agent.command" && request.params.command.type === "edit_message"),
      false,
    );
    assert.match(view.container.textContent, /fixture reply/);
    await click(byRole(view.container, "button", "Cancel"));
    await click(view.container.querySelector('[data-chat-input] button[aria-haspopup="dialog"]'));
    const card = byRole(dom.window.document.body, "dialog", "Models");
    assert.ok(card);
    assert.match(card.textContent, /Global model/);
    if (fallback) assert.match(card.textContent, /Using global model configuration/);
    await keyDown(byRole(card, "searchbox", "Search models…"), "Escape");
    await click(byRole(view.container, "button", "Choose existing folder for new chat"));
    if (environmentId === "gpu") {
      await waitFor(() => assert.ok(byRole(dom.window.document.body, "button", "Mount project space")));
      await waitFor(() =>
        assert.equal(byRole(dom.window.document.body, "button", "Mount project space").disabled, false),
      );
      await click(byRole(dom.window.document.body, "button", "Mount project space"));
    }
    await waitFor(() => assert.equal(api.workspaceStore.getSnapshot().focus.sessionId, null));
    assert.equal(pickerCalls, environmentId === "primary" ? 1 : 0);
    assert.equal(api.workspaceStore.getSnapshot().focus.environmentId, environmentId);
    await waitFor(() =>
      assert.equal(byRole(view.container, "button", "Choose existing folder for new chat"), undefined),
    );
    assert.ok(byRole(view.container, "button", "Send"));
    await type("continue in the chosen folder");
    await click(byRole(view.container, "button", "Send"));
    await waitFor(() =>
      assert.ok(
        requests.some(
          (request) =>
            request.owner === environmentId && request.method === "agent.new" && request.params.cwd === chosen,
        ),
      ),
    );
    await openHistory();
    const previousFocus = api.workspaceStore.getSnapshot().focus;
    defaultSpaceFails = true;
    await click(byRole(view.container, "button", "New chat in default space"));
    await waitFor(() =>
      assert.match(view.container.querySelector('[role="alert"]').textContent, /default space couldn't be prepared/i),
    );
    assert.deepEqual(api.workspaceStore.getSnapshot().focus, previousFocus);
    assert.match(view.container.textContent, /fixture reply/);
    assert.ok(byRole(view.container, "button", "Choose existing folder for new chat"));
    defaultSpaceFails = false;
    await click(byRole(view.container, "button", "New chat in default space"));
    await waitFor(() => assert.equal(api.workspaceStore.getSnapshot().focus.environmentId, "primary"));
    await waitFor(() =>
      assert.equal(byRole(view.container, "button", "Choose existing folder for new chat"), undefined),
    );
    await type("new writable conversation");
    await click(byRole(view.container, "button", "Send"));
    await waitFor(() =>
      assert.ok(
        requests.some(
          (request) => request.owner === "primary" && request.method === "agent.new" && request.params.cwd === personal,
        ),
      ),
    );
    assert.equal(
      requests.some((request) => request.method === "agent.new" && request.params.cwd === missing),
      false,
    );
    await assert.rejects(access(missing), { code: "ENOENT" });
  });
}
