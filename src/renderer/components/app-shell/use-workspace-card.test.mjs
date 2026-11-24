import assert from "node:assert/strict";
import test from "node:test";
import { deferred, remoteServer } from "../remote-folder-picker/folder-browser-test-helpers.mjs";
import { branches, mount, mountCard, primary } from "./workspace-card-test-harness.mjs";

test("identical mounted paths on two environments remain separate and only the primary personal path is a house", async (t) => {
  const host = await mountCard(t, {
    spaces: [
      mount("primary", "/work/app"),
      mount("gpu", "/work/app"),
      mount("primary", "/home/dev/.dexon"),
      mount("gpu", "/home/dev/.dexon"),
    ],
  });
  assert.deepEqual(
    host.get().projects.map(({ key, current, browsed }) => ({ key, current, browsed })),
    [
      { key: '["primary","/work/app"]', current: true, browsed: true },
      { key: '["primary","/home/dev/.dexon"]', current: false, browsed: false },
      { key: '["gpu","/work/app"]', current: false, browsed: false },
      { key: '["gpu","/home/dev/.dexon"]', current: false, browsed: false },
    ],
  );
  assert.equal(host.get().projects[1].icon, "house");
  assert.equal(host.get().projects[3].icon, "folder");
  assert.equal(host.get().projects[3].name, ".dexon");
  assert.equal(host.get().showEnvironmentGroups, true);
  await host.run((card) => card.activateProject('["gpu","/home/dev/.dexon"]'));
  assert.deepEqual(host.navigations, [{ folder: "/home/dev/.dexon", environmentId: "gpu" }]);
  assert.equal(host.personalReturns(), 0);
});

test("browsing a disconnected mounted project immediately shows its environment state without requests", async (t) => {
  const offline = remoteServer("gpu", { phase: "offline", lastFailure: null });
  const host = await mountCard(t, {
    spaces: [mount("primary", "/work/app"), mount("gpu", "/work/app")],
    servers: [primary(), offline],
  });
  await host.run((card) => card.browseProject('["gpu","/work/app"]'));
  assert.deepEqual(host.get().pane, { state: "offline", environmentLabel: "gpu", connecting: false });
  assert.equal(
    host.requests.some((request) => request.environmentId === "gpu"),
    false,
  );
  assert.equal(host.get().projects[1].unavailable, true);
  assert.equal(host.get().projects[1].subline, "Offline");
  await host.run((card) => {
    card.retryBranches();
    card.activateProject('["gpu","/work/app"]');
  });
  assert.deepEqual(host.navigations, []);
  const connecting = remoteServer("gpu", { phase: "connecting", stage: "connecting", attempt: 1 });
  await host.changeEnvironments([primary(), connecting]);
  assert.deepEqual(host.get().pane, { state: "offline", environmentLabel: "gpu", connecting: true });
  assert.equal(
    host.requests.some((request) => request.environmentId === "gpu"),
    false,
  );
});

test("branch loading authorizes each environment path, surfaces failure, and retries on the browsed environment", async (t) => {
  let failed = true;
  const allowed = new Set();
  const host = await mountCard(t, {
    spaces: [mount("primary", "/work/app"), mount("gpu", "/work/app")],
    reply: (id, method, params) => {
      if (method === "system.validateCwd") {
        allowed.add(id);
        return { ok: true, path: params.path };
      }
      if (!allowed.has(id)) throw new Error("Root not authorized");
      if (method === "git.branch") return { isGit: true, branch: `${id}-main` };
      if (method === "worktrees.branches") {
        if (id === "gpu" && failed) throw new Error("Remote listing failed");
        return branches(params.cwd, `${id}-main`);
      }
      throw new Error(`Unexpected request ${method}`);
    },
  });
  await host.run((card) => card.browseProject('["gpu","/work/app"]'));
  assert.equal(host.get().pane.state, "error");
  assert.equal(host.get().pane.message, "Remote listing failed");
  failed = false;
  await host.run((card) => card.retryBranches());
  assert.equal(host.get().pane.state, "ready");
  assert.equal(host.get().pane.sections.current[0].name, "gpu-main");
  assert.equal(
    host.requests.filter((request) => request.environmentId === "gpu" && request.method === "system.validateCwd")
      .length,
    1,
  );
});

test("same-generation branch listings remain ready when returning to a project or reopening, but reconnects cannot reuse them", async (t) => {
  const host = await mountCard(t, { spaces: [mount("primary", "/work/app"), mount("gpu", "/work/app")] });
  await host.run((card) => card.browseProject('["gpu","/work/app"]'));
  assert.equal(host.get().pane.sections.current[0].name, "gpu-main");
  const refresh = deferred();
  host.setReply((id, method, params) => {
    if (method === "system.validateCwd") return { ok: true, path: params.path };
    if (method === "git.branch") return { isGit: true, branch: `${id}-new` };
    return refresh.promise;
  });
  await host.run((card) => card.browseProject('["primary","/work/app"]'));
  assert.equal(host.get().pane.state, "ready");
  assert.equal(host.get().pane.sections.current[0].name, "primary-main");
  await host.update({ open: false });
  await host.update({ open: true });
  assert.equal(host.get().pane.state, "ready");
  assert.equal(host.get().pane.sections.current[0].name, "primary-main");
  await host.changeEnvironments([primary(2), remoteServer("gpu")]);
  assert.equal(host.get().pane.state, "loading");
  await host.run(() => refresh.resolve(branches("/work/app", "generation-two")));
  assert.equal(host.get().pane.state, "ready");
  assert.equal(host.get().pane.sections.current[0].name, "generation-two");
  assert.equal(
    host.requests.filter((request) => request.environmentId === "primary" && request.method === "system.validateCwd")
      .length,
    2,
  );
});

test("connected environments refresh facts independently with at most three requests each and active-environment priority", async (t) => {
  const gates = { primary: [], gpu: [] };
  const inFlight = { primary: 0, gpu: 0 };
  const maximum = { primary: 0, gpu: 0 };
  const authorized = new Set();
  const host = await mountCard(t, {
    environmentId: "gpu",
    spaces: [
      ...Array.from({ length: 5 }, (_, index) => mount("primary", `/work/${index}`)),
      ...Array.from({ length: 5 }, (_, index) => mount("gpu", `/work/${index}`)),
      mount("staging", "/work/app"),
    ],
    servers: [primary(), remoteServer("gpu"), remoteServer("staging", { phase: "offline", lastFailure: null })],
    reply: (id, method, params) => {
      const key = JSON.stringify([id, params.path ?? params.cwd]);
      if (method === "system.validateCwd") {
        authorized.add(key);
        return { ok: true, path: params.path };
      }
      assert.equal(authorized.has(key), true, "Git requests must be authorized on their own host");
      if (method === "worktrees.branches") return branches(params.cwd, `${id}-main`);
      if (method === "git.branch") {
        const gate = deferred();
        gates[id].push(gate);
        inFlight[id] += 1;
        maximum[id] = Math.max(maximum[id], inFlight[id]);
        return gate.promise.finally(() => {
          inFlight[id] -= 1;
        });
      }
      throw new Error(`Unexpected request ${method}`);
    },
  });
  assert.deepEqual(inFlight, { primary: 3, gpu: 3 });
  assert.equal(host.requests.find((request) => request.method === "git.branch").environmentId, "gpu");
  assert.equal(host.get().pane.state, "ready", "foreground branches cannot wait for background facts");
  assert.equal(
    host.requests.some((request) => request.environmentId === "staging"),
    false,
  );
  await host.run(() => gates.primary[0].resolve({ isGit: true, branch: "local-main" }));
  assert.equal(gates.primary.length, 4, "local progress cannot wait for the slow remote queue");
  assert.equal(gates.gpu.length, 3);
  await host.run(() => gates.gpu[0].resolve({ isGit: true, branch: "gpu-main" }));
  assert.deepEqual(maximum, { primary: 3, gpu: 3 });
  assert.equal(
    host.get().projects.find((row) => row.environmentId === "primary" && row.path === "/work/0").subline,
    "local-main",
  );
  assert.equal(
    host.get().projects.find((row) => row.environmentId === "gpu" && row.path === "/work/0").subline,
    "gpu-main",
  );
  await host.run(() => {
    for (const [id, group] of Object.entries(gates))
      for (const gate of group) gate.resolve({ isGit: true, branch: `${id}-main` });
  });
});

test("branch switching, worktree creation and removal use the browsed environment even when its path matches the active project", async (t) => {
  const created = [];
  const removed = [];
  const host = await mountCard(t, {
    spaces: [mount("primary", "/work/app"), mount("gpu", "/work/app")],
    workspace: {
      createWorktreeAt: async (target, environmentId) => {
        created.push({ target, environmentId });
        return "/work/new-checkout";
      },
      handleRemoveWorktree: async (...args) => {
        removed.push(args);
      },
    },
    reply: (id, method, params) => {
      if (method === "system.validateCwd") return { ok: true, path: params.path };
      if (method === "git.branch") return { isGit: true, branch: `${id}-main` };
      if (method === "worktrees.branches") return branches(params.cwd, `${id}-main`);
      if (method === "worktrees.switchBranch") return { ok: true };
      throw new Error(`Unexpected request ${method}`);
    },
  });
  await host.run((card) => card.browseProject('["gpu","/work/app"]'));
  await host.run((card) => card.activateBranch("branch:topic"));
  assert.deepEqual(
    host.requests.find((request) => request.method === "worktrees.switchBranch"),
    { environmentId: "gpu", method: "worktrees.switchBranch", params: { cwd: "/work/app", branch: "topic" } },
  );
  assert.deepEqual(host.navigations, [{ folder: "/work/app", environmentId: "gpu" }]);
  await host.run((card) => card.createCheckout());
  assert.deepEqual(created, [{ target: { projectRoot: "/work/app" }, environmentId: "gpu" }]);
  assert.deepEqual(host.navigations.at(-1), { folder: "/work/new-checkout", environmentId: "gpu" });
  await host.run((card) => card.removeCheckout("/work/old-checkout", true));
  assert.deepEqual(removed, [["/work/old-checkout", true, "/work/app", "gpu"]]);
});

test("switching or creating on a previously browsed project cannot navigate or report errors after browsing elsewhere", async (t) => {
  const switching = deferred();
  const creating = deferred();
  const host = await mountCard(t, {
    spaces: [mount("primary", "/work/app"), mount("gpu", "/work/app")],
    workspace: { createWorktreeAt: () => creating.promise },
    reply: (id, method, params) => {
      if (method === "system.validateCwd") return { ok: true, path: params.path };
      if (method === "git.branch") return { isGit: true, branch: `${id}-main` };
      if (method === "worktrees.branches") return branches(params.cwd, `${id}-main`);
      if (method === "worktrees.switchBranch") return switching.promise;
      throw new Error(`Unexpected request ${method}`);
    },
  });
  await host.run((card) => card.browseProject('["gpu","/work/app"]'));
  await host.run((card) => card.activateBranch("branch:topic"));
  await host.run((card) => card.browseProject('["primary","/work/app"]'));
  await host.run(() => switching.resolve({ ok: true }));
  assert.deepEqual(host.navigations, []);
  assert.equal(host.get().busy, false);
  await host.run((card) => card.browseProject('["gpu","/work/app"]'));
  await host.run((card) => card.createCheckout());
  await host.run((card) => card.browseProject('["primary","/work/app"]'));
  await host.run(() => creating.resolve("/work/new-checkout"));
  assert.deepEqual(host.navigations, []);
  assert.equal(host.get().error, null);
});

test("fact caches survive reopen per environment while fresh generations ignore delayed old replies and reauthorize", async (t) => {
  const host = await mountCard(t, { spaces: [mount("primary", "/work/app"), mount("gpu", "/work/app")] });
  assert.deepEqual(
    host.get().projects.map((row) => row.subline),
    ["primary-main", "gpu-main"],
  );
  const stale = deferred();
  host.setReply((id, method, params) => {
    if (method === "system.validateCwd") return { ok: true, path: params.path };
    if (method === "git.branch") return stale.promise;
    return branches(params.cwd, `${id}-main`);
  });
  await host.update({ open: false });
  await host.update({ open: true });
  assert.deepEqual(
    host.get().projects.map((row) => row.subline),
    ["primary-main", "gpu-main"],
  );
  assert.equal(
    host.requests.filter((request) => request.method === "system.validateCwd").length,
    2,
    "foreground and facts share one authorization per environment/path/generation",
  );
  host.setReply((id, method, params) => {
    if (method === "system.validateCwd") return { ok: true, path: params.path };
    if (method === "git.branch") return { isGit: true, branch: `${id}-fresh` };
    return branches(params.cwd, `${id}-fresh`);
  });
  await host.changeEnvironments([primary(), remoteServer("gpu", { phase: "connected", generation: 2, since: 0 })]);
  assert.equal(host.get().projects[1].subline, "gpu-fresh");
  await host.run(() => stale.resolve({ isGit: true, branch: "obsolete-generation" }));
  assert.equal(host.get().projects[1].subline, "gpu-fresh");
  assert.equal(
    host.requests.filter((request) => request.environmentId === "gpu" && request.method === "system.validateCwd")
      .length,
    2,
  );
});

test("pure-local projects need no environment groups, and a disconnected primary makes zero requests", async (t) => {
  const host = await mountCard(t, { servers: [{ ...primary(), status: { phase: "offline", lastFailure: null } }] });
  assert.equal(host.get().showEnvironmentGroups, false);
  assert.deepEqual(host.get().pane, { state: "offline", environmentLabel: "This computer", connecting: false });
  assert.deepEqual(host.requests, []);
});

test("a failed root authorization becomes a retryable branch error rather than a permanent pending request", async (t) => {
  let allowed = false;
  const host = await mountCard(t, {
    reply: (_id, method, params) => {
      if (method === "system.validateCwd")
        return allowed ? { ok: true, path: params.path } : { ok: false, reason: "denied", error: "Access denied" };
      if (method === "git.branch") return { isGit: true, branch: "main" };
      return branches(params.cwd);
    },
  });
  assert.deepEqual(host.get().pane, { state: "error", message: "Access denied" });
  allowed = true;
  await host.run((card) => card.retryBranches());
  assert.equal(host.get().pane.state, "ready");
  assert.equal(host.requests.filter((request) => request.method === "system.validateCwd").length, 2);
});

test("null mounted spaces preserve the existing checkout fallback without branch or fact requests", async (t) => {
  const host = await mountCard(t, {
    spaces: null,
    workspace: {
      showWorktreeSwitcher: true,
      worktreeState: {
        projectRoot: "/work/app",
        worktrees: [
          { path: "/work/app", branch: "main", isMain: true },
          { path: "/work/checkout", branch: "topic", isMain: false },
        ],
      },
    },
  });
  assert.equal(host.get().pane.state, "ready");
  assert.equal(host.get().pane.count, 2);
  assert.deepEqual(host.requests, []);
  await host.run((card) => card.activateBranch("checkout:/work/checkout"));
  assert.deepEqual(host.navigations, [{ folder: "/work/checkout", environmentId: "primary" }]);
});

test("a blocked remote branch creates its replacement checkout remotely and occupied branches navigate remotely", async (t) => {
  const created = [];
  let occupied = false;
  const host = await mountCard(t, {
    spaces: [mount("primary", "/work/app"), mount("gpu", "/work/app")],
    workspace: {
      createWorktreeAt: async (target, environmentId) => {
        created.push({ target, environmentId });
        return "/work/topic-checkout";
      },
    },
    reply: (id, method, params) => {
      if (method === "system.validateCwd") return { ok: true, path: params.path };
      if (method === "git.branch") return { isGit: true, branch: `${id}-main` };
      if (method === "worktrees.branches") return branches(params.cwd, `${id}-main`);
      return occupied ? { ok: false, reason: "occupied", path: "/work/occupied" } : { ok: false, reason: "dirty" };
    },
  });
  await host.run((card) => card.browseProject('["gpu","/work/app"]'));
  await host.run((card) => card.activateBranch("branch:topic"));
  assert.equal(host.get().blocked.reason, "dirty");
  await host.run((card) => card.openBlockedInNewWorktree());
  assert.deepEqual(created, [{ target: { projectRoot: "/work/app", branch: "topic" }, environmentId: "gpu" }]);
  assert.deepEqual(host.navigations.at(-1), { folder: "/work/topic-checkout", environmentId: "gpu" });
  occupied = true;
  await host.run((card) => card.activateBranch("branch:topic"));
  assert.deepEqual(host.navigations.at(-1), { folder: "/work/occupied", environmentId: "gpu" });
});

test("an old navigation failure stays stale even after browsing away and back to the original row", async (t) => {
  const pending = deferred();
  const host = await mountCard(t, {
    spaces: [mount("primary", "/work/app"), mount("gpu", "/work/app")],
    onGoToFolder: () => pending.promise,
  });
  await host.run((card) => card.activateProject('["gpu","/work/app"]'));
  await host.run((card) => card.browseProject('["gpu","/work/app"]'));
  await host.run((card) => card.browseProject('["primary","/work/app"]'));
  await host.run(() => pending.resolve({ ok: false, error: "Obsolete navigation failure" }));
  assert.equal(host.get().error, null);
});

test("backoff presents reconnecting without authorization, Git or branch requests", async (t) => {
  const backoff = remoteServer("gpu", {
    phase: "backoff",
    reason: "network",
    detail: "Connection lost",
    retryAt: 5000,
    failureCount: 1,
  });
  const host = await mountCard(t, {
    spaces: [mount("primary", "/work/app"), mount("gpu", "/work/app")],
    servers: [primary(), backoff],
  });
  await host.run((card) => card.browseProject('["gpu","/work/app"]'));
  assert.deepEqual(host.get().pane, { state: "offline", environmentLabel: "gpu", connecting: true });
  const remote = host.get().projects.find((row) => row.environmentId === "gpu");
  assert.equal(remote.environmentState, "connecting");
  assert.equal(remote.subline, "Reconnecting…");
  assert.equal(remote.sublineKind, "note");
  assert.equal(remote.unavailable, true);
  await host.run((card) => {
    card.retryBranches();
    card.createCheckout();
    card.removeCheckout("/work/checkout", false);
  });
  assert.equal(
    host.requests.some((request) => request.environmentId === "gpu"),
    false,
  );
});

test("project rows follow displayed groups: this computer first, then remote environments and their folders in original order", async (t) => {
  const host = await mountCard(t, {
    spaces: [
      mount("gpu", "/work/first"),
      mount("primary", "/local/first"),
      mount("staging", "/stage/first"),
      mount("gpu", "/work/second"),
      mount("primary", "/local/second"),
      mount("staging", "/stage/second"),
    ],
    servers: [primary(), remoteServer("staging"), remoteServer("gpu")],
  });
  assert.deepEqual(
    host.get().projects.map((row) => row.key),
    [
      '["primary","/local/first"]',
      '["primary","/local/second"]',
      '["gpu","/work/first"]',
      '["gpu","/work/second"]',
      '["staging","/stage/first"]',
      '["staging","/stage/second"]',
    ],
  );
  assert.equal(host.get().projects[0].environmentLabel, "This computer");
});

test("an available primary waits for its connected generation before issuing card requests", async (t) => {
  const host = await mountCard(t, { servers: [{ ...primary(), status: { phase: "available" } }] });
  assert.deepEqual(host.get().pane, { state: "offline", environmentLabel: "This computer", connecting: false });
  assert.equal(host.get().projects[0].unavailable, true);
  assert.deepEqual(host.requests, []);
  await host.changeEnvironments([primary(3)]);
  assert.equal(host.get().pane.state, "ready");
  assert.equal(host.get().projects[0].unavailable, false);
  assert.equal(host.get().projects[0].subline, "primary-main");
  assert.equal(host.requests.filter((request) => request.method === "system.validateCwd").length, 1);
});

test("remote branch paths abbreviate only against the browsed environment home and remain absolute without a descriptor", async (t) => {
  const remote = remoteServer("gpu");
  const described = {
    ...remote,
    descriptor: {
      environmentId: "gpu",
      label: "gpu",
      protocolVersion: 1,
      serverVersion: "test",
      platform: { os: "linux", arch: "x64", pathStyle: "posix", home: "/home/gpu" },
      capabilities: {
        browser: false,
        nativeDialogs: false,
        revealInFileManager: false,
        managedProcesses: true,
        toolchainInstall: true,
      },
    },
  };
  const host = await mountCard(t, {
    spaces: [mount("primary", "/work/app"), mount("gpu", "/home/dev/remote"), mount("gpu", "/home/gpu/project")],
    servers: [primary(), remote],
  });
  await host.run((card) => card.browseProject('["gpu","/home/dev/remote"]'));
  assert.equal(host.get().pane.sections.current[0].pathLabel, "/home/dev/remote");
  await host.changeEnvironments([primary(), described]);
  assert.equal(host.get().pane.sections.current[0].pathLabel, "/home/dev/remote");
  await host.run((card) => card.browseProject('["gpu","/home/gpu/project"]'));
  assert.equal(host.get().pane.sections.current[0].pathLabel, "~/project");
  await host.changeEnvironments([primary(), remote]);
  assert.equal(host.get().pane.sections.current[0].pathLabel, "/home/gpu/project");
});
