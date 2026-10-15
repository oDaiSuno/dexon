import assert from "node:assert/strict";
import test, { after } from "node:test";
import { dom, loadRenderer, mount, restoreGlobals, settle } from "../../../../tests/support/renderer.mjs";
import { installRendererApi } from "../../../../tests/support/renderer-api.mjs";

// The shell owns startup space selection; the sidebar only restores an
// explicitly linked session, using its shipped HTTP-to-RPC compatibility layer.
const api = await loadRenderer(
  "session-sidebar-startup",
  'export {SessionSidebar} from "./src/renderer/components/SessionSidebar.tsx";',
);
after(restoreGlobals);

function session(id, cwd, modified) {
  return {
    id,
    path: `/fixture/${id}.jsonl`,
    created: modified,
    name: "",
    firstMessage: "",
    cwd,
    modified,
    messageCount: 1,
  };
}

const sessionsFixture = [
  session("s1", "/proj-a", "2026-09-01T10:00:00.000Z"),
  session("s2", "/proj-b", "2026-09-02T10:00:00.000Z"),
  session("s3", "/proj-a", "2026-09-03T10:00:00.000Z"),
];

function baseProps(overrides = {}) {
  const calls = {
    cwdChanges: [],
    selected: [],
    restoreDone: 0,
  };
  const props = {
    selectedSessionId: null,
    onSelectSession: (value) => calls.selected.push(value),
    onNewSession: () => {},
    initialSessionId: null,
    onInitialRestoreDone: () => {
      calls.restoreDone += 1;
    },
    refreshKey: 0,
    onSessionDeleted: () => {},
    selectedCwd: null,
    onCwdChange: (cwd) => calls.cwdChanges.push(cwd),
    ...overrides,
  };
  return { calls, props };
}

async function mountSidebar(t, props) {
  const host = installRendererApi(
    dom.window,
    api,
    () => ({
      call(method) {
        if (method === "sessions.list") return { sessions: sessionsFixture, runningSessionIds: [] };
        if (method === "system.home") return { home: "/Users/tester" };
        if (method === "worktrees.list") return { projectRoot: "", isGit: false, isTopLevel: false, worktrees: [] };
        throw new Error(`unexpected sidebar request: ${method}`);
      },
    }),
    {
      bridge: {
        onHostRestarted: () => () => {},
        onMenu: () => () => {},
        onDeepLinkSession: () => () => {},
      },
    },
  );
  return mount(t, api.SessionSidebar, props, { release: host.close });
}

test("startup without a session link no longer auto-selects the most recent project", async (t) => {
  const { calls, props } = baseProps();
  const mounted = await mountSidebar(t, props);
  await settle();

  assert.deepEqual(calls.cwdChanges, []);
  assert.deepEqual(calls.selected, []);
  assert.equal(calls.restoreDone, 0);
  await mounted.unmount();
});

test("startup still restores an explicit URL session and aligns its directory", async (t) => {
  const { calls, props } = baseProps({ initialSessionId: "s2" });
  const mounted = await mountSidebar(t, props);
  await settle();

  assert.equal(calls.selected.length, 1);
  assert.equal(calls.selected[0].id, "s2");
  assert.ok(calls.cwdChanges.includes("/proj-b"));
  assert.equal(calls.restoreDone, 0);
  await mounted.unmount();
});

test("a missing explicit session reports not-found without choosing any space", async (t) => {
  const { calls, props } = baseProps({ initialSessionId: "missing" });
  const mounted = await mountSidebar(t, props);
  await settle();

  assert.deepEqual(calls.selected, []);
  assert.deepEqual(calls.cwdChanges, []);
  assert.equal(calls.restoreDone, 1);
  await mounted.unmount();
});
