import assert from "node:assert/strict";
import test, { after } from "node:test";
import { useState } from "react";
import {
  byRole,
  click,
  createElement,
  dom,
  input,
  keyDown,
  loadRenderer,
  mount,
  restoreGlobals,
  waitFor,
} from "../../../../tests/support/renderer.mjs";
import { installHostBridge } from "../../../../tests/support/host-bridge.mjs";

const { QuickChannelBinding, PlusMenuLayer, resetRpc, setAppLanguage } = await loadRenderer(
  "quick-channel-binding-behavior",
  'export { QuickChannelBinding } from "./src/renderer/components/channels/QuickChannelBinding.tsx"; export { PlusMenuLayer } from "./src/renderer/components/chat-input/plus-menu-layer.tsx";',
);
setAppLanguage("en-US");
after(restoreGlobals);

const HERE = "s-here";
const MINUTE = 60_000;
const ago = (ms) => new Date(Date.now() - ms).toISOString();

function account(id, channel, name, extra = {}) {
  const now = new Date().toISOString();
  return {
    id,
    channel,
    name,
    enabled: true,
    configured: true,
    dmPolicy: "pairing",
    allowFrom: [],
    groupPolicy: "open",
    groupIds: [],
    groupAllowFrom: [],
    requireMention: true,
    toolNames: [],
    createdAt: now,
    updatedAt: now,
    ...extra,
  };
}

function binding(id, channel, accountId, peerKind, peerId, sessionId) {
  return {
    id,
    channel,
    accountId,
    peerKind,
    peerId,
    ...(sessionId ? { sessionId } : {}),
    cwd: "/work/dexon",
    toolNames: [],
    createdAt: ago(10 * MINUTE),
    lastUsedAt: ago(2 * MINUTE),
  };
}

function fixtureSnapshot() {
  return {
    accounts: [account("wx-one", "weixin", "My WeChat"), account("tg-one", "telegram", "@dexon_ops_bot")],
    statuses: [
      { channel: "weixin", accountId: "wx-one", state: "running", connected: true },
      { channel: "telegram", accountId: "tg-one", state: "error", connected: false },
    ],
    pairings: [],
    bindings: [
      binding("b-lin", "weixin", "wx-one", "dm", "Lin Xia", HERE),
      binding("b-team", "weixin", "wx-one", "group", "Product team"),
      binding("b-zhou", "weixin", "wx-one", "dm", "Zhou Yuan", "s-other"),
      binding("b-release", "telegram", "tg-one", "group", "Dexon Release"),
    ],
    activities: [],
  };
}

const EMPTY = { accounts: [], statuses: [], pairings: [], bindings: [], activities: [] };

function sessionInfo(id, name) {
  const now = new Date().toISOString();
  return {
    path: `/sessions/${id}.jsonl`,
    id,
    cwd: "/work/dexon",
    name,
    created: now,
    modified: now,
    messageCount: 1,
    firstMessage: "",
  };
}

async function openPanel(t, initial = fixtureSnapshot()) {
  const requests = [];
  const navigation = [];
  let latest = initial;
  const host = installHostBridge(dom.window, {
    async call(method, params) {
      requests.push({ method, params });
      if (method === "sessions.list")
        return { sessions: [sessionInfo("s-other", "Weekly report")], runningSessionIds: [] };
      if (method === "channels.bindingUpsert") {
        latest = {
          ...latest,
          bindings: latest.bindings.map((item) => (item.id === params.binding.id ? params.binding : item)),
        };
        return latest;
      }
      if (method === "channels.restart") return { ok: true };
      throw new Error(`Unexpected Host request: ${method}`);
    },
  });
  resetRpc();
  t.after(() => {
    resetRpc();
    host.close();
  });
  function Caller() {
    const [snapshot, setSnapshot] = useState(initial);
    return createElement(QuickChannelBinding, {
      sessionId: HERE,
      snapshot,
      onSnapshotChange: setSnapshot,
      onBack: () => navigation.push("back"),
      onManage: () => navigation.push("manage"),
    });
  }
  const view = await mount(t, Caller);
  return { ...view, requests, navigation };
}

const search = (container) => byRole(container, "textbox", "Search contacts or groups…");
const row = (container, name) => byRole(container, "button", new RegExp(`^.?${name}`));
const upserts = (requests) => requests.filter((request) => request.method === "channels.bindingUpsert");

async function connectedBy(requests) {
  return waitFor(() => {
    const [first] = upserts(requests);
    assert.ok(first, "a conversation was connected");
    return first.params.binding;
  });
}

test("each account is listed with its app name, its conversations and whether it is online", async (t) => {
  const { container } = await openPanel(t);
  const text = container.textContent;
  assert.match(text, /WeChat\s*My WeChat\s*Online/);
  assert.match(text, /Telegram\s*@dexon_ops_bot\s*Offline · click to reconnect/);
  assert.match(text, /Product team\s*Group · replies only when the bot is @mentioned/);
  assert.match(text, /1 connected · 4 total/);
});

test("a Feishu account is named Feishu, not Feishu / Lark", async (t) => {
  const feishu = { ...EMPTY, accounts: [account("fs-one", "feishu", "Pi Bot")] };
  const text = (await openPanel(t, feishu)).container.textContent;
  assert.match(text, /Feishu\s*Pi Bot/);
  assert.doesNotMatch(text, /Feishu \/ Lark/);
});

test("a Lark account is named Lark", async (t) => {
  const lark = { ...EMPTY, accounts: [account("lk-one", "feishu", "Pi Bot", { domain: "lark" })] };
  assert.match((await openPanel(t, lark)).container.textContent, /Lark\s*Pi Bot/);
});

test("the conversation connected to this session is shown on its own with a Disconnect button", async (t) => {
  const { container } = await openPanel(t);
  assert.match(container.textContent, /Connected to this session\s*1/);
  assert.ok(byRole(container, "button", "Disconnect"));
  assert.match(row(container, "Lin Xia").textContent, /Connected here/);
});

test("a conversation connected to another session names that session", async (t) => {
  const { container } = await openPanel(t);
  await waitFor(() => assert.match(row(container, "Zhou Yuan").textContent, /Connected to “Weekly report”/));
});

test("pressing Enter right after opening connects the first conversation that is not already here", async (t) => {
  const { container, requests } = await openPanel(t);
  await keyDown(search(container), "Enter");
  const connected = await connectedBy(requests);
  assert.equal(connected.id, "b-team");
  assert.equal(connected.sessionId, HERE);
});

test("the up arrow does not move the selection onto the conversation that is already here", async (t) => {
  const { container, requests } = await openPanel(t);
  await keyDown(search(container), "ArrowUp");
  await keyDown(search(container), "Enter");
  assert.equal((await connectedBy(requests)).id, "b-team");
});

test("the down arrow then Enter moves the next conversation from its other session to this one", async (t) => {
  const { container, requests } = await openPanel(t);
  await keyDown(search(container), "ArrowDown");
  await keyDown(search(container), "Enter");
  const connected = await connectedBy(requests);
  assert.equal(connected.id, "b-zhou");
  assert.equal(connected.sessionId, HERE);
});

test("clicking a conversation row connects it to this session", async (t) => {
  const { container, requests } = await openPanel(t);
  await click(row(container, "Dexon Release"));
  const connected = await connectedBy(requests);
  assert.equal(connected.id, "b-release");
  assert.equal(connected.sessionId, HERE);
});

test("after Disconnect the conversation is released and typing goes back to the search box", async (t) => {
  const { container, requests } = await openPanel(t);
  const disconnect = byRole(container, "button", "Disconnect");
  disconnect.focus();
  await click(disconnect);
  const released = await connectedBy(requests);
  assert.equal(released.id, "b-lin");
  assert.equal(released.sessionId, undefined);
  await waitFor(() => assert.ok(!byRole(container, "button", "Disconnect"), "the connected block is gone"));
  assert.ok(dom.window.document.activeElement === search(container), "focus is back in the search box");
});

test("searching keeps only conversations whose name matches", async (t) => {
  const { container } = await openPanel(t);
  await input(search(container), "zhou");
  assert.ok(row(container, "Zhou Yuan"));
  assert.ok(!row(container, "Product team"), "Product team is filtered out");
  assert.ok(!row(container, "Dexon Release"), "Dexon Release is filtered out");
});

test("a search that matches nothing names the keyword and explains how a conversation appears", async (t) => {
  const { container } = await openPanel(t);
  await input(search(container), "nobody here");
  assert.match(container.textContent, /No conversations match “nobody here”/);
  assert.match(container.textContent, /Send the bot a message from your phone/);
  assert.ok(!row(container, "Product team"), "Product team is filtered out");
});

test("the offline account's status reconnects that account when clicked", async (t) => {
  const { container, requests } = await openPanel(t);
  await click(byRole(container, "button", "Offline · click to reconnect"));
  await waitFor(() =>
    assert.deepEqual(
      requests.filter((request) => request.method === "channels.restart").map((request) => request.params),
      [{ accountId: "tg-one" }],
    ),
  );
});

test("Escape and the Back button return to the ＋ menu, and the footer link opens remote chat management", async (t) => {
  const { container, navigation } = await openPanel(t);
  await keyDown(search(container), "Escape");
  await click(byRole(container, "button", "Back"));
  await click(byRole(container, "button", "Manage remote chat"));
  assert.deepEqual(navigation, ["back", "back", "manage"]);
});

test("without any chat app the panel explains how to connect one and leads to remote chat management", async (t) => {
  const { container, navigation } = await openPanel(t, EMPTY);
  assert.match(container.textContent, /No chat apps connected yet/);
  assert.ok(!search(container), "there is nothing to search");
  await click(byRole(container, "button", "Connect an app"));
  assert.deepEqual(navigation, ["manage"]);
});

test("the ＋ menu's remote chat row says which conversation is connected here and how many more", async (t) => {
  const snapshot = fixtureSnapshot();
  snapshot.bindings[1] = { ...snapshot.bindings[1], sessionId: HERE };
  const { container } = await mount(t, PlusMenuLayer, {
    plusMenuOpen: true,
    remotePanelOpen: false,
    skillCount: 0,
    remote: { sessionId: HERE, snapshot, onSnapshotChange() {} },
    onOpenPicker() {},
    onOpenSkillPicker() {},
    onOpenRemotePanel() {},
    onBackToPlusMenu() {},
    onCloseMenus() {},
  });
  const remoteRow = byRole(container, "menuitem", /^Remote chat/);
  assert.match(remoteRow.textContent, /Connected to WeChat · Lin Xia\s*\+1/);
});
