import assert from "node:assert/strict";
import { accessibleName, act, byRole, dom, loadRenderer, mount } from "./renderer.mjs";
import { installApiHostBridge } from "./api-host.mjs";
import { createSessionTestHost } from "../../src/renderer/hooks/agent-session/session-hook-harness.mjs";
import { at, turnDetail, userTurn } from "../fixtures/chat-answer-turn.mjs";

const { ChatWindow, ThinkingExpansionStore, resetRpc } = await loadRenderer(
  "chat-live-processed-block",
  'export {ChatWindow} from "./src/renderer/components/ChatWindow.tsx"; export {ThinkingExpansionStore} from "./src/renderer/lib/thinking-expansion-store.ts";',
);

const FOLLOWING = dom.window.Node.DOCUMENT_POSITION_FOLLOWING;
export const QUESTION = { ...userTurn(), timestamp: at(0) };

export function messagesArea(container) {
  const area = byRole(container, "group", "Messages");
  assert.ok(area, "the conversation shows its message area");
  return area;
}

export function processGroups(container) {
  return [...messagesArea(container).querySelectorAll("button[aria-expanded]")].filter((node) =>
    /process details|processed/i.test(node.textContent),
  );
}

export function labelOf(container, index = 0) {
  const groups = processGroups(container);
  assert.ok(groups[index], `the conversation shows a Processed block number ${index + 1}`);
  return groups[index].textContent.trim();
}

export function thinkingRows(container) {
  return [...messagesArea(container).querySelectorAll("button")].filter((node) =>
    /Deep thinking/.test(node.textContent),
  );
}

export function footerCopies(container) {
  return [...messagesArea(container).querySelectorAll("button")].filter(
    (node) => accessibleName(node) === "Copy message" && node.classList.contains("message-hover-action"),
  );
}

export function isBefore(earlier, later, label) {
  assert.ok(earlier.compareDocumentPosition(later) & FOLLOWING, label);
}

export function durationToken(node) {
  return [...node.querySelectorAll("*")]
    .map((candidate) => (candidate.children.length === 0 ? candidate.textContent.trim() : ""))
    .find((value) => /^(\d+\.\d+s|\d+m\d+s|\d+s)$/.test(value));
}

export async function settle() {
  for (let pass = 0; pass < 3; pass += 1) {
    await act(async () => {
      await new Promise((resolve) => setImmediate(resolve));
    });
  }
}

export async function tick(t, milliseconds) {
  await act(async () => t.mock.timers.tick(milliseconds));
  await settle();
}

export async function scene(t, id, { now, messages = [QUESTION] } = {}) {
  if (now !== undefined) t.mock.timers.enable({ apis: ["Date", "setInterval"], now });
  let current = turnDetail(id, messages);
  let runActive = true;
  const host = createSessionTestHost({
    getSession: async () => current,
    agentState: async () => (runActive ? { running: true, state: { isStreaming: true } } : { running: false }),
    sendAgentCommand: async () => ({}),
  });
  const restartListeners = new Set();
  dom.window.piBridge = {
    onHostRestarted(listener) {
      restartListeners.add(listener);
      return () => restartListeners.delete(listener);
    },
  };
  const boundary = installApiHostBridge(dom.window, () => host, resetRpc);
  const props = {
    session: current.info,
    newSessionCwd: null,
    thinkingExpansionStore: new ThinkingExpansionStore(),
    processDetailsExpansionStore: new ThinkingExpansionStore(),
  };
  let view;
  t.after(async () => {
    try {
      await view?.unmount();
    } finally {
      boundary.close();
    }
  });
  const show = async () => {
    view = await mount(t, ChatWindow, props);
    await settle();
  };
  await show();
  const emit = async (event) => {
    await act(async () => {
      for (const sink of host.eventSinks.filter((candidate) => candidate.active)) sink.onEvent(event);
    });
    await settle();
  };
  return {
    host,
    emit,
    restart: async () => {
      await act(async () => {
        for (const listener of restartListeners) listener({ reason: "crash-recovery" });
      });
      await settle();
    },
    root: view.container,
    setDetail: (next) => (current = turnDetail(id, next)),
    endRun: () => {
      runActive = false;
    },
    reopen: async () => {
      await view.unmount();
      await show();
      return view.container;
    },
  };
}
