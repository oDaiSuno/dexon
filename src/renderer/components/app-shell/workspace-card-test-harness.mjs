import path from "node:path";
import { act, createElement } from "react";
import { create } from "react-test-renderer";
import { importTestBundle } from "#test-bundle";
import { realRendererGraphOptions } from "../renderer-real-graph.mjs";
import { createFolderBrowserHost, remoteServer } from "../remote-folder-picker/folder-browser-test-helpers.mjs";

const root = path.resolve(import.meta.dirname, "../../../..");
const api = await importTestBundle("workspace-card-hook", {
  stdin: {
    contents: [
      'export { useWorkspaceCard } from "./src/renderer/components/app-shell/use-workspace-card.ts";',
      'export { workspaceStore } from "./src/renderer/lib/workspace-store.ts";',
      'export { environmentRegistry } from "./src/renderer/lib/environment-registry.ts";',
      'export { resetRpc } from "./src/renderer/lib/api-client.ts";',
    ].join("\n"),
    resolveDir: root,
    sourcefile: "workspace-card-hook-entry.ts",
    loader: "ts",
  },
  ...realRendererGraphOptions(root),
});

export const primary = (generation = 1) => ({
  ...remoteServer("primary", { phase: "connected", generation, since: 0 }),
  target: { kind: "primary" },
});
export const mount = (environmentId, folder) => ({
  key: JSON.stringify([environmentId, folder]),
  environmentId,
  path: folder,
  displayPath: folder,
});
export const branches = (folder, branch = "main") => ({
  isGit: true,
  isTopLevel: true,
  branches: [
    { name: branch, isCurrent: true, isMainFolder: true, worktreePath: folder, committedAt: null },
    { name: "topic", isCurrent: false, isMainFolder: false, worktreePath: null, committedAt: null },
  ],
  detached: [],
});

export async function mountCard(
  t,
  { spaces = [mount("primary", "/work/app")], servers = [primary(), remoteServer("gpu")], reply, ...overrides } = {},
) {
  api.resetRpc();
  const host = await createFolderBrowserHost(api, {
    servers,
    reply:
      reply ??
      ((id, method, params) => {
        if (method === "system.validateCwd") return { ok: true, path: params.path };
        if (method === "git.branch") return { isGit: true, branch: `${id}-main` };
        if (method === "worktrees.branches") return branches(params.cwd, `${id}-main`);
        throw new Error(`Unexpected request ${method}`);
      }),
  });
  api.environmentRegistry.initialize();
  await Promise.resolve();
  const navigations = [];
  let personalReturns = 0;
  const workspace = {
    selectedProject: "/work/app",
    selectedCwd: "/work/app",
    showWorktreeSwitcher: false,
    worktreeState: null,
    wtRefreshKey: 0,
    wtNewOpen: false,
    wtNewBranch: "",
    wtBusy: false,
    wtError: null,
    wtConfirmRemove: null,
    resetWorktreeDropdownForOutsideClick() {},
    setNewWorktreeBranch() {},
    openNewWorktreeEntry() {},
    closeNewWorktreeEntry() {},
    cancelWorktreeRemove() {},
    createWorktreeAt: async () => null,
    handleRemoveWorktree: async () => {},
    ...overrides.workspace,
  };
  let props = {
    environmentId: "primary",
    open: true,
    spaces,
    environments: servers,
    currentFolder: "/work/app",
    currentProject: { name: "App", path: "/work/app" },
    isMissing: () => false,
    personalCwd: "/home/dev/.dexon",
    homeDir: "/home/dev",
    onGoToFolder: async (folder, environmentId) => {
      navigations.push({ folder, environmentId });
      return { ok: true };
    },
    onReturnToPersonalSpace() {
      personalReturns += 1;
    },
    onSwitched() {},
    ...overrides,
    workspace,
  };
  let card;
  let renderer;
  function Probe(input) {
    card = api.useWorkspaceCard(input);
    return null;
  }
  const update = async (patch) => {
    props = { ...props, ...patch };
    await act(async () => renderer.update(createElement(Probe, props)));
  };
  t.after(async () => {
    await act(async () => renderer?.unmount());
    api.resetRpc();
    host.close();
  });
  await act(async () => {
    renderer = create(createElement(Probe, props));
  });
  return {
    ...host,
    get: () => card,
    navigations,
    personalReturns: () => personalReturns,
    update,
    run: async (action) => {
      await act(async () => action(card));
    },
    changeEnvironments: async (next) => {
      await host.changeServers(next);
      await update({ environments: next });
    },
  };
}
