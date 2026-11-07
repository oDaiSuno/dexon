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
  const host = await mountProjectProbe(t, () => api.useSessionLocation("/work/app"), {
    servers: [remoteServer("gpu"), remoteServer("staging")],
    reply: (id, method) =>
      method === "git.branch"
        ? { isGit: true, branch: id }
        : { ...listing(id), worktrees: [{ path: "/work/app", branch: id, isMain: false }] },
  });
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
