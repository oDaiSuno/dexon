import {
  attributionFixture,
  rootEl,
  restoreGlobals,
  act,
  harness,
  createElement,
} from "./remote-attribution.harness.mjs";
import { button, click, keyDown } from "../../../tests/support/dom-events.mjs";
import assert from "node:assert/strict";
import test, { after } from "node:test";
import { createSessionDetail, createSessionTestHost } from "../hooks/agent-session/session-hook-harness.mjs";

after(restoreGlobals);

function editor() {
  return rootEl.querySelector('[role="textbox"][aria-multiline="true"]');
}

async function type(text) {
  await act(async () => {
    editor().textContent = text;
    editor().dispatchEvent(new harness.dom.window.InputEvent("input", { bubbles: true }));
  });
}

const inputProps = { cwd: "/srv/shared", draftKey: 'new:["remote-a","/srv/shared"]', isStreaming: false, onAbort() {} };

test("unavailable remote send buttons and Enter both keep the typed draft until reconnection", async (t) => {
  const f = await attributionFixture(t);
  f.serve("remote-a", {});
  const sent = [];
  await f.focus();
  await f.render(f.api.ChatInput, { ...inputProps, onSend: (message) => sent.push(message) });
  await type("retain remote draft");
  for (const status of [
    { phase: "available" },
    { phase: "connecting", stage: "opening", progress: null, attempt: 1 },
    { phase: "backoff", retryAt: 10_000, failureCount: 1, reason: "network", detail: "lost" },
    { phase: "offline", lastFailure: null },
    { phase: "blocked", diagnosis: { reason: "configuration", detail: "Check configuration" } },
  ]) {
    await f.status(status);
    assert.equal(button(rootEl, "Waiting to reconnect…")?.disabled, true, status.phase);
    assert.match(rootEl.textContent, /You can send after reconnecting/);
    await keyDown(editor(), "Enter");
    assert.equal(editor().textContent, "retain remote draft", status.phase);
    assert.equal(sent.length, 0);
  }
  await f.unmount();
  assert.equal(JSON.parse(harness.storedValues.get(`dexon-draft:${inputProps.draftKey}`)).value, "retain remote draft");
  await f.status({ phase: "connected", generation: 2, since: 10_000 });
  f.serve("remote-a", {});
  await f.render(f.api.ChatInput, { ...inputProps, onSend: (message) => sent.push(message) });
  await click(button(rootEl, "Send"));
  assert.deepEqual(sent, ["retain remote draft"]);
  assert.equal(editor().textContent, "");
});

test("an explicit rejected send restores the submitted draft and does not replace newer typing", async (t) => {
  const f = await attributionFixture(t);
  const replies = [];
  const props = { ...inputProps, onSend: () => new Promise((resolve) => replies.push(resolve)) };
  await f.render(f.api.ChatInput, props);
  await type("first rejected draft");
  await keyDown(editor(), "Enter");
  assert.equal(editor().textContent, "");
  await act(async () => replies.shift()({ ok: false }));
  assert.equal(editor().textContent, "first rejected draft");
  await click(button(rootEl, "Send"));
  await type("newer unsent draft");
  await act(async () => replies.shift()({ ok: false }));
  assert.equal(editor().textContent, "newer unsent draft");
  assert.match(rootEl.textContent, /Your newer draft was kept/);
});

test("streaming follow-ups cannot bypass the remote gate and restore rejected queued drafts", async (t) => {
  const f = await attributionFixture(t);
  f.serve("remote-a", {});
  let attempts = 0;
  const props = {
    ...inputProps,
    isStreaming: true,
    onSend() {},
    onFollowUp: async () => {
      attempts += 1;
      throw new Error("queue refused");
    },
  };
  await f.focus();
  await f.render(f.api.ChatInput, props);
  await type("follow-up draft");
  await f.status({ phase: "offline", lastFailure: null });
  await keyDown(editor(), "Enter");
  assert.equal(attempts, 0);
  assert.equal(editor().textContent, "follow-up draft");
  await f.status({ phase: "connected", generation: 2, since: 10_000 });
  f.serve("remote-a", {});
  await keyDown(editor(), "Enter");
  assert.equal(attempts, 1);
  assert.equal(editor().textContent, "follow-up draft");
  assert.match(rootEl.textContent, /Not queued: queue refused/);
});

test("an owner rejection after the composer clears input restores the actual remote draft", async (t) => {
  const f = await attributionFixture(t, 'export { useAgentSession } from "./hooks/useAgentSession.ts";');
  const detail = createSessionDetail("stale-composer-gate");
  const primary = createSessionTestHost({ getSession: async () => detail });
  f.setPrimaryHost(primary);
  f.api.environmentRegistry.registerSession("remote-a", detail.info.id);
  await f.status({ phase: "offline", lastFailure: null });
  function Conversation() {
    const owner = f.api.useAgentSession({
      session: { ...detail.info, environmentId: "remote-a" },
      newSessionCwd: null,
    });
    return createElement(f.api.ChatInput, { ...inputProps, onSend: owner.handleSend });
  }
  await f.render(Conversation);
  await type("actual remote draft");
  assert.equal(button(rootEl, "Send").disabled, false, "the workspace gate alone is insufficient");
  await keyDown(editor(), "Enter");
  assert.equal(editor().textContent, "actual remote draft");
  assert.equal(primary.sendCommands.length, 0, "the remote draft must never be delivered locally");
  await f.unmount();
  assert.equal(JSON.parse(harness.storedValues.get(`dexon-draft:${inputProps.draftKey}`)).value, "actual remote draft");
});

test("an explicitly rejected streaming follow-up restores its submitted draft", async (t) => {
  const f = await attributionFixture(t);
  await f.render(f.api.ChatInput, {
    ...inputProps,
    isStreaming: true,
    onSend() {},
    onFollowUp: async () => ({ ok: false }),
  });
  await type("rejected follow-up draft");
  await keyDown(editor(), "Enter");
  assert.equal(editor().textContent, "rejected follow-up draft");
});
