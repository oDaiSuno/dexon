import assert from "node:assert/strict";
import test, { after } from "node:test";
import { act, dom, loadRenderer, mount, restoreGlobals, waitFor } from "../support/renderer.mjs";
import { createFolderBrowserHost } from "../../src/renderer/components/remote-folder-picker/folder-browser-test-helpers.mjs";

const api = await loadRenderer(
  "workspace-git-reconnect",
  'export {useWorkspaceCard} from "./src/renderer/components/app-shell/use-workspace-card.ts"; export {useSessionLocation} from "./src/renderer/components/app-shell/use-session-location.ts"; export {useChangedPaths} from "./src/renderer/components/file-explorer/use-changed-paths.ts"; export {workspaceStore} from "./src/renderer/lib/workspace-store.ts"; export {environmentRegistry, useEnvironments} from "./src/renderer/lib/environment-registry.ts";',
);
api.setAppLanguage("en-US");
after(restoreGlobals);

const noop = () => {};
const isMissing = () => false;
const mountedSpace = (environmentId, path) => ({
  environmentId,
  path,
  key: JSON.stringify([environmentId, path]),
  displayPath: path,
});
const spaces = [mountedSpace("gpu", "/same")];
const workspace = { selectedProject: "/same", selectedCwd: "/same", wtRefreshKey: 0 };

test("Git queries use their explicit owner and distinguish unavailable data from clean and non-Git replies across reconnect", async (t) => {
  let branch = "main";
  let isGit = true;
  let fail = false;
  const host = await createFolderBrowserHost(api, {
    target: dom.window,
    reply(_id, method, params) {
      if (fail) throw Object.assign(new Error("Git transport disconnected"), { code: "DISCONNECTED" });
      if (method === "system.validateCwd") return { ok: true, path: params.path };
      if (method === "git.status") return { isGit, entries: branch === "main" ? [] : [{ path: "changed.txt" }] };
      if (method === "git.branch") return { isGit, branch: isGit ? branch : null };
      if (method === "worktrees.list") return { worktrees: [{ path: "/same", isMain: false }] };
      if (method === "worktrees.branches")
        return {
          isGit,
          isTopLevel: isGit,
          branches: [{ name: branch, isCurrent: true, worktreePath: "/same" }],
          detached: [],
        };
      return { ok: true };
    },
  });
  t.after(async () => act(async () => host.close()));
  api.environmentRegistry.initialize();
  await act(async () => api.workspaceStore.openSpace({ environmentId: "staging", path: "/same" }));
  let state;
  function Probe({ refreshKey = 0 }) {
    const environments = api.useEnvironments();
    state = {
      changed: api.useChangedPaths("gpu", "/same", refreshKey),
      location: api.useSessionLocation("gpu", "/same"),
      card: api.useWorkspaceCard({
        environmentId: "gpu",
        workspace: { ...workspace, wtRefreshKey: refreshKey },
        open: true,
        spaces,
        environments,
        currentFolder: "/same",
        currentProject: null,
        isMissing,
        personalCwd: null,
        homeDir: "/home/dev",
        onGoToFolder: async () => ({ ok: true }),
        onReturnToPersonalSpace: noop,
        onSwitched: noop,
      }),
    };
    return null;
  }
  const view = await mount(t, Probe);
  await waitFor(() => assert.equal(state.card.pane.state, "ready"));
  assert.equal(state.changed.status, "ready");
  assert.equal(state.changed.changedPaths.size, 0);
  assert.deepEqual(state.location, { status: "ready", branch: "main", isWorktree: true });
  assert.equal(state.card.projects[0].subline, "main");
  fail = true;
  await view.update({ refreshKey: 1 });
  await waitFor(() => assert.equal(state.changed.status, "unavailable"));
  await waitFor(() => assert.match(state.card.error, /Git transport disconnected/));
  assert.equal(state.changed.changedPaths, null);
  assert.notEqual(state.card.pane.state, "not-repo");
  assert.notEqual(state.card.projects[0].subline, "Not a git repository");
  await host.disconnect("gpu");
  await waitFor(() => assert.deepEqual(state.location, { status: "unavailable" }));
  fail = false;
  branch = "recovered";
  await host.reconnect("gpu", 2);
  await waitFor(() => assert.equal(state.card.projects[0].subline, "recovered"));
  assert.equal(state.card.pane.state, "ready");
  assert.equal(state.card.error, undefined);
  assert.deepEqual(state.location, { status: "ready", branch: "recovered", isWorktree: true });
  assert.equal(state.changed.status, "ready");
  assert.deepEqual([...state.changed.changedPaths], ["changed.txt"]);
  isGit = false;
  await view.update({ refreshKey: 2 });
  await waitFor(() => assert.equal(state.card.pane.state, "not-repo"));
  assert.equal(state.card.projects[0].subline, "Not a git repository");
  assert.deepEqual(state.changed, { status: "ready", changedPaths: null });
  assert.ok(host.requests.every((request) => request.environmentId === "gpu"));
});

test("changing a workspace card's owner never sends the previous machine's browsed folder to the new machine", async (t) => {
  const host = await createFolderBrowserHost(api, {
    target: dom.window,
    reply(id, method, params) {
      if (method === "system.validateCwd") return { ok: true, path: params.path };
      if (method === "git.branch") return { isGit: true, branch: id };
      return { isGit: true, isTopLevel: true, branches: [], detached: [] };
    },
  });
  t.after(async () => act(async () => host.close()));
  api.environmentRegistry.initialize();
  let card;
  const choices = { gpu: ["/gpu-only"], staging: ["/staging-only"] };
  const mountedChoices = Object.fromEntries(
    Object.entries(choices).map(([id, paths]) => [id, paths.map((path) => mountedSpace(id, path))]),
  );
  function Probe({ environmentId }) {
    const environments = api.useEnvironments();
    const cwd = choices[environmentId][0];
    card = api.useWorkspaceCard({
      environmentId,
      workspace: { ...workspace, selectedCwd: cwd, selectedProject: cwd },
      open: true,
      spaces: mountedChoices[environmentId],
      environments,
      currentFolder: cwd,
      currentProject: null,
      isMissing,
      personalCwd: null,
      homeDir: "/home/dev",
      onGoToFolder: async () => ({ ok: true }),
      onReturnToPersonalSpace: noop,
      onSwitched: noop,
    });
    return null;
  }
  const view = await mount(t, Probe, { environmentId: "gpu" });
  await waitFor(() => assert.equal(card.pane.state, "ready"));
  await view.update({ environmentId: "staging" });
  await waitFor(() => assert.equal(card.pane.state, "ready"));
  assert.ok(host.requests.some((request) => request.environmentId === "staging"));
  for (const request of host.requests) {
    assert.equal(request.params.cwd ?? request.params.path, choices[request.environmentId][0]);
  }
});
