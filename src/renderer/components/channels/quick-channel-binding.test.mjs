import { importTestBundle } from "#test-bundle";
import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

const { QuickChannelBinding } = await importTestBundle("src/renderer/components/channels/quick-channel-binding", {
  stdin: {
    contents: 'export { QuickChannelBinding } from "./QuickChannelBinding.tsx";',
    resolveDir: import.meta.dirname,
    sourcefile: "quick-channel-binding-test-entry.tsx",
    loader: "tsx",
  },
  tsconfig: path.join(import.meta.dirname, "../../../../tsconfig.renderer.json"),
  external: ["react", "react-dom", "react-dom/*"],
});

function snapshot(sessionId, connected, channel = "weixin") {
  const now = new Date().toISOString();
  const accountId = channel === "telegram" ? "tg-one" : channel === "feishu" ? "fs-one" : "wx-one";
  return {
    accounts: [
      {
        id: accountId,
        channel,
        name: channel === "telegram" ? "@pi_bot" : channel === "feishu" ? "Pi Feishu Bot" : "My WeChat",
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
      },
    ],
    statuses: [{ channel, accountId, state: "running", connected }],
    pairings: [],
    bindings: [
      {
        id: "binding-one",
        channel,
        accountId,
        peerKind: "dm",
        peerId: "user-one",
        ...(sessionId ? { sessionId } : {}),
        cwd: "/tmp/channel",
        toolNames: [],
        createdAt: now,
        lastUsedAt: now,
      },
    ],
    activities: [],
  };
}

function render(channelSnapshot) {
  return renderToStaticMarkup(
    createElement(QuickChannelBinding, {
      sessionId: "session-one",
      snapshot: channelSnapshot,
      onSnapshotChange() {},
      onBack() {},
      onManage() {},
    }),
  );
}

test("the remote panel lists every conversation of a connected account and where it goes", () => {
  const html = render(snapshot(undefined, true));
  assert.match(html, /data-testid="channel-quick-bind-popover"/);
  assert.match(html, /Connect a chat conversation to this session/);
  assert.match(html, /My WeChat/);
  assert.match(html, /user-one/);
  assert.match(html, /DM/);
  assert.match(html, /1 conversation/);
});

test("the remote panel names the messaging app of each account", () => {
  assert.match(render(snapshot(undefined, true, "telegram")), />Telegram</);
  assert.match(render(snapshot(undefined, true, "feishu")), />Feishu</);
  const lark = snapshot(undefined, true, "feishu");
  lark.accounts[0].domain = "lark";
  assert.match(render(lark), />Lark</);
});

test("a conversation connected to this session is reported as connected and can be disconnected", () => {
  const html = render(snapshot("session-one", true));
  assert.match(html, /Connected to this session/);
  assert.match(html, /Connected here/);
  assert.match(html, /Disconnect/);
  assert.match(html, /1 connected · 1 total/);
});

test("a conversation connected to another session is not offered as connected here", () => {
  const html = render(snapshot("another-session", true));
  assert.doesNotMatch(html, /Connected here/);
  assert.match(html, /Connected to “another-session”/);
});

test("without any chat app the panel explains how to connect one", () => {
  const html = render({ accounts: [], statuses: [], pairings: [], bindings: [], activities: [] });
  assert.match(html, /No chat apps connected yet/);
  assert.match(html, /Connect an app/);
  assert.doesNotMatch(html, /Conversations you can connect/);
});
