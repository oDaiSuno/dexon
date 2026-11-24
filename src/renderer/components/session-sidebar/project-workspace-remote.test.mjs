import { useSyncExternalStore } from "react";
import assert from "node:assert/strict";
import test from "node:test";
import { api, mountProjectProbe } from "../app-shell/project-spaces-test-harness.mjs";
import { deferred, remoteServer } from "../remote-folder-picker/folder-browser-test-helpers.mjs";

const listing = (id) => ({
  projectRoot: `/${id}-root`,
  isGit: true,
  isTopLevel: true,
  worktrees: [{ path: "/work/app", branch: id, isMain: true }],
});

test("switching servers at the same folder never exposes the previous server's worktree metadata", async (t) => {
  const pending = deferred();
  const host = await mountProjectProbe(
    t,
    () => api.useProjectWorkspace({ sessions: [], selectedCwdProp: "/work/app", refreshKey: 0 }),
    {
      servers: [remoteServer("gpu"), remoteServer("staging")],
      reply: (id, method, params) =>
        method === "system.validateCwd"
          ? { ok: true, path: params.path }
          : id === "staging"
            ? pending.promise
            : listing(id),
    },
  );
  await host.run(({ workspaceStore }) => workspaceStore.openSpace({ environmentId: "gpu", path: "/work/app" }));
  assert.equal(host.get().projectRootFor("/work/app"), "/gpu-root");
  await host.run(({ workspaceStore }) => workspaceStore.openSpace({ environmentId: "staging", path: "/work/app" }));
  assert.equal(
    host.get().worktreeState,
    null,
    "no metadata from the previous server while the new response is pending",
  );
  await host.run(() => pending.resolve(listing("staging")));
  assert.equal(host.get().projectRootFor("/work/app"), "/staging-root");
});

test("read-only session location follows its server even when the folder string is unchanged", async (t) => {
  const host = await mountProjectProbe(
    t,
    () =>
      api.useSessionLocation(
        useSyncExternalStore(api.workspaceStore.subscribe, api.workspaceStore.getSnapshot).focus.environmentId,
        "/work/app",
      ),
    {
      servers: [remoteServer("gpu"), remoteServer("staging")],
      reply: (id, method) =>
        method === "git.branch"
          ? { isGit: true, branch: id }
          : { ...listing(id), worktrees: [{ path: "/work/app", branch: id, isMain: false }] },
    },
  );
  await host.run(({ workspaceStore }) => workspaceStore.openSpace({ environmentId: "gpu", path: "/work/app" }));
  assert.equal(host.get()?.branch, "gpu");
  await host.run(({ workspaceStore }) => workspaceStore.openSpace({ environmentId: "staging", path: "/work/app" }));
  assert.equal(host.get()?.branch, "staging");
  assert.equal(host.get()?.isWorktree, true);
});

test("a worktree failure from the previous server never becomes the new server's error", async (t) => {
  const pending = deferred();
  const host = await mountProjectProbe(
    t,
    () => api.useProjectWorkspace({ sessions: [], selectedCwdProp: "/work/app" }),
    {
      servers: [remoteServer("gpu"), remoteServer("staging")],
      reply: (id, method, params) =>
        method === "system.validateCwd"
          ? { ok: true, path: params.path }
          : method === "worktrees.remove"
            ? pending.promise
            : listing(id),
    },
  );
  await host.run(({ workspaceStore }) => workspaceStore.openSpace({ environmentId: "gpu", path: "/work/app" }));
  let removing;
  await host.run(() => {
    removing = host.get().handleRemoveWorktree("/work/old", true, "/gpu-root");
  });
  await host.run(({ workspaceStore }) => workspaceStore.openSpace({ environmentId: "staging", path: "/work/app" }));
  await host.run(async () => {
    pending.reject(new Error("GPU worktree unavailable"));
    await removing;
  });
  assert.equal(host.get().wtError, null);
  assert.equal(host.get().projectRootFor("/work/app"), "/staging-root");
});

test("the worktree creation prompt does not survive a connection generation change", async (t) => {
  const host = await mountProjectProbe(
    t,
    () => api.useProjectWorkspace({ sessions: [], selectedCwdProp: "/work/app" }),
    {
      servers: [remoteServer("gpu")],
      reply: (id, method, params) => (method === "system.validateCwd" ? { ok: true, path: params.path } : listing(id)),
    },
  );
  await host.run(({ workspaceStore }) => workspaceStore.openSpace({ environmentId: "gpu", path: "/work/app" }));
  await host.run(() => {
    host.get().openNewWorktreeEntry();
    host.get().setNewWorktreeBranch("before-restart");
  });
  assert.equal(host.get().wtNewOpen, true);
  await host.changeServers([remoteServer("gpu", { phase: "connected", generation: 2, since: 1000 })]);
  assert.equal(host.get().wtNewOpen, false);
  assert.equal(host.get().wtNewBranch, "");
});

test("opening an identical path in another environment uses its mounted root instead of the origin worktree root", async (t) => {
  const host = await mountProjectProbe(
    t,
    () =>
      api.useProjectWorkspace({
        sessions: [{ cwd: "/work/app", projectRoot: "/local-session-root" }],
        selectedCwdProp: "/work/app",
      }),
    {
      servers: [remoteServer("primary"), remoteServer("gpu")],
      reply: (id, method, params) => (method === "system.validateCwd" ? { ok: true, path: params.path } : listing(id)),
    },
  );
  await host.run(({ workspaceStore }) => {
    workspaceStore.noteCurrentProject({ environmentId: "gpu", path: "/work/app" }, null);
    workspaceStore.openSpace({ environmentId: "primary", path: "/work/app" });
  });
  assert.equal(host.get().selectedProject, "/primary-root");
  let result;
  await host.run(async () => {
    result = await host.get().openDirectory("/work/app", "gpu");
  });
  assert.deepEqual(result, { status: "selected" });
  assert.deepEqual(api.workspaceStore.getSnapshot().focus, {
    environmentId: "gpu",
    spaceKey: '["gpu","/work/app"]',
    sessionId: null,
  });
});

test("creating a worktree in another environment returns its path without moving the origin workspace", async (t) => {
  const host = await mountProjectProbe(
    t,
    () => api.useProjectWorkspace({ sessions: [], selectedCwdProp: "/work/app" }),
    {
      servers: [remoteServer("primary"), remoteServer("gpu")],
      reply: (id, method, params) => {
        if (method === "system.validateCwd") return { ok: true, path: params.path };
        if (method === "worktrees.create") return { worktree: { path: `/${id}-created` } };
        return listing(id);
      },
    },
  );
  const origin = api.workspaceStore.getSnapshot().focus;
  const root = host.get().selectedProject;
  const state = host.get().worktreeState;
  const refresh = host.get().wtRefreshKey;
  let created;
  await host.run(async () => {
    created = await host.get().createWorktreeAt({ projectRoot: "/remote-repo", branch: "review" }, "gpu");
  });
  assert.equal(created, "/gpu-created");
  assert.deepEqual(
    host.requests.filter(({ method }) => method === "worktrees.create"),
    [
      {
        environmentId: "gpu",
        method: "worktrees.create",
        params: { projectRoot: "/remote-repo", cwd: "/remote-repo", branch: "review" },
      },
    ],
  );
  assert.equal(api.workspaceStore.getSnapshot().focus, origin);
  assert.equal(host.get().selectedCwd, "/work/app");
  assert.equal(host.get().selectedProject, root);
  assert.deepEqual(host.get().worktreeState, state);
  assert.equal(host.get().wtRefreshKey, refresh);
});

test("removing an identical-path remote worktree leaves the origin selection and root untouched", async (t) => {
  const host = await mountProjectProbe(
    t,
    () => api.useProjectWorkspace({ sessions: [], selectedCwdProp: "/work/app" }),
    {
      servers: [remoteServer("primary"), remoteServer("gpu")],
      reply: (id, method, params) => {
        if (method === "system.validateCwd") return { ok: true, path: params.path };
        if (method === "worktrees.remove") return {};
        return listing(id);
      },
    },
  );
  const origin = api.workspaceStore.getSnapshot().focus;
  const state = host.get().worktreeState;
  const refresh = host.get().wtRefreshKey;
  await host.run(async () => {
    await host.get().handleRemoveWorktree("/work/app", true, "/remote-root", "gpu");
  });
  assert.deepEqual(
    host.requests.filter(({ method }) => method === "worktrees.remove"),
    [
      {
        environmentId: "gpu",
        method: "worktrees.remove",
        params: { cwd: "/remote-root", path: "/work/app", force: true },
      },
    ],
  );
  assert.equal(api.workspaceStore.getSnapshot().focus, origin);
  assert.equal(host.get().selectedCwd, "/work/app");
  assert.equal(host.get().selectedProject, "/primary-root");
  assert.deepEqual(host.get().worktreeState, state);
  assert.equal(host.get().wtRefreshKey, refresh);
});

test("opening another environment's checkout keeps its mounted project root and selects the checkout", async (t) => {
  const host = await mountProjectProbe(
    t,
    () => api.useProjectWorkspace({ sessions: [], selectedCwdProp: "/work/app" }),
    {
      servers: [remoteServer("primary"), remoteServer("gpu")],
      reply: (id, method, params) =>
        method === "system.validateCwd"
          ? { ok: true, path: params.path }
          : {
              projectRoot: id === "gpu" ? "/remote-root" : "/primary-root",
              isGit: true,
              isTopLevel: true,
              worktrees: [{ path: "/work/app", branch: "review", isMain: false }],
            },
    },
  );
  await host.run(({ workspaceStore }) => {
    workspaceStore.noteCurrentProject({ environmentId: "gpu", path: "/remote-root" }, null);
  });
  await host.run(async () => {
    assert.deepEqual(await host.get().openDirectory("/work/app", "gpu"), { status: "selected" });
  });
  assert.deepEqual(api.workspaceStore.getSnapshot().focus, {
    environmentId: "gpu",
    spaceKey: '["gpu","/remote-root"]',
    sessionId: null,
  });
  assert.equal(host.get().selectedCwd, "/work/app");
  assert.equal(host.get().selectedProject, "/remote-root");
});

test("a completed remote worktree creation still returns its path when the origin focus changes while waiting", async (t) => {
  const pending = deferred();
  const host = await mountProjectProbe(
    t,
    () => api.useProjectWorkspace({ sessions: [], selectedCwdProp: "/work/app" }),
    {
      servers: [remoteServer("primary"), remoteServer("gpu")],
      reply: (id, method, params) => {
        if (method === "system.validateCwd") return { ok: true, path: params.path };
        if (method === "worktrees.create") return pending.promise;
        return listing(id);
      },
    },
  );
  let creating;
  await host.run(() => {
    creating = host.get().createWorktreeAt({ projectRoot: "/remote-repo", branch: "review" }, "gpu");
  });
  await host.run(({ workspaceStore }) => {
    workspaceStore.openSpace({ environmentId: "primary", path: "/other-local-project" });
  });
  const nextFocus = api.workspaceStore.getSnapshot().focus;
  let result;
  await host.run(async () => {
    pending.resolve({ worktree: { path: "/remote-created" } });
    result = await creating;
  });
  assert.equal(result, "/remote-created");
  assert.equal(api.workspaceStore.getSnapshot().focus, nextFocus);
  assert.equal(host.get().selectedCwd, "/work/app");
  assert.equal(host.get().selectedProject, "/primary-root");
});

test("opening a nested target folder chooses the deepest mounted root on that environment only", async (t) => {
  const host = await mountProjectProbe(
    t,
    () =>
      api.useProjectWorkspace({
        sessions: [{ cwd: "/work/app/nested/src", projectRoot: "/old-root" }],
        selectedCwdProp: "/work/app/nested/src",
      }),
    {
      servers: [remoteServer("primary"), remoteServer("gpu")],
      reply: (id, method, params) => (method === "system.validateCwd" ? { ok: true, path: params.path } : listing(id)),
    },
  );
  await host.run(({ workspaceStore }) => {
    workspaceStore.noteCurrentProject({ environmentId: "gpu", path: "/work/app/nested" }, null);
    workspaceStore.noteCurrentProject({ environmentId: "gpu", path: "/work/app" }, null);
    workspaceStore.noteCurrentProject({ environmentId: "primary", path: "/work/app/nested/src" }, null);
  });
  await host.run(async () => {
    assert.deepEqual(await host.get().openDirectory("/work/app/nested/src", "gpu"), { status: "selected" });
  });
  assert.deepEqual(api.workspaceStore.getSnapshot().focus, {
    environmentId: "gpu",
    spaceKey: '["gpu","/work/app/nested"]',
    sessionId: null,
  });
  assert.equal(host.get().selectedCwd, "/work/app/nested/src");
});

test("opening a Windows target descendant matches mixed separators and case and chooses the deepest mount", async (t) => {
  const host = await mountProjectProbe(t, () => api.useProjectWorkspace({ sessions: [], selectedCwdProp: "/local" }), {
    servers: [remoteServer("primary"), remoteServer("windows")],
    reply: (id, method, params) => (method === "system.validateCwd" ? { ok: true, path: params.path } : listing(id)),
  });
  await host.run(({ workspaceStore }) => {
    workspaceStore.noteCurrentProject({ environmentId: "windows", path: "C:\\Work\\App\\Nested" }, null);
    workspaceStore.noteCurrentProject({ environmentId: "windows", path: "C:/Work/App" }, null);
    workspaceStore.noteCurrentProject({ environmentId: "primary", path: "c:/work/app/nested/src" }, null);
  });
  await host.run(async () => {
    assert.deepEqual(await host.get().openDirectory("c:/WORK/app/nested/Src", "windows"), { status: "selected" });
  });
  assert.deepEqual(api.workspaceStore.getSnapshot().focus, {
    environmentId: "windows",
    spaceKey: '["windows","c:/work/app/nested"]',
    sessionId: null,
  });
});

test("a remote creation from an old target generation cannot return a path or show an error in the origin workspace", async (t) => {
  const pending = deferred();
  const host = await mountProjectProbe(
    t,
    () => api.useProjectWorkspace({ sessions: [], selectedCwdProp: "/work/app" }),
    {
      servers: [remoteServer("primary"), remoteServer("gpu", { phase: "connected", generation: 7, since: 0 })],
      reply: (id, method, params) => {
        if (method === "system.validateCwd") return { ok: true, path: params.path };
        if (method === "worktrees.create") return pending.promise;
        return listing(id);
      },
    },
  );
  let creating;
  await host.run(() => {
    host.get().openNewWorktreeEntry();
    host.get().setNewWorktreeBranch("keep-this-prompt");
  });
  const origin = api.workspaceStore.getSnapshot().focus;
  const state = host.get().worktreeState;
  await host.run(() => {
    creating = host.get().createWorktreeAt({ projectRoot: "/remote-root", branch: "review" }, "gpu");
  });
  await host.changeServers([
    remoteServer("primary"),
    remoteServer("gpu", { phase: "connected", generation: 8, since: 1 }),
  ]);
  let result;
  await host.run(async () => {
    pending.resolve({ worktree: { path: "/remote-old-generation" } });
    result = await creating;
  });
  assert.equal(result, null);
  assert.equal(host.get().wtError, null);
  assert.equal(host.get().wtNewOpen, true);
  assert.equal(host.get().wtNewBranch, "keep-this-prompt");
  assert.deepEqual(host.get().worktreeState, state);
  assert.equal(api.workspaceStore.getSnapshot().focus, origin);
});

test("a remote removal invalidated by its target generation never writes an origin error or confirmation", async (t) => {
  const pending = deferred();
  const host = await mountProjectProbe(
    t,
    () => api.useProjectWorkspace({ sessions: [], selectedCwdProp: "/work/app" }),
    {
      servers: [remoteServer("primary"), remoteServer("gpu", { phase: "connected", generation: 7, since: 0 })],
      reply: (id, method, params) => {
        if (method === "system.validateCwd") return { ok: true, path: params.path };
        if (method === "worktrees.remove") return pending.promise;
        return listing(id);
      },
    },
  );
  const origin = api.workspaceStore.getSnapshot().focus;
  const state = host.get().worktreeState;
  const refresh = host.get().wtRefreshKey;
  let removing;
  await host.run(() => {
    removing = host.get().handleRemoveWorktree("/work/app", false, "/remote-root", "gpu");
  });
  await host.changeServers([
    remoteServer("primary"),
    remoteServer("gpu", { phase: "connected", generation: 8, since: 1 }),
  ]);
  await host.run(async () => {
    pending.resolve({ ok: true });
    await removing;
  });
  assert.equal(host.get().wtError, null);
  assert.equal(host.get().wtConfirmRemove, null);
  assert.equal(host.get().selectedCwd, "/work/app");
  assert.deepEqual(host.get().worktreeState, state);
  assert.equal(host.get().wtRefreshKey, refresh);
  assert.equal(api.workspaceStore.getSnapshot().focus, origin);
});

test("opening a folder from an old target generation cancels before carrying drafts or changing focus", async (t) => {
  const pending = deferred();
  const host = await mountProjectProbe(
    t,
    () => api.useProjectWorkspace({ sessions: [], selectedCwdProp: "/work/app" }),
    {
      servers: [remoteServer("primary"), remoteServer("gpu", { phase: "connected", generation: 7, since: 0 })],
      reply: (id, method) => (id === "gpu" && method === "system.validateCwd" ? pending.promise : listing(id)),
    },
  );
  let opening;
  let prepared = false;
  const origin = api.workspaceStore.getSnapshot().focus;
  await host.run(() => {
    opening = host.get().openDirectory("/remote-root", "gpu", () => {
      prepared = true;
    });
  });
  await host.changeServers([
    remoteServer("primary"),
    remoteServer("gpu", { phase: "connected", generation: 8, since: 1 }),
  ]);
  let result;
  await host.run(async () => {
    pending.resolve({ ok: true, path: "/remote-root" });
    result = await opening;
  });
  assert.deepEqual(result, { status: "cancelled" });
  assert.equal(prepared, false);
  assert.equal(api.workspaceStore.getSnapshot().focus, origin);
  assert.equal(host.get().worktreeState.generation, 1);
});

test("an unmounted target folder never inherits a merely similar prefix or a root from another environment", async (t) => {
  const host = await mountProjectProbe(
    t,
    () =>
      api.useProjectWorkspace({
        sessions: [{ cwd: "/work/application/src", projectRoot: "/old-root" }],
        selectedCwdProp: "/work/application/src",
      }),
    {
      servers: [remoteServer("primary"), remoteServer("gpu")],
      reply: (id, method, params) => (method === "system.validateCwd" ? { ok: true, path: params.path } : listing(id)),
    },
  );
  await host.run(({ workspaceStore }) => {
    workspaceStore.noteCurrentProject({ environmentId: "gpu", path: "/work/app" }, null);
    workspaceStore.noteCurrentProject({ environmentId: "primary", path: "/work/application" }, null);
  });
  await host.run(async () => {
    assert.deepEqual(await host.get().openDirectory("/work/application/src", "gpu"), { status: "selected" });
  });
  assert.deepEqual(api.workspaceStore.getSnapshot().focus, {
    environmentId: "gpu",
    spaceKey: '["gpu","/work/application/src"]',
    sessionId: null,
  });
});

test("target checkout metadata uses the target generation while its post-navigation reload is pending", async (t) => {
  const reload = deferred();
  let targetLists = 0;
  const host = await mountProjectProbe(
    t,
    () => api.useProjectWorkspace({ sessions: [], selectedCwdProp: "/work/app" }),
    {
      servers: [remoteServer("primary"), remoteServer("gpu", { phase: "connected", generation: 7, since: 0 })],
      reply: (id, method, params) => {
        if (method === "system.validateCwd") return { ok: true, path: params.path };
        if (id === "gpu" && method === "worktrees.list") {
          targetLists += 1;
          if (targetLists > 1) return reload.promise;
          return { ...listing(id), projectRoot: "/remote-root" };
        }
        return listing(id);
      },
    },
  );
  await host.run(({ workspaceStore }) =>
    workspaceStore.noteCurrentProject({ environmentId: "gpu", path: "/remote-root" }, null),
  );
  await host.run(async () => {
    assert.deepEqual(await host.get().openDirectory("/work/app", "gpu"), { status: "selected" });
  });
  assert.equal(host.get().worktreeState?.environmentId, "gpu");
  assert.equal(host.get().worktreeState?.generation, 7);
  assert.equal(host.get().selectedProject, "/remote-root");
  await host.run(() => reload.resolve({ ...listing("gpu"), projectRoot: "/remote-root" }));
});
