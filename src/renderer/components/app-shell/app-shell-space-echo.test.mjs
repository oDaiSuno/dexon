import assert from "node:assert/strict";
import test, { after } from "node:test";
import { createDeferred } from "#test-timing";
import { dom, act, loadRenderer, mount, restoreGlobals, settle } from "../../../../tests/support/renderer.mjs";
import { installRendererApi } from "../../../../tests/support/renderer-api.mjs";
import { browserState } from "../../../../tests/support/browser-state.mjs";
import { createSessionDetail, createSessionTestHost } from "../../hooks/agent-session/session-hook-harness.mjs";
const api = await loadRenderer(
  "app-shell-real-space-echo",
  'export {AppShell} from "./src/renderer/components/AppShell.tsx";',
);
after(restoreGlobals);

test("a deep link resolving with startup restore keeps the requested session and its remembered space", async (t) => {
  const validation = createDeferred();
  const lookup = createDeferred();
  const writes = [];
  const detail = createSessionDetail("sB", {
    cwd: "/B",
    messages: [{ role: "user", content: "Deep-linked fixture conversation", timestamp: 1 }],
  });
  let deepLink;
  dom.window.history.replaceState(null, "", "/");
  const bridge = {
    getUiState: async () => ({ lastSpaceCwd: "/A" }),
    setUiState: async (patch) => {
      writes.push(patch);
    },
    openDirectory: async () => {},
    onMenu: () => () => {},
    onHostRestarted: () => () => {},
    getUpdateState: async () => ({
      phase: "idle",
      currentVersion: "0.0.0",
      automaticChecksEnabled: false,
      installBlockedByActiveSessions: false,
      canRetry: false,
    }),
    onUpdateState: () => () => {},
    onDeepLinkSession: (listener) => {
      deepLink = listener;
      return () => {
        deepLink = null;
      };
    },
    onBrowserEvent: () => () => {},
    browserGetState: async () => browserState(),
    browserSetSurfaceVisible: async () => {},
  };
  const host = createSessionTestHost({ getSession: async () => detail });
  host.listSessions = async () => {
    await lookup.promise;
    return { sessions: [detail.info], runningSessionIds: [] };
  };
  host.validateCwd = async (path) => {
    await validation.promise;
    return { ok: true, path };
  };
  host.call = async (method, params) => {
    if (method === "system.home") return { home: "/Users/tester" };
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
    if (method === "files.list") return { entries: [] };
    if (method === "files.watchStart" || method === "files.watchStop") return { ok: true };
    if (method === "worktrees.list")
      return { projectRoot: params.projectRoot ?? "", isGit: false, isTopLevel: false, worktrees: [] };
    if (method === "channels.list") return { accounts: [], statuses: [], pairings: [], bindings: [], activities: [] };
    if (method === "processes.list") return { revision: 1, processes: [] };
    if (method === "agent.generateTitle") return { title: null };
    throw new Error(`unexpected shell request: ${method}`);
  };
  const boundary = installRendererApi(dom.window, api, () => host, { bridge });
  const view = await mount(
    t,
    api.AppShell,
    {
      chatAppearance: { fontSize: "standard", layout: "fixed" },
      chatAppearanceSaving: false,
      onChatAppearanceChange: async () => {},
    },
    { release: boundary.close },
  );
  assert.equal(typeof deepLink, "function");
  await act(async () => deepLink("sB"));
  await act(async () => {
    validation.resolve();
    lookup.resolve();
  });
  await settle();
  assert.match(view.container.textContent, /Deep-linked fixture conversation/);
  assert.equal(dom.window.location.search, "?session=sB");
  assert.deepEqual(writes.at(-1), { lastSpaceCwd: "/B" });
  const remembered = writes.slice();
  await settle();
  assert.deepEqual(writes, remembered, "settled UI does not keep rewriting the remembered space");
  assert.match(view.container.textContent, /Deep-linked fixture conversation/);
  assert.equal(dom.window.location.search, "?session=sB");
});
