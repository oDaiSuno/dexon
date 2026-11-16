import {
  attributionFixture,
  rootEl,
  restoreGlobals,
  createElement,
  act,
  harness,
} from "./remote-attribution.harness.mjs";
import assert from "node:assert/strict";
import test, { after } from "node:test";
import { createSessionDetail, createSessionTestHost } from "../hooks/agent-session/session-hook-harness.mjs";
import { button, click, keyDown, getByRole } from "../../../tests/support/dom-events.mjs";

after(restoreGlobals);

function primaryView(status = { phase: "connected", generation: 1, since: 0 }) {
  return { id: "primary", label: "Primary", enabled: true, target: { kind: "primary" }, descriptor: null, status };
}

async function primaryFixture(t, restart = async () => {}) {
  const original = harness.dom.window.piBridge;
  const listeners = new Set();
  let hostStatus = "ready";
  let restartCount = 0;
  const f = await attributionFixture(
    t,
    'export { ChatWindow } from "./components/ChatWindow.tsx";' +
      'export { ThinkingExpansionStore } from "./lib/thinking-expansion-store.ts";',
    () => {
      harness.dom.window.piBridge = {
        ...original,
        getHostStatus: async () => hostStatus,
        onHostStatus(listener) {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
        restartHost() {
          restartCount += 1;
          return restart();
        },
      };
    },
  );
  t.after(() => {
    harness.dom.window.piBridge = original;
  });
  await f.push({ environments: [primaryView()] });
  await f.focus("primary", "/fixture");
  return {
    ...f,
    restartCount: () => restartCount,
    async hostStatus(status, detail) {
      hostStatus = status;
      await act(async () => {
        for (const listener of listeners) listener({ status, detail });
      });
    },
    async mountConversation(id) {
      const detail = createSessionDetail(id);
      this.setPrimaryHost(createSessionTestHost({ getSession: async () => detail }));
      this.api.environmentRegistry.registerSession("primary", detail.info.id);
      await this.render(this.api.ChatWindow, {
        session: detail.info,
        newSessionCwd: null,
        thinkingExpansionStore: new this.api.ThinkingExpansionStore(),
        processDetailsExpansionStore: new this.api.ThinkingExpansionStore(),
      });
      await this.flush();
    },
  };
}

function editor() {
  return rootEl.querySelector('[role="textbox"][aria-multiline="true"]');
}

async function type(text) {
  await act(async () => {
    editor().textContent = text;
    editor().dispatchEvent(new harness.dom.window.InputEvent("input", { bubbles: true }));
  });
}

test("an unresponsive primary gates sending, keeps the conversation and draft, and offers one pending restart", async (t) => {
  let finishRestart;
  const f = await primaryFixture(t, () => new Promise((resolve) => (finishRestart = resolve)));
  await f.mountConversation("primary-unresponsive");
  await type("keep my local draft");
  assert.equal(f.api.canSendToEnvironment("primary"), true);
  await f.hostStatus("unresponsive");
  assert.equal(f.api.canSendToEnvironment("primary"), false);
  assert.equal(button(rootEl, "Background service is not responding…")?.disabled, true);
  assert.match(rootEl.textContent, /has not responded for 10 seconds/);
  assert.match(rootEl.textContent, /slow directory or heavy work/);
  assert.match(rootEl.textContent, /Wait for the background service or click Restart now above/);
  const conversation = getByRole(rootEl, "region", "Conversation");
  assert.match(conversation.textContent, /fixture reply/);
  const banner = button(rootEl, "Restart now").closest('[role="status"]');
  assert.ok(banner.compareDocumentPosition(conversation) & 4);
  await keyDown(editor(), "Enter");
  assert.equal(editor().textContent, "keep my local draft");
  await click(button(rootEl, "Restart now"));
  assert.equal(f.restartCount(), 1);
  assert.equal(button(rootEl, "Restart now").disabled, true);
  await act(async () => button(rootEl, "Restart now").click());
  assert.equal(f.restartCount(), 1);
  await act(async () => finishRestart());
  await f.hostStatus("ready");
  assert.equal(f.api.canSendToEnvironment("primary"), true);
  assert.equal(button(rootEl, "Send").disabled, false);
  assert.doesNotMatch(rootEl.textContent, /has not responded for 10 seconds|Restart now/);
  assert.equal(editor().textContent, "keep my local draft");
});

test("a restarting primary preserves messages and the typed composer until both health sources recover", async (t) => {
  const f = await primaryFixture(t);
  await f.mountConversation("primary-reconnecting");
  await type("draft survives the local restart");
  await f.status({ phase: "connecting", stage: "authenticating", attempt: 1, progress: null }, "primary");
  assert.equal(f.api.canSendToEnvironment("primary"), false);
  assert.equal(button(rootEl, "Reconnecting to background service…")?.disabled, true);
  assert.match(rootEl.textContent, /You can send after the background service recovers/);
  assert.match(getByRole(rootEl, "region", "Conversation").textContent, /fixture reply/);
  await f.hostStatus("starting");
  await keyDown(editor(), "Enter");
  assert.equal(editor().textContent, "draft survives the local restart");
  assert.doesNotMatch(rootEl.textContent, /Waiting to reconnect|remote server/);
  await f.status({ phase: "connected", generation: 2, since: 10_000 }, "primary");
  assert.equal(f.api.canSendToEnvironment("primary"), false, "a connected view alone cannot bypass starting");
  await f.hostStatus("ready");
  await f.flush();
  assert.equal(f.api.canSendToEnvironment("primary"), true);
  assert.equal(button(rootEl, "Send").disabled, false);
  assert.equal(editor().textContent, "draft survives the local restart");
  assert.doesNotMatch(rootEl.textContent, /Reconnecting to background service/);
});

test("a stopped or crashed primary offers a restart and shows a rejected restart without losing the draft", async (t) => {
  const f = await primaryFixture(t, async () => {
    throw new Error("host launch failed");
  });
  await f.mountConversation("primary-restart-error");
  await type("keep draft after restart failure");
  for (const status of ["stopped", "crashed"]) {
    await f.hostStatus(status);
    assert.equal(f.api.canSendToEnvironment("primary"), false, status);
    assert.ok(button(rootEl, "Restart now"));
    assert.match(rootEl.textContent, /Reconnecting to background service/);
  }
  await click(button(rootEl, "Restart now"));
  assert.equal(f.restartCount(), 1);
  assert.match(getByRole(rootEl, "alert").textContent, /Could not restart the background service.*host launch failed/);
  assert.equal(button(rootEl, "Restart now").disabled, false);
  assert.equal(editor().textContent, "keep draft after restart failure");
  await act(async () => f.api.setAppLanguage("zh-CN"));
  assert.ok(button(rootEl, "立即重启"));
  assert.match(rootEl.textContent, /正在重新连接后台服务|后台服务恢复后即可发送/);
  await f.hostStatus("unresponsive");
  assert.match(rootEl.textContent, /后台服务已超过 10 秒未响应/);
  assert.equal(button(rootEl, "后台服务暂未响应…").disabled, true);
});

test("a focused remote missing from the snapshot stays pending and never claims local health", async (t) => {
  const f = await primaryFixture(t);
  await f.focus("remote-missing");
  function Attribution() {
    const attribution = f.api.useSpaceAttribution();
    const gate = f.api.useSendGate();
    return createElement("output", null, `${attribution.kind}|${gate.allowed}`);
  }
  await f.render(Attribution);
  assert.equal(rootEl.textContent, "pending|false");
  assert.equal(f.api.canSendToEnvironment("remote-missing"), false);
  await f.render(f.api.ReconnectBanner);
  assert.equal(rootEl.textContent, "");
});
