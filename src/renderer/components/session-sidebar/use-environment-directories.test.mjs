import assert from "node:assert/strict";
import test from "node:test";
import { api, mountProjectProbe } from "../app-shell/project-spaces-test-harness.mjs";
import { remoteServer } from "../remote-folder-picker/folder-browser-test-helpers.mjs";

const session = (id, cwd, extra = {}) => ({
  id,
  cwd,
  path: `/sessions/${id}.jsonl`,
  firstMessage: "",
  created: "2026-01-01",
  modified: "2026-01-01",
  messageCount: 1,
  ...extra,
});

test("the first successful remote list seeds at most twenty distinct project roots and never resurrects removed spaces", async (t) => {
  const sessions = Array.from({ length: 22 }, (_, index) => session(`s${index}`, `/work/p${index}`));
  sessions.push(session("worktree", "/work/p0-worktree", { projectRoot: "/work/p0" }));
  const host = await mountProjectProbe(t, () => api.useEnvironmentDirectories({ selectedSessionId: null }), {
    servers: [remoteServer("gpu")],
    reply: (_id, method) => {
      assert.equal(method, "sessions.list");
      return { sessions, runningSessionIds: ["s0"], sessionStatuses: { s1: "awaiting_input" } };
    },
  });
  const state = () => host.get().find((directory) => directory.environment.id === "gpu");
  assert.equal(state().loading, false);
  assert.equal(state().sessions[0].environmentId, "gpu");
  assert.equal(state().activity.of("s0"), "running");
  assert.equal(state().activity.of("s1"), "awaiting_input");
  const saved = () => host.writes.at(-1).projectSpaces;
  assert.equal(saved().spaces.length, 20);
  assert.deepEqual(saved().seeded, ["gpu"]);
  assert.equal(
    saved().spaces.some((space) => space.path === "/work/p0-worktree"),
    false,
  );
  const key = api.workspaceStore.getSnapshot().spaces.find((space) => space.path === "/work/p0").key;
  await host.run(({ workspaceStore }) => workspaceStore.unmount(key));
  await host.changeServers([remoteServer("gpu", { phase: "connected", generation: 2, since: 1000 })]);
  assert.equal(state().sessions.length, 23);
  assert.equal(saved().spaces.length, 19);
  assert.deepEqual(saved().seeded, ["gpu"]);
  assert.equal(
    saved().spaces.some((space) => space.path === "/work/p0"),
    false,
  );
});

test("a failed list does not consume migration and a later successful empty list completes it once", async (t) => {
  const host = await mountProjectProbe(t, () => api.useEnvironmentDirectories({ selectedSessionId: null }), {
    servers: [remoteServer("gpu")],
    reply: () => {
      throw new Error("Server unavailable");
    },
  });
  const state = () => host.get().find((directory) => directory.environment.id === "gpu");
  assert.equal(state().error, "Failed to load sessions (Server unavailable)");
  assert.deepEqual(api.workspaceStore.getSnapshot().seeded, []);
  host.setReply(() => ({ sessions: [], runningSessionIds: [] }));
  await host.run(() => state().refreshSessions());
  assert.equal(state().error, null);
  assert.deepEqual(host.writes.at(-1).projectSpaces.seeded, ["gpu"]);
  host.setReply(() => ({ sessions: [session("later", "/work/later")], runningSessionIds: [] }));
  await host.run(() => state().refreshSessions());
  assert.deepEqual(api.workspaceStore.getSnapshot().spaces, []);
});

test("initial restore keeps waiting for an enabled server that has not connected for its first directory yet", async (t) => {
  const host = await mountProjectProbe(t, () => api.useEnvironmentDirectories({ selectedSessionId: null }), {
    servers: [remoteServer("gpu", { phase: "connecting", stage: "opening", attempt: 1, progress: null })],
    reply: () => ({ sessions: [], runningSessionIds: [] }),
  });
  const state = () => host.get().find((directory) => directory.environment.id === "gpu");
  assert.equal(state().loading, true);
  await host.changeServers([remoteServer("gpu")]);
  assert.equal(state().loading, false);
});
