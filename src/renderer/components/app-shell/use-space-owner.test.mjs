import { dom, restoreGlobals } from "../resource-dom-environment.mjs";
import assert from "node:assert/strict";
import path from "node:path";
import test, { after } from "node:test";
import { act, createElement, useRef, useSyncExternalStore } from "react";
import { create } from "react-test-renderer";
import { createRoot } from "react-dom/client";
import { importTestBundle } from "#test-bundle";
import { realRendererGraphOptions } from "../renderer-real-graph.mjs";
import { createFolderBrowserHost, remoteServer } from "../remote-folder-picker/folder-browser-test-helpers.mjs";

after(restoreGlobals);

const root = path.resolve(import.meta.dirname, "../../../..");
const api = await importTestBundle("space-owner-cross-environment", {
  stdin: {
    contents: [
      'export { useSpaceOwner } from "./src/renderer/components/app-shell/use-space-owner.ts";',
      'export { useDraftCarry } from "./src/renderer/components/app-shell/use-draft-carry.ts";',
      'export { useSpaceCoordination } from "./src/renderer/components/app-shell/use-space-coordination.ts";',
      'export { useComposerDraft } from "./src/renderer/components/chat-input/use-composer-draft.ts";',
      'export { workspaceStore, resolveWorkspaceLocation } from "./src/renderer/lib/workspace-store.ts";',
      'export { environmentRegistry } from "./src/renderer/lib/environment-registry.ts";',
      'export { resetRpc } from "./src/renderer/lib/api-client.ts";',
      'export { newSessionDraftKey } from "./src/renderer/lib/unsaved-messages.ts";',
      'export { getDraft, setDraft, resetDraftCache } from "./src/renderer/lib/draft-store.ts";',
    ].join("\n"),
    resolveDir: root,
    sourcefile: "space-owner-cross-environment-entry.ts",
    loader: "ts",
  },
  ...realRendererGraphOptions(root),
});

async function mountProbe(t, hook, options = {}) {
  api.resetRpc();
  api.resetDraftCache();
  const host = await createFolderBrowserHost(api, {
    servers: [remoteServer("primary"), remoteServer("gpu")],
    reply: (id, method, params) => {
      if (method === "system.home") return { home: id === "primary" ? "/home/local" : "/home/remote" };
      if (method === "system.defaultCwd") return { cwd: "/shared" };
      if (method === "system.validateCwd") return { ok: true, path: params.path };
      if (method === "worktrees.list")
        return {
          projectRoot: params.projectRoot,
          isGit: true,
          isTopLevel: true,
          worktrees: [{ path: params.projectRoot, branch: "main", isMain: true }],
        };
      throw new Error(`Unexpected ${method}`);
    },
    ...options,
  });
  let value;
  let renderer;
  function Probe() {
    value = hook();
    return value.element ?? null;
  }
  t.after(async () => {
    await act(async () => renderer?.unmount());
    api.resetRpc();
    api.resetDraftCache();
    host.close();
  });
  await act(async () => {
    if (options.dom) {
      renderer = createRoot(dom.window.document.createElement("main"));
      renderer.render(createElement(Probe));
    } else renderer = create(createElement(Probe));
  });
  return {
    ...host,
    get: () => value,
    run: async (action) => act(async () => action(api)),
  };
}

const translate = (_key, fallback) => fallback;
const ignoreNotice = () => {};

function useDraftProbe() {
  const { focus } = useSyncExternalStore(api.workspaceStore.subscribe, api.workspaceStore.getSnapshot);
  const draft = api.useComposerDraft({
    draftKey: api.newSessionDraftKey("/shared", focus.environmentId),
    t: translate,
    onImageNotice: ignoreNotice,
  });
  const carry = api.useDraftCarry({
    enabled: true,
    currentFolder: "/shared",
    take: draft.takeDraft,
    restore: draft.edit,
  });
  return { draft, ...carry };
}

test("carrying a draft to an identical path in another environment keeps both identities distinct and can roll back", async (t) => {
  const host = await mountProbe(t, useDraftProbe);
  api.setDraft('new:["gpu","/shared"]', { value: "existing remote draft" });
  await host.run(() => host.get().draft.edit("from local"));
  let rollback;
  await host.run(() => {
    rollback = host.get().carry("/shared", "gpu");
  });
  assert.equal(api.getDraft('new:["gpu","/shared"]')?.value, "from local\n\nexisting remote draft");
  assert.equal(api.getDraft("new:/shared"), null);
  assert.equal(host.get().draft.shown, "");
  await host.run(() => rollback());
  assert.equal(api.getDraft('new:["gpu","/shared"]')?.value, "existing remote draft");
  assert.equal(api.getDraft("new:/shared")?.value, "from local");
  assert.equal(host.get().draft.shown, "from local");
});

function useOwnerProbe() {
  const snapshot = useSyncExternalStore(api.workspaceStore.subscribe, api.workspaceStore.getSnapshot);
  const coordination = api.useSpaceCoordination({
    sessionIntent: "existing-chat",
    sessionResolved: true,
    sessionFound: true,
    sessionCwd: null,
  });
  const editor = useRef(null);
  const owner = api.useSpaceOwner({
    refreshKey: 0,
    coordination,
    onCwdCommitted: () => {},
    location: api.resolveWorkspaceLocation(snapshot, null),
    spaceFrozen: false,
    sessionLocation: null,
    draftCarrier: {
      enabled: true,
      take: () => editor.current?.takeDraft() ?? "",
      restore: (text) => editor.current?.edit(text),
    },
  });
  const draft = api.useComposerDraft({
    draftKey: api.newSessionDraftKey(owner.workspace.selectedCwd, snapshot.focus.environmentId),
    t: translate,
    onImageNotice: ignoreNotice,
  });
  editor.current = draft;
  return { owner, draft };
}

test("a local to remote to local same-path journey carries the draft before focus switches and preserves each root", async (t) => {
  const host = await mountProbe(t, useOwnerProbe);
  await host.run(() => {
    api.workspaceStore.noteCurrentProject({ environmentId: "primary", path: "/shared" }, null);
    api.workspaceStore.noteCurrentProject({ environmentId: "gpu", path: "/shared" }, null);
    api.workspaceStore.openSpace({ environmentId: "primary", path: "/shared" });
  });
  api.setDraft('new:["gpu","/shared"]', { value: "remote already here" });
  await host.run(() => host.get().draft.edit("local sentence"));
  let outcome;
  await host.run(async () => {
    outcome = await host.get().owner.goToFolder("/shared", "gpu");
  });
  assert.deepEqual(outcome, { ok: true });
  assert.deepEqual(api.workspaceStore.getSnapshot().focus, {
    environmentId: "gpu",
    spaceKey: '["gpu","/shared"]',
    sessionId: null,
  });
  assert.equal(host.get().owner.project.path, "/shared");
  assert.equal(host.get().owner.workspace.selectedCwd, "/shared");
  assert.equal(host.get().draft.shown, "local sentence\n\nremote already here");
  assert.equal(api.getDraft("new:/shared"), null);
  await host.run(() => host.get().draft.edit("edited on remote"));
  await host.run(async () => {
    outcome = await host.get().owner.goToFolder("/shared", "primary");
  });
  assert.deepEqual(outcome, { ok: true });
  assert.deepEqual(api.workspaceStore.getSnapshot().focus, {
    environmentId: "primary",
    spaceKey: '["primary","/shared"]',
    sessionId: null,
  });
  assert.equal(host.get().owner.project.path, "/shared");
  assert.equal(host.get().draft.shown, "edited on remote");
  assert.equal(api.getDraft('new:["gpu","/shared"]'), null);
});

test("remote personal-looking folders keep their local filename instead of the local personal label", async (t) => {
  const host = await mountProbe(t, useOwnerProbe);
  await host.run(() => {
    api.workspaceStore.noteCurrentProject({ environmentId: "primary", path: "/home/local/.dexon" }, null);
    api.workspaceStore.noteCurrentProject({ environmentId: "gpu", path: "/home/remote/.dexon" }, null);
    api.workspaceStore.openSpace({ environmentId: "primary", path: "/home/local/.dexon" });
  });
  assert.equal(host.get().owner.project.name, "Default space");
  await host.run(() => {
    api.workspaceStore.openSpace({ environmentId: "gpu", path: "/home/remote/.dexon" });
  });
  assert.equal(host.get().owner.project.name, ".dexon");
});

test("a canonicalized remote folder receives the draft under its validated path, not the requested alias", async (t) => {
  const host = await mountProbe(t, useOwnerProbe);
  await host.run(() => {
    api.workspaceStore.noteCurrentProject({ environmentId: "primary", path: "/shared" }, null);
    api.workspaceStore.noteCurrentProject({ environmentId: "gpu", path: "/canonical" }, null);
    api.workspaceStore.openSpace({ environmentId: "primary", path: "/shared" });
  });
  await host.run(() => host.get().draft.edit("follow the real folder"));
  api.setDraft('new:["gpu","/canonical"]', { value: "existing canonical draft" });
  host.setReply((_id, method, params) => {
    if (method === "system.validateCwd") return { ok: true, path: "/canonical" };
    if (method === "system.home") return { home: "/home/remote" };
    return { projectRoot: params.projectRoot, isGit: false, isTopLevel: true, worktrees: [] };
  });
  await host.run(async () => {
    assert.deepEqual(await host.get().owner.goToFolder("/alias", "gpu"), { ok: true });
  });
  assert.equal(host.get().draft.shown, "follow the real folder\n\nexisting canonical draft");
  assert.equal(api.getDraft('new:["gpu","/alias"]'), null);
  assert.equal(api.getDraft("new:/shared"), null);
});

test("returning from a remote folder to the same-path local personal space carries the captured remote draft", async (t) => {
  const host = await mountProbe(t, useOwnerProbe);
  await host.run(() => {
    api.workspaceStore.noteCurrentProject({ environmentId: "primary", path: "/shared" }, null);
    api.workspaceStore.noteCurrentProject({ environmentId: "gpu", path: "/shared" }, null);
    api.workspaceStore.openSpace({ environmentId: "gpu", path: "/shared" });
  });
  await host.run(() => host.get().draft.edit("bring the remote sentence home"));
  host.setReply((_id, method, params) => {
    if (method === "system.defaultCwd") return { cwd: "/shared" };
    if (method === "system.home") return { home: "/home/local" };
    if (method === "system.validateCwd") return { ok: true, path: params.path };
    return { projectRoot: params.projectRoot, isGit: false, isTopLevel: true, worktrees: [] };
  });
  await host.run(() => host.get().owner.handleReturnToPersonalSpace());
  assert.equal(api.workspaceStore.getSnapshot().focus.environmentId, "primary");
  assert.equal(host.get().draft.shown, "bring the remote sentence home");
  assert.equal(api.getDraft('new:["gpu","/shared"]'), null);
});

function DraftEditor({ editor, environmentId, cwd }) {
  editor.current = api.useComposerDraft({
    draftKey: api.newSessionDraftKey(cwd, environmentId),
    t: translate,
    onImageNotice: ignoreNotice,
  });
  return null;
}

function useKeyedOwnerProbe() {
  const snapshot = useSyncExternalStore(api.workspaceStore.subscribe, api.workspaceStore.getSnapshot);
  const coordination = api.useSpaceCoordination({
    sessionIntent: null,
    sessionResolved: true,
    sessionFound: false,
    sessionCwd: null,
  });
  const editor = useRef(null);
  const owner = api.useSpaceOwner({
    refreshKey: 0,
    coordination,
    onCwdCommitted: () => {},
    location: api.resolveWorkspaceLocation(snapshot, null),
    spaceFrozen: false,
    sessionLocation: null,
    draftCarrier: {
      enabled: true,
      take: () => editor.current?.takeDraft() ?? "",
      restore: (text) => editor.current?.edit(text),
    },
  });
  return {
    owner,
    editor,
    element: createElement(DraftEditor, {
      key: snapshot.focus.environmentId,
      editor,
      environmentId: snapshot.focus.environmentId,
      cwd: owner.workspace.selectedCwd,
    }),
  };
}

test("returning to local personal space keeps the remote draft even when focus remounts the editor before completion", async (t) => {
  const host = await mountProbe(t, useKeyedOwnerProbe, { dom: true, target: dom.window });
  await host.run(() => {
    api.workspaceStore.noteCurrentProject({ environmentId: "primary", path: "/shared" }, null);
    api.workspaceStore.noteCurrentProject({ environmentId: "gpu", path: "/shared" }, null);
    api.workspaceStore.openSpace({ environmentId: "gpu", path: "/shared" });
  });
  await host.run(() => host.get().editor.current.edit("typed in the remote editor"));
  await host.run(() => host.get().owner.handleReturnToPersonalSpace());
  assert.equal(api.workspaceStore.getSnapshot().focus.environmentId, "primary");
  assert.equal(host.get().editor.current.shown, "typed in the remote editor");
  assert.equal(api.getDraft('new:["gpu","/shared"]'), null);
});

test("an unavailable remote folder leaves both drafts and the current workspace unchanged", async (t) => {
  const host = await mountProbe(t, useOwnerProbe);
  await host.run(() => {
    api.workspaceStore.noteCurrentProject({ environmentId: "primary", path: "/shared" }, null);
    api.workspaceStore.openSpace({ environmentId: "primary", path: "/shared" });
  });
  await host.run(() => host.get().draft.edit("keep this local text"));
  api.setDraft('new:["gpu","/missing"]', { value: "keep remote text" });
  const focus = api.workspaceStore.getSnapshot().focus;
  host.setReply(() => ({ ok: false, error: "Remote folder is unavailable" }));
  await host.run(async () => {
    assert.deepEqual(await host.get().owner.goToFolder("/missing", "gpu"), {
      ok: false,
      error: "Remote folder is unavailable",
    });
  });
  assert.equal(api.workspaceStore.getSnapshot().focus, focus);
  assert.equal(host.get().draft.shown, "keep this local text");
  assert.equal(api.getDraft("new:/shared")?.value, "keep this local text");
  assert.equal(api.getDraft('new:["gpu","/missing"]')?.value, "keep remote text");
});
