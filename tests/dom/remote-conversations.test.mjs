import assert from "node:assert/strict";
import test, { after } from "node:test";
import {
  dom,
  byRole,
  click,
  input,
  keyDown,
  loadRenderer,
  mount,
  restoreGlobals,
  waitFor,
} from "../support/renderer.mjs";
import { installHostBridge } from "../support/host-bridge.mjs";

const { ChannelsConfig, resetRpc, setAppLanguage } = await loadRenderer(
  "remote-conversations-behavior",
  'export {ChannelsConfig} from "./src/renderer/components/channels/ChannelsConfig.tsx";',
);
setAppLanguage("en-US");
after(restoreGlobals);

const ago = (ms) => new Date(Date.now() - ms).toISOString();
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

function account(id, channel, name) {
  const now = new Date().toISOString();
  return {
    id,
    channel,
    name,
    enabled: true,
    configured: true,
    dmPolicy: "pairing",
    allowFrom: [],
    groupPolicy: "disabled",
    groupIds: [],
    groupAllowFrom: [],
    requireMention: true,
    toolNames: [],
    createdAt: now,
    updatedAt: now,
  };
}

function binding(id, peerKind, peerId, sessionId, cwd, lastUsedAt) {
  return {
    id,
    channel: "weixin",
    accountId: "wx-one",
    peerKind,
    peerId,
    sessionId,
    cwd,
    toolNames: [],
    createdAt: lastUsedAt,
    lastUsedAt,
  };
}

function session(id, name, cwd) {
  const now = new Date().toISOString();
  return {
    path: `/sessions/${id}.jsonl`,
    id,
    cwd,
    name,
    created: now,
    modified: now,
    messageCount: 1,
    firstMessage: "",
  };
}

function fixtureSnapshot() {
  return {
    accounts: [account("wx-one", "weixin", "My WeChat"), account("tg-one", "telegram", "@dexon_ops_bot")],
    statuses: [],
    pairings: [],
    bindings: [
      binding("b-lin", "dm", "Lin Xia", "s-redesign", "/work/dexon", ago(2 * MINUTE)),
      binding("b-team", "group", "Product team", "s-weekly", "/work/notes", ago(HOUR + 5 * MINUTE)),
      binding("b-zhou", "dm", "Zhou Yuan", undefined, "/work/channels", ago(2 * DAY)),
    ],
    activities: [
      {
        id: "a-in",
        channel: "weixin",
        accountId: "wx-one",
        direction: "inbound",
        outcome: "accepted",
        peerId: "Lin Xia",
        at: new Date().toISOString(),
      },
      {
        id: "a-out",
        channel: "weixin",
        accountId: "wx-one",
        direction: "outbound",
        outcome: "sent",
        peerId: "Lin Xia",
        at: new Date().toISOString(),
      },
      {
        id: "a-down",
        channel: "telegram",
        accountId: "tg-one",
        direction: "system",
        outcome: "failed",
        at: new Date().toISOString(),
      },
      {
        id: "a-ignored",
        channel: "weixin",
        accountId: "wx-one",
        direction: "inbound",
        outcome: "ignored",
        peerId: "Release group",
        at: new Date().toISOString(),
      },
    ],
  };
}

async function remotePage(t) {
  const requests = [];
  const sessions = [
    session("s-redesign", "Redesign the visual system", "/work/dexon"),
    session("s-weekly", "Weekly report", "/work/notes"),
  ];
  const host = installHostBridge(dom.window, {
    async call(method, params) {
      requests.push({ method, params });
      if (method === "channels.list") return fixtureSnapshot();
      if (method === "sessions.list") return { sessions, runningSessionIds: [] };
      return {};
    },
  });
  resetRpc();
  t.after(() => {
    resetRpc();
    host.close();
  });
  const view = await mount(t, ChannelsConfig, { currentSessionId: "s-redesign" });
  await waitFor(() => assert.equal(rows(view.container).length, 3));
  return { ...view, requests };
}

const rows = (container) => [...container.querySelectorAll('[data-testid="channel-binding-row"]')];
const rowOf = (container, name) => rows(container).find((row) => row.textContent.includes(name));
const moreButton = (container, name) => byRole(rowOf(container, name), "button", `More actions for ${name}`);
const menu = () => dom.window.document.querySelector('[role="menu"]');

test("each connected conversation shows who it is, which session and project it reaches, and when it was last used", async (t) => {
  const { container } = await remotePage(t);
  const lin = rowOf(container, "Lin Xia").textContent;
  assert.match(lin, /WeChat · DM/);
  assert.match(lin, /Redesign the visual system/);
  assert.match(lin, /dexon/);
  assert.match(lin, /2m/);
  const team = rowOf(container, "Product team").textContent;
  assert.match(team, /WeChat · Group/);
  assert.match(team, /Weekly report/);
  assert.match(team, /notes/);
  assert.match(team, /1h/);
  const zhou = rowOf(container, "Zhou Yuan").textContent;
  assert.match(zhou, /Separate session/);
  assert.match(zhou, /Not connected to a desktop session; chat messages are kept separately/);
  assert.match(zhou, /2 d/);
});

test("only the conversation connected to the session the user is viewing is marked as the current session", async (t) => {
  const { container } = await remotePage(t);
  assert.match(rowOf(container, "Lin Xia").textContent, /Current session/);
  assert.doesNotMatch(rowOf(container, "Product team").textContent, /Current session/);
  assert.doesNotMatch(rowOf(container, "Zhou Yuan").textContent, /Current session/);
});

test("searching conversations keeps rows whose person, session or project matches and says so when nothing matches", async (t) => {
  const { container } = await remotePage(t);
  const search = byRole(container, "searchbox", "Search conversations…");
  await input(search, "weekly");
  assert.deepEqual(
    rows(container).map((row) => row.textContent.includes("Product team")),
    [true],
  );
  await input(search, "DEXON");
  assert.deepEqual(
    rows(container).map((row) => row.textContent.includes("Lin Xia")),
    [true],
  );
  await input(search, "nobody here");
  assert.equal(rows(container).length, 0);
  assert.match(container.textContent, /No matching conversations/);
});

test("from the keyboard the more menu opens on the current choice and Escape returns focus to its button", async (t) => {
  const { container } = await remotePage(t);
  const trigger = moreButton(container, "Lin Xia");
  await keyDown(trigger, "ArrowDown");
  assert.ok(menu());
  assert.equal(dom.window.document.activeElement.getAttribute("aria-checked"), "true");
  assert.match(dom.window.document.activeElement.textContent, /Redesign the visual system/);
  await keyDown(dom.window.document.activeElement, "ArrowDown");
  assert.match(dom.window.document.activeElement.textContent, /Weekly report/);
  await keyDown(dom.window.document.activeElement, "Escape");
  assert.equal(menu(), null);
  assert.equal(dom.window.document.activeElement, trigger);
});

test("choosing another session in the more menu moves the conversation there without a separate save", async (t) => {
  const { container, requests } = await remotePage(t);
  await click(moreButton(container, "Zhou Yuan"));
  const target = [...menu().querySelectorAll('[role="menuitemradio"]')].find((item) =>
    item.textContent.includes("Weekly report"),
  );
  await click(target);
  await waitFor(() => assert.ok(requests.some((request) => request.method === "channels.bindingUpsert")));
  const upsert = requests.find((request) => request.method === "channels.bindingUpsert");
  assert.equal(upsert.params.binding.id, "b-zhou");
  assert.equal(upsert.params.binding.sessionId, "s-weekly");
});

test("disconnecting from the more menu first asks which conversation will be cut off, and only removes the connection after the user agrees", async (t) => {
  const { container, requests } = await remotePage(t);
  await click(moreButton(container, "Product team"));
  await click(byRole(menu(), "menuitem", "Disconnect this conversation"));
  const confirm = byRole(dom.window.document.body, "alertdialog", "Disconnect “Product team”?");
  assert.ok(confirm, "a confirmation names the conversation before anything is removed");
  assert.match(confirm.textContent, /Disconnect this conversation\?/);
  assert.match(confirm.textContent, /New messages from Product team will go to a separate session/);
  assert.equal(dom.window.document.activeElement, byRole(confirm, "button", "Cancel"));
  assert.equal(
    requests.some((request) => request.method === "channels.bindingDelete"),
    false,
  );
  await click(byRole(confirm, "button", "Disconnect"));
  await waitFor(() => assert.ok(requests.some((request) => request.method === "channels.bindingDelete")));
  assert.deepEqual(requests.find((request) => request.method === "channels.bindingDelete").params, {
    bindingId: "b-team",
  });
  assert.equal(dom.window.document.querySelector('[role="alertdialog"]'), null);
});

test("cancelling the disconnect confirmation keeps the connection and puts focus back on the more button", async (t) => {
  const { container, requests } = await remotePage(t);
  const trigger = moreButton(container, "Product team");
  await click(trigger);
  await click(byRole(menu(), "menuitem", "Disconnect this conversation"));
  const confirm = byRole(dom.window.document.body, "alertdialog", "Disconnect “Product team”?");
  await click(byRole(confirm, "button", "Cancel"));
  assert.equal(dom.window.document.querySelector('[role="alertdialog"]'), null);
  assert.equal(dom.window.document.activeElement, trigger);
  assert.equal(
    requests.some((request) => request.method === "channels.bindingDelete"),
    false,
  );
});

test("pressing Escape in the disconnect confirmation keeps the connection and puts focus back on the more button", async (t) => {
  const { container, requests } = await remotePage(t);
  const trigger = moreButton(container, "Lin Xia");
  await click(trigger);
  await click(byRole(menu(), "menuitem", "Disconnect this conversation"));
  await keyDown(dom.window.document.activeElement, "Escape");
  assert.equal(dom.window.document.querySelector('[role="alertdialog"]'), null);
  assert.equal(dom.window.document.activeElement, trigger);
  assert.equal(
    requests.some((request) => request.method === "channels.bindingDelete"),
    false,
  );
});

test("recent activity is shown without expanding and each entry reads as one sentence with a short time", async (t) => {
  const { container } = await remotePage(t);
  const log = container.querySelector('[data-testid="channel-activity-log"]');
  assert.ok(log);
  for (let node = log; node; node = node.parentElement) {
    assert.equal(node.hidden, false);
    assert.notEqual(dom.window.getComputedStyle(node).display, "none");
  }
  const entries = [...log.querySelectorAll('[data-testid="channel-activity-entry"]')].map((entry) =>
    entry.textContent.replace(/\s+/g, " ").trim(),
  );
  assert.equal(entries.length, 4);
  assert.match(entries[0], /^\d{2}:\d{2}.*Message from Lin Xia/);
  assert.match(entries[1], /Replied to Lin Xia/);
  assert.match(entries[2], /@dexon_ops_bot disconnected/);
  assert.match(entries[3], /Ignored a message from Release group/);
  assert.doesNotMatch(entries.join(" "), /\d{4}\/\d{1,2}\/\d{1,2}/);
});
