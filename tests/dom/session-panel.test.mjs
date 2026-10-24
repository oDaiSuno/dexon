import assert from "node:assert/strict";
import test, { after } from "node:test";
import { byRole, dom, loadRenderer, mount, restoreGlobals, text } from "../support/renderer.mjs";
import { installApiHostBridge } from "../support/api-host.mjs";

const { TopBar, resetRpc } = await loadRenderer(
  "session-panel",
  'export {TopBar} from "./src/renderer/components/app-shell/top-bar.tsx";',
);
after(restoreGlobals);

const LOAD_HINT = "Send a message or run /session to load session info";

const SELECTED_SESSION = {
  id: "session-one",
  path: "/workspace/notes.jsonl",
  cwd: "/workspace",
  created: "2026-08-01T08:00:00.000Z",
  modified: "2026-09-06T10:00:00.000Z",
  messageCount: 194,
  firstMessage: "Notes",
  name: "Release notes",
};

const WHOLE_SESSION_STATS = {
  sessionId: "session-one",
  sessionFile: "/workspace/notes.jsonl",
  sessionName: "Release notes",
  userMessages: 96,
  assistantMessages: 98,
  toolCalls: 17,
  toolResults: 17,
  totalMessages: 194,
  tokens: { input: 1_234, output: 567, cacheRead: 0, cacheWrite: 0, total: 1_801 },
  cost: 0,
};

function panelProps(overrides = {}) {
  return {
    sidebarOpen: true,
    onToggleSidebar: () => {},
    showSidebarToggle: true,
    isMobile: false,
    selectedSession: SELECTED_SESSION,
    channelSnapshot: { accounts: [], statuses: [], pairings: [], bindings: [], activities: [] },
    onChannelSnapshotChange: () => {},
    activeTopPanel: "session",
    onToggleTopPanel: () => {},
    sessionStats: null,
    contextUsage: null,
    copyFeedback: null,
    onCopyField: () => {},
    rightPanelOpen: false,
    showChat: true,
    ...overrides,
  };
}

function sessionPanel(view) {
  const panel = byRole(view.container, "region", "Context and cost");
  assert.ok(panel, "the open session panel is a region named Context and cost");
  return panel;
}

async function mountPanel(t, overrides) {
  dom.window.piBridge = {};
  const boundary = installApiHostBridge(
    dom.window,
    () => ({ call: async () => ({ accounts: [], statuses: [], pairings: [], bindings: [], activities: [] }) }),
    resetRpc,
  );
  t.after(() => boundary.close());
  return mount(t, TopBar, panelProps(overrides));
}

test("when the session panel is open with whole-session counts, it shows those counts for the session", async (t) => {
  const view = await mountPanel(t, { sessionStats: WHOLE_SESSION_STATS });
  const panel = sessionPanel(view);
  assert.ok(text(panel, "194 messages · 17 tool calls"), "the message and tool call totals are the whole session's");
  assert.ok(text(panel, "1.2k"), "the input size is the whole session's usage");
  assert.ok(text(panel, "567"), "the output size is the whole session's usage");
  assert.ok(!panel.textContent.includes(LOAD_HINT), "loaded counts replace the loading hint");
});

test("when the counts are not available yet, the session panel still names the session it belongs to", async (t) => {
  const view = await mountPanel(t, {});
  const panel = sessionPanel(view);
  assert.ok(panel.textContent.includes("session-one"), "the session ID is on screen");
  assert.ok(panel.textContent.includes("/workspace/notes.jsonl"), "the session file is on screen");
  assert.ok(panel.textContent.includes("Release notes"), "the session name is on screen");
  assert.equal(panel.textContent.includes(LOAD_HINT), false, "a selected session is never described as missing");
});

test("when no session is selected, the session panel explains how to load session information", async (t) => {
  const view = await mountPanel(t, { selectedSession: null });
  const panel = sessionPanel(view);
  assert.ok(panel.textContent.includes(LOAD_HINT), "the hint appears only when there is no session to describe");
});
