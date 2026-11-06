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
import { useState } from "react";
import { createSessionDetail, createSessionTestHost } from "../hooks/agent-session/session-hook-harness.mjs";
import { button, click } from "../../../tests/support/dom-events.mjs";

after(restoreGlobals);

const draftExports =
  'export { ChatWindow } from "./components/ChatWindow.tsx";' +
  'export { ThinkingExpansionStore } from "./lib/thinking-expansion-store.ts";' +
  'export { unsavedMessagesFor, carryUnsavedMessages } from "./lib/unsaved-messages.ts";' +
  'export { useDraftCarry } from "./components/app-shell/use-draft-carry.ts";';

function editor() {
  return rootEl.querySelector('[role="textbox"][aria-multiline="true"]');
}

async function type(text) {
  await act(async () => {
    editor().textContent = text;
    editor().dispatchEvent(new harness.dom.window.InputEvent("input", { bubbles: true }));
  });
}

test("new conversations at identical remote paths retain separate drafts and keep the local legacy draft", async (t) => {
  const f = await attributionFixture(t, draftExports);
  f.serve("remote-a", {});
  f.serve("remote-b", {});
  const props = {
    session: null,
    newSessionCwd: "/srv/shared",
    thinkingExpansionStore: new f.api.ThinkingExpansionStore(),
    processDetailsExpansionStore: new f.api.ThinkingExpansionStore(),
  };
  await f.focus();
  await f.render(f.api.ChatWindow, props);
  await type("draft for A");
  await f.unmount();
  await f.focus("remote-b");
  await f.render(f.api.ChatWindow, props);
  assert.equal(editor().textContent, "", "server B must not inherit server A's same-path draft");
  await type("draft for B");
  await f.unmount();
  await f.focus();
  await f.render(f.api.ChatWindow, props);
  assert.equal(editor().textContent, "draft for A");
  await f.unmount();
  f.api.setDraft("new:/srv/shared", { value: "legacy local draft" });
  await f.focus("primary");
  await f.render(f.api.ChatWindow, props);
  assert.equal(editor().textContent, "legacy local draft");
});

test("promoting server A keeps server B's same-path unsaved message identity separate", async (t) => {
  const f = await attributionFixture(t, draftExports);
  const a = f.api.unsavedMessagesFor(null, "/srv/shared", "remote-a");
  const b = f.api.unsavedMessagesFor(null, "/srv/shared", "remote-b");
  const aEntry = a.startStreaming(1);
  const bEntry = b.streamingEntryId(1);
  assert.notEqual(aEntry, bEntry);
  f.api.carryUnsavedMessages("/srv/shared", "promoted-a", "remote-a");
  assert.equal(f.api.unsavedMessagesFor("promoted-a", null, "remote-a").streamingEntryId(1), aEntry);
  assert.equal(f.api.unsavedMessagesFor(null, "/srv/shared", "remote-b").streamingEntryId(1), bEntry);
  assert.notEqual(f.api.unsavedMessagesFor(null, "/srv/shared", "remote-a").streamingEntryId(1), aEntry);
});

test("draft carry and rollback stay in their captured environment without touching another server", async (t) => {
  const f = await attributionFixture(t, draftExports);
  await f.focus();
  const origin = 'new:["remote-a","/srv/shared"]';
  const target = 'new:["remote-a","/srv/other"]';
  const otherServer = 'new:["remote-b","/srv/other"]';
  f.api.setDraft(target, { value: "existing A target" });
  f.api.setDraft(otherServer, { value: "keep B target" });
  let rollback;
  let restored;
  function Carry() {
    const draft = f.api.useDraftCarry({
      enabled: true,
      currentFolder: "/srv/shared",
      take: () => "from A",
      restore: (text) => {
        restored = text;
      },
    });
    return createElement(
      "main",
      null,
      createElement(
        "button",
        {
          onClick: () => {
            rollback = draft.carry("/srv/other");
          },
        },
        "Move draft",
      ),
      createElement("button", { onClick: () => rollback?.() }, "Cancel move"),
    );
  }
  await f.render(Carry);
  await click(button(rootEl, "Move draft"));
  assert.equal(f.api.getDraft(target)?.value, "from A\n\nexisting A target");
  assert.equal(f.api.getDraft(otherServer)?.value, "keep B target");
  await f.focus("remote-b");
  await click(button(rootEl, "Cancel move"));
  assert.equal(f.api.getDraft(origin)?.value, "from A");
  assert.equal(f.api.getDraft(target)?.value, "existing A target");
  assert.equal(f.api.getDraft(otherServer)?.value, "keep B target");
  assert.equal(restored, "from A");
});

test("a mounted new conversation does not reassign its draft when another environment takes focus", async (t) => {
  const f = await attributionFixture(t, draftExports);
  f.serve("remote-a", {});
  f.serve("remote-b", {});
  const props = {
    session: null,
    newSessionCwd: "/srv/shared",
    thinkingExpansionStore: new f.api.ThinkingExpansionStore(),
    processDetailsExpansionStore: new f.api.ThinkingExpansionStore(),
  };
  await f.focus();
  await f.render(f.api.ChatWindow, props);
  await type("still belongs to A");
  await f.focus("remote-b");
  assert.equal(editor().textContent, "still belongs to A");
  await f.unmount();
  await f.render(f.api.ChatWindow, props);
  assert.equal(editor().textContent, "");
  await f.unmount();
  await f.focus();
  await f.render(f.api.ChatWindow, props);
  assert.equal(editor().textContent, "still belongs to A");
});

test("a newer draft typed during the first send survives promotion to the real session", async (t) => {
  const f = await attributionFixture(t, draftExports);
  const detail = createSessionDetail("promoted-draft-owner");
  let finishPrompt;
  const pendingPrompt = new Promise((resolve) => {
    finishPrompt = resolve;
  });
  const host = createSessionTestHost({
    newAgent: async () => ({ sessionId: detail.info.id }),
    getSession: async () => detail,
    sendAgentCommand: async (_sid, command) => (command.type === "prompt" ? pendingPrompt : {}),
  });
  f.serve("remote-a", host);
  await f.focus();
  function Page() {
    const [session, setSession] = useState(null);
    return createElement(f.api.ChatWindow, {
      session,
      newSessionCwd: session ? null : "/srv/shared",
      onSessionCreated: setSession,
      thinkingExpansionStore: new f.api.ThinkingExpansionStore(),
      processDetailsExpansionStore: new f.api.ThinkingExpansionStore(),
    });
  }
  await f.render(Page);
  await type("first prompt");
  await click(button(rootEl, "Send"));
  for (let pass = 0; pass < 3; pass += 1) await f.flush();
  assert.equal(host.sendCommands.filter(({ payload }) => payload.type === "prompt").length, 1);
  await type("newer draft after first send");
  await act(async () => finishPrompt({}));
  for (let pass = 0; pass < 3; pass += 1) await f.flush();
  assert.equal(editor().textContent, "newer draft after first send");
  await f.unmount();
  assert.equal(f.api.getDraft(detail.info.id)?.value, "newer draft after first send");
  assert.equal(f.api.getDraft('new:["remote-a","/srv/shared"]'), null);
});
