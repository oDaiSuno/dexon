import assert from "node:assert/strict";
import test, { after } from "node:test";
import { act, click, createElement, dom, loadRenderer, mount, restoreGlobals, waitFor } from "../support/renderer.mjs";
import { allByRole, getByRole } from "../support/dom-queries.mjs";
import { useRef } from "react";
import {
  createFolderBrowserHost,
  remoteServer,
} from "../../src/renderer/components/remote-folder-picker/folder-browser-test-helpers.mjs";

const api = await loadRenderer(
  "composer-cross-environment",
  [
    'export {useShellSpace} from "./src/renderer/components/app-shell/use-shell-space.ts";',
    'export {useSpaceCoordination} from "./src/renderer/components/app-shell/use-space-coordination.ts";',
    'export {useWorkspaceNavigation} from "./src/renderer/components/app-shell/use-workspace-navigation.ts";',
    'export {ChatWindow} from "./src/renderer/components/ChatWindow.tsx";',
    'export {ThinkingExpansionStore} from "./src/renderer/lib/thinking-expansion-store.ts";',
    'export {workspaceStore, resolveWorkspaceLocation} from "./src/renderer/lib/workspace-store.ts";',
    'export {environmentRegistry} from "./src/renderer/lib/environment-registry.ts";',
  ].join("\n"),
);
api.setAppLanguage("en-US");
after(restoreGlobals);

const SHARED_ROOT = "/work/app";
const REMOTE_WORKTREE = "/work/app-review";
const LOCAL_DRAFT = "Keep this actually typed sentence while changing computers.";
const REMOTE_DRAFT = "Edited in the remote worktree; bring this sentence back home.";
const ignore = () => {};

function ComposerScene() {
  const chatInputRef = useRef(null);
  const thinkingExpansionStore = useRef(new api.ThinkingExpansionStore()).current;
  const processDetailsExpansionStore = useRef(new api.ThinkingExpansionStore()).current;
  const navigation = api.useWorkspaceNavigation({
    isMobile: false,
    onMobileSidebarClose: ignore,
    onTopPanelDismiss: ignore,
    onSwitchSessionRequested: ignore,
  });
  const coordination = api.useSpaceCoordination({
    sessionIntent: navigation.initialSessionId,
    sessionResolved: navigation.initialSessionRestored,
    sessionFound: navigation.selectedSession !== null,
    sessionCwd: navigation.newSessionCwd,
  });
  const { composerWorkspace, openProjects } = api.useShellSpace({
    refreshKey: navigation.refreshKey,
    coordination,
    selectedSession: navigation.selectedSession,
    spaceFrozenSessionId: navigation.spaceFrozenSessionId,
    chatInputRef,
    onCwdCommitted: navigation.handleCwdChange,
    location: navigation.newSessionCwd
      ? { environmentId: navigation.environmentId, path: navigation.newSessionCwd }
      : navigation.location,
    onBranchSwitched: navigation.bumpRefresh,
  });
  const location = api.resolveWorkspaceLocation(
    navigation.workspaceSnapshot,
    navigation.selectedSession,
    openProjects.spaces,
  );
  return createElement(api.ChatWindow, {
    key: `${navigation.environmentId}:${navigation.sessionKey}`,
    environmentId: navigation.environmentId,
    session: navigation.selectedSession,
    newSessionCwd: navigation.newSessionCwd ?? location?.path ?? null,
    chatInputRef,
    workspace: composerWorkspace,
    thinkingExpansionStore,
    processDetailsExpansionStore,
  });
}

function trigger(container) {
  return getByRole(container, "button", /^Workspace: /);
}

function editor(container) {
  return getByRole(getByRole(container, "region", "Chat"), "textbox");
}

async function typeDraft(container, value) {
  const textbox = editor(container);
  await act(async () => {
    textbox.focus();
    textbox.textContent = value;
    const range = dom.window.document.createRange();
    range.selectNodeContents(textbox);
    range.collapse(false);
    dom.window.getSelection().removeAllRanges();
    dom.window.getSelection().addRange(range);
    textbox.dispatchEvent(new dom.window.InputEvent("input", { bubbles: true }));
  });
  await waitFor(() => assert.equal(editor(container).textContent, value));
}

async function openCard(container) {
  await click(trigger(container));
  return waitFor(() => getByRole(container, "group", "Workspace"));
}

async function expectLocation(host, container, { environmentId, cwd, root, label, draft }) {
  await waitFor(() => {
    assert.deepEqual(api.workspaceStore.getSnapshot().focus, {
      environmentId,
      spaceKey: JSON.stringify([environmentId, root]),
      sessionId: null,
    });
    assert.equal(trigger(container).getAttribute("aria-label"), label);
    assert.equal(trigger(container).title, `Switch worktree: ${cwd}`);
    assert.equal(editor(container).textContent, draft, `the typed draft follows navigation to ${environmentId}:${cwd}`);
    assert.ok(
      host.requests.some(
        (request) =>
          request.environmentId === environmentId && request.method === "models.list" && request.params.cwd === cwd,
      ),
      `the real chat loads models for ${environmentId}:${cwd}`,
    );
  });
}

test("a typed composer draft follows local-to-remote-to-local card navigation while same-path projects and remote branches keep their machine and root", async (t) => {
  api.resetRpc();
  let remoteBranch = "remote-main";
  const unexpectedRequests = [];
  const host = await createFolderBrowserHost(api, {
    target: dom.window,
    servers: [
      { ...remoteServer("primary"), label: "This computer", target: { kind: "primary" } },
      { ...remoteServer("gpu"), label: "Build server" },
    ],
    reply(environmentId, method, params) {
      const remote = environmentId === "gpu";
      const home = remote ? "/home/remote" : "/home/local";
      if (method === "system.home") return { home };
      if (method === "system.defaultCwd") return { cwd: SHARED_ROOT };
      if (method === "system.automationCwd") return { cwd: `${home}/.dexon/automations` };
      if (method === "automation.listInbox") return { items: [] };
      if (method === "system.validateCwd") return { ok: true, path: params.path };
      if (method === "sessions.list") return { sessions: [], runningSessionIds: [], sessionStatuses: {} };
      if (method === "models.sessionNaming.get") return { enabled: true, model: null, configured: true };
      if (method === "models.list") return { models: [], nameMap: {}, catalog: {} };
      if (method === "skills.list") return { skills: [] };
      if (method === "files.index") return { files: [], truncated: false };
      if (method === "git.branch") return { isGit: true, branch: remote ? remoteBranch : "local-main" };
      if (method === "worktrees.list")
        return {
          projectRoot: SHARED_ROOT,
          isGit: true,
          isTopLevel: true,
          worktrees: remote
            ? [
                { path: SHARED_ROOT, branch: remoteBranch, isMain: true },
                { path: REMOTE_WORKTREE, branch: "review", isMain: false },
              ]
            : [{ path: SHARED_ROOT, branch: "local-main", isMain: true }],
        };
      if (method === "worktrees.branches") {
        const current = params.cwd === REMOTE_WORKTREE ? "review" : remote ? remoteBranch : "local-main";
        return {
          projectRoot: SHARED_ROOT,
          isGit: true,
          isTopLevel: true,
          current,
          mainFolder: SHARED_ROOT,
          detached: [],
          branches: (remote ? ["remote-main", "feature/remote", "review"] : ["local-main"]).map((name) => ({
            name,
            isCurrent: name === current,
            committedAt: "2026-08-06T00:00:00.000Z",
            worktreePath:
              name === "review"
                ? REMOTE_WORKTREE
                : name === (remote ? remoteBranch : "local-main")
                  ? SHARED_ROOT
                  : null,
            isMainFolder: name === (remote ? remoteBranch : "local-main"),
            stalePath: null,
          })),
        };
      }
      if (method === "worktrees.switchBranch") {
        if (remote) remoteBranch = params.branch;
        return { ok: true };
      }
      unexpectedRequests.push({ environmentId, method, params });
      throw new Error(`Unexpected composer Host request: ${environmentId}:${method}`);
    },
  });
  dom.window.piBridge.getHostStatus = async () => "ready";
  dom.window.piBridge.onHostStatus = () => () => {};
  let view;
  t.after(async () => {
    await view?.unmount();
    api.resetRpc();
    await act(async () => host.close());
  });
  await act(async () => {
    api.environmentRegistry.initialize();
    api.workspaceStore.noteCurrentProject({ environmentId: "primary", path: SHARED_ROOT }, null);
    api.workspaceStore.noteCurrentProject({ environmentId: "gpu", path: SHARED_ROOT }, null);
    api.workspaceStore.openSpace({ environmentId: "primary", path: SHARED_ROOT });
  });
  view = await mount(t, ComposerScene);
  const container = view.container;
  await expectLocation(host, container, {
    environmentId: "primary",
    cwd: SHARED_ROOT,
    root: SHARED_ROOT,
    label: "Workspace: Default space, branch local-main",
    draft: "",
  });
  await typeDraft(container, LOCAL_DRAFT);
  t.diagnostic("The real local ChatWindow mounted and accepted the typed draft.");

  let card = await openCard(container);
  const local = getByRole(card, "group", "This computer");
  const remote = getByRole(card, "group", "Build server");
  assert.equal(getByRole(local, "button", "Default space").getAttribute("aria-current"), "true");
  assert.equal(getByRole(remote, "button", "app").getAttribute("aria-current"), null);
  assert.equal(allByRole(remote, "button", "Default space").length, 0);
  await click(getByRole(remote, "button", "app"));
  await expectLocation(host, container, {
    environmentId: "gpu",
    cwd: SHARED_ROOT,
    root: SHARED_ROOT,
    label: "Workspace: app, branch remote-main",
    draft: LOCAL_DRAFT,
  });
  t.diagnostic("The remote same-path project opened with remote attribution and the original typed draft.");

  card = await openCard(container);
  assert.equal(
    getByRole(getByRole(card, "group", "Build server"), "button", "app").getAttribute("aria-current"),
    "true",
  );
  assert.equal(allByRole(getByRole(card, "group", "Build server"), "button", "Default space").length, 0);
  await click(getByRole(getByRole(card, "group", "This computer"), "button", "Default space"));
  await expectLocation(host, container, {
    environmentId: "primary",
    cwd: SHARED_ROOT,
    root: SHARED_ROOT,
    label: "Workspace: Default space, branch local-main",
    draft: LOCAL_DRAFT,
  });

  card = await openCard(container);
  await click(getByRole(getByRole(card, "group", "Build server"), "button", "Show branches of app"));
  const branches = await waitFor(() => getByRole(card, "group", "app branches"));
  await click(await waitFor(() => getByRole(branches, "button", "feature/remote")));
  await waitFor(() =>
    assert.equal(host.requests.filter((request) => request.method === "worktrees.switchBranch").length, 1),
  );
  assert.deepEqual(
    host.requests
      .filter((request) => request.method === "worktrees.switchBranch")
      .map(({ environmentId, params }) => ({ environmentId, params })),
    [{ environmentId: "gpu", params: { cwd: SHARED_ROOT, branch: "feature/remote" } }],
    "browsing a remote branch from the local composer must never switch the local repository",
  );
  await expectLocation(host, container, {
    environmentId: "gpu",
    cwd: SHARED_ROOT,
    root: SHARED_ROOT,
    label: "Workspace: app, branch feature/remote",
    draft: LOCAL_DRAFT,
  });

  card = await openCard(container);
  const review = await waitFor(() => getByRole(getByRole(card, "group", "app branches"), "button", "review"));
  assert.equal(review.title, REMOTE_WORKTREE);
  await click(review);
  await expectLocation(host, container, {
    environmentId: "gpu",
    cwd: REMOTE_WORKTREE,
    root: SHARED_ROOT,
    label: "Workspace: app, branch review",
    draft: LOCAL_DRAFT,
  });
  assert.ok(
    host.requests.some(
      (request) =>
        request.environmentId === "gpu" &&
        request.method === "worktrees.list" &&
        request.params.projectRoot === REMOTE_WORKTREE,
    ),
    "the remote worktree is resolved by the remote Host without replacing the mounted project root",
  );
  await typeDraft(container, REMOTE_DRAFT);

  card = await openCard(container);
  await click(getByRole(getByRole(card, "group", "This computer"), "button", "Default space"));
  await expectLocation(host, container, {
    environmentId: "primary",
    cwd: SHARED_ROOT,
    root: SHARED_ROOT,
    label: "Workspace: Default space, branch local-main",
    draft: REMOTE_DRAFT,
  });
  assert.ok(
    host.requests
      .filter((request) => request.method === "system.defaultCwd")
      .every((request) => request.environmentId === "primary"),
    "only the local default space may request the local personal directory",
  );
  assert.deepEqual(unexpectedRequests, []);
  t.diagnostic(
    "Real composer journey completed: local → same-path remote → local → remote branch → remote worktree → local; typed draft preserved.",
  );
});
