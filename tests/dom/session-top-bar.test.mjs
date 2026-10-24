import assert from "node:assert/strict";
import test, { after } from "node:test";
import { byRole, dom, loadRenderer, mount, restoreGlobals, text } from "../support/renderer.mjs";
import { installApiHostBridge } from "../support/api-host.mjs";

const { TopBar, resetRpc } = await loadRenderer(
  "session-top-bar",
  'export {TopBar} from "./src/renderer/components/app-shell/top-bar.tsx";',
);
after(restoreGlobals);

const LONG_NAME = "Generate the sidebar Framer components and align every spacing value with the design file";

const SESSION = {
  id: "session-top",
  path: "/workspace/dexon/top.jsonl",
  cwd: "/workspace/dexon",
  created: "2026-08-01T08:00:00.000Z",
  modified: "2026-09-06T10:00:00.000Z",
  messageCount: 12,
  firstMessage: "Hello",
  name: "Release notes",
};

const STATS = {
  sessionId: "session-top",
  sessionFile: "/workspace/dexon/top.jsonl",
  sessionName: "Release notes",
  userMessages: 6,
  assistantMessages: 6,
  toolCalls: 0,
  toolResults: 0,
  totalMessages: 12,
  tokens: { input: 1_200_000, output: 400_000, cacheRead: 0, cacheWrite: 0, total: 1_600_000 },
  cost: 1.84,
};

function barProps(overrides = {}) {
  return {
    sidebarOpen: true,
    onToggleSidebar: () => {},
    showSidebarToggle: false,
    isMobile: false,
    selectedSession: SESSION,
    projectName: "dexon",
    activeTopPanel: null,
    onToggleTopPanel: () => {},
    sessionStats: STATS,
    contextUsage: { percent: 62, contextWindow: 200_000, tokens: 124_000 },
    copyFeedback: null,
    onCopyField: () => {},
    showChat: true,
    ...overrides,
  };
}

async function mountBar(t, overrides) {
  dom.window.piBridge = {};
  const boundary = installApiHostBridge(
    dom.window,
    () => ({ call: async () => ({ accounts: [], statuses: [], pairings: [], bindings: [], activities: [] }) }),
    resetRpc,
  );
  t.after(() => boundary.close());
  return mount(t, TopBar, barProps(overrides));
}

test("when a session with usage is open, the top bar names the project and the session and shows cost and context use", async (t) => {
  const view = await mountBar(t, {});
  assert.ok(text(view.container, "dexon"), "the project name is on screen");
  assert.equal(byRole(view.container, "heading", "Release notes")?.textContent, "Release notes");
  const capsule = byRole(view.container, "button", "View context and cost");
  assert.ok(text(capsule, "$1.84"), "the session cost is on screen");
  assert.ok(text(capsule, "62%"), "the share of the context window in use is on screen");
  assert.ok(text(capsule, "124k/200k"), "the used and maximum context sizes are on screen");
  assert.ok(!capsule.textContent.includes("1.6M"), "the total token count is no longer shown");
});

test("when no session is open yet, the top bar titles the page as a new session", async (t) => {
  const view = await mountBar(t, { selectedSession: null, sessionStats: null, contextUsage: null });
  assert.ok(text(view.container, "dexon"), "the project name is on screen");
  assert.ok(byRole(view.container, "heading", "New session"), "the title reads New session");
});

test("when the project name is not known, the session title stays on screen", async (t) => {
  const view = await mountBar(t, { projectName: null });
  assert.ok(byRole(view.container, "heading", "Release notes"), "the session title is still shown");
});

test("when the session title is too long to fit, hovering it reveals the full title", async (t) => {
  const view = await mountBar(t, { selectedSession: { ...SESSION, name: LONG_NAME } });
  const heading = byRole(view.container, "heading");
  assert.ok(heading.textContent.startsWith("Generate the sidebar"), "the session title is shown");
  assert.equal(heading.getAttribute("title"), LONG_NAME, "the full title is available on hover");
});
