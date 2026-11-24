import assert from "node:assert/strict";
import test from "node:test";
import { deferred, remoteServer } from "../remote-folder-picker/folder-browser-test-helpers.mjs";
import { branches, mount, mountCard, primary } from "./workspace-card-test-harness.mjs";

const listingWithCheckout = () => ({
  ...branches("/work/app"),
  branches: [
    ...branches("/work/app").branches,
    {
      name: "checkout",
      isCurrent: false,
      isMainFolder: false,
      worktreePath: "/work/checkout",
      committedAt: null,
    },
  ],
});

const checkoutPaths = (card) => (card.pane.state === "ready" ? card.pane.sections.folders.map((row) => row.path) : []);

test("removing a checkout from a browsed remote project updates its listing without a focused-environment refresh", async (t) => {
  let removed = false;
  const host = await mountCard(t, {
    spaces: [mount("primary", "/work/app"), mount("gpu", "/work/app")],
    workspace: {
      handleRemoveWorktree: async () => {
        removed = true;
      },
    },
    reply: (_id, method, params) => {
      if (method === "system.validateCwd") return { ok: true, path: params.path };
      if (method === "git.branch") return { isGit: true, branch: "main" };
      if (method === "worktrees.branches") return removed ? branches(params.cwd) : listingWithCheckout();
      throw new Error(`Unexpected request ${method}`);
    },
  });
  await host.run((card) => card.browseProject('["gpu","/work/app"]'));
  assert.deepEqual(checkoutPaths(host.get()), ["/work/checkout"]);
  await host.run((card) => card.removeCheckout("/work/checkout", true));
  assert.equal(host.get().pane.state, "ready");
  assert.deepEqual(checkoutPaths(host.get()), []);
  assert.equal(host.get().browsedEnvironmentId, "gpu");
  assert.deepEqual(host.navigations, []);
});

test("refreshes requested during a branch load coalesce into one follow-up and never publish the superseded listing", async (t) => {
  const host = await mountCard(t);
  const old = deferred();
  const fresh = deferred();
  let loads = 0;
  host.setReply((_id, method, params) => {
    if (method === "system.validateCwd") return { ok: true, path: params.path };
    if (method === "git.branch") return { isGit: true, branch: "main" };
    if (method === "worktrees.branches") return ++loads === 1 ? old.promise : fresh.promise;
    throw new Error(`Unexpected request ${method}`);
  });
  await host.update({ workspace: { selectedProject: "/work/app", selectedCwd: "/work/app", wtRefreshKey: 1 } });
  await host.update({ workspace: { selectedProject: "/work/app", selectedCwd: "/work/app", wtRefreshKey: 2 } });
  await host.update({ workspace: { selectedProject: "/work/app", selectedCwd: "/work/app", wtRefreshKey: 3 } });
  assert.equal(loads, 1, "concurrent refresh intents must not duplicate an in-flight branch request");
  await host.run(() => old.resolve(listingWithCheckout()));
  assert.equal(loads, 2, "refresh intents must schedule one follow-up after the current request finishes");
  assert.equal(host.get().pane.state, "ready");
  assert.deepEqual(
    checkoutPaths(host.get()),
    [],
    "the superseded result cannot restore an obsolete checkout while reloading",
  );
  await host.run(() => fresh.resolve(branches("/work/app", "fresh-main")));
  assert.equal(host.get().pane.sections.current[0].name, "fresh-main");
  assert.deepEqual(checkoutPaths(host.get()), []);
  assert.equal(loads, 2);
  assert.equal(host.requests.filter((request) => request.method === "system.validateCwd").length, 1);
});

for (const lateFailure of [false, true]) {
  test(`remote deletion survives an overlapping stale branch ${lateFailure ? "failure" : "reply"} and refreshes once`, async (t) => {
    let removed = false;
    let pending = false;
    const old = deferred();
    const host = await mountCard(t, {
      spaces: [mount("primary", "/work/app"), mount("gpu", "/work/app")],
      workspace: {
        handleRemoveWorktree: async () => {
          removed = true;
        },
      },
      reply: (_id, method, params) => {
        if (method === "system.validateCwd") return { ok: true, path: params.path };
        if (method === "git.branch") return { isGit: true, branch: "main" };
        if (method === "worktrees.branches")
          return pending && !removed ? old.promise : removed ? branches(params.cwd) : listingWithCheckout();
        throw new Error(`Unexpected request ${method}`);
      },
    });
    await host.run((card) => card.browseProject('["gpu","/work/app"]'));
    pending = true;
    await host.run((card) => card.retryBranches());
    await host.run((card) => card.removeCheckout("/work/checkout", true));
    await host.run(() =>
      lateFailure ? old.reject(new Error("Obsolete listing failed")) : old.resolve(listingWithCheckout()),
    );
    assert.equal(host.get().pane.state, "ready");
    assert.deepEqual(checkoutPaths(host.get()), []);
    assert.equal(host.get().error, null);
    assert.equal(
      host.requests.filter((request) => request.environmentId === "gpu" && request.method === "worktrees.branches")
        .length,
      3,
    );
    assert.equal(
      host.requests.filter((request) => request.environmentId === "gpu" && request.method === "system.validateCwd")
        .length,
      1,
    );
  });
}

test("dirty removal confirmation stays scoped to its environment and reconnect clears blocked switch recovery", async (t) => {
  const host = await mountCard(t, {
    spaces: [mount("primary", "/work/app"), mount("gpu", "/work/app")],
    workspace: {
      wtConfirmRemoveTarget: { environmentId: "gpu", path: "/work/checkout" },
      wtConfirmRemove: null,
    },
    reply: (_id, method, params) => {
      if (method === "system.validateCwd") return { ok: true, path: params.path };
      if (method === "git.branch") return { isGit: true, branch: "main" };
      if (method === "worktrees.branches") return branches(params.cwd, "main");
      if (method === "worktrees.switchBranch") return { ok: false, reason: "dirty" };
      throw new Error(`Unexpected request ${method}`);
    },
  });
  assert.equal(host.get().confirmRemovePath, null);
  await host.run((card) => card.browseProject('["gpu","/work/app"]'));
  assert.equal(host.get().confirmRemovePath, "/work/checkout");
  await host.run((card) => card.activateBranch("branch:topic"));
  assert.equal(host.get().blocked?.reason, "dirty");
  await host.changeEnvironments([primary(1), remoteServer("gpu", 2)]);
  assert.equal(host.get().blocked, null);
});
