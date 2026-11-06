import { importTestBundle } from "#test-bundle";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

const { AdapterRegistry, ChannelManager, ChannelConfigStore, FeishuAdapter, FeishuApiError, sendFeishuText } =
  await importTestBundle("src/agent-host/channels/channel-deliver", {
    packages: "external",
    stdin: {
      contents: [
        'export { AdapterRegistry } from "./adapter-registry.ts";',
        'export { ChannelManager } from "./channel-manager.ts";',
        'export { ChannelConfigStore } from "./config-store.ts";',
        'export { FeishuAdapter } from "./adapters/feishu/adapter.ts";',
        'export { FeishuApiError, sendFeishuText } from "./adapters/feishu/api.ts";',
      ].join("\n"),
      resolveDir: import.meta.dirname,
      sourcefile: "channel-deliver-test-entry.ts",
      loader: "ts",
    },
  });

const credential = { token: "fixture-secret", providerAccountId: "ou_bot", baseUrl: "https://open.feishu.cn" };
const request = { accountId: "automation", peerId: "ou_user", text: "scheduled notice" };

function account(overrides = {}) {
  return {
    id: "automation",
    channel: "feishu",
    name: "Automation",
    enabled: true,
    appId: "cli_1234567890abcdef",
    domain: "feishu",
    dmPolicy: "open",
    allowFrom: [],
    groupPolicy: "disabled",
    groupIds: [],
    groupAllowFrom: [],
    requireMention: true,
    toolNames: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

async function fixture(t, options = {}) {
  const directory = await mkdtemp(path.join(tmpdir(), "dexon-channel-deliver-"));
  const registry = new AdapterRegistry();
  if (options.account !== null) {
    new ChannelConfigStore(path.join(directory, "channels.json")).upsertAccount(account(options.account));
  }
  const providerCalls = [];
  registry.register(
    new FeishuAdapter({
      async getBotIdentity() {
        return { openId: "ou_bot", name: "Automation" };
      },
      async connect() {
        return { close() {} };
      },
      async sendText(_credentials, message) {
        providerCalls.push({ kind: "text", ...message });
        if (options.failure && providerCalls.length >= (options.failAt ?? 1)) throw options.failure;
        return options.http ? sendFeishuText(_credentials, message, options.http) : "om_delivered";
      },
      async sendCard(_credentials, message) {
        providerCalls.push({ kind: "rich", ...message });
        if (options.cardFailure) throw options.cardFailure;
        if (options.failure && providerCalls.length >= (options.failAt ?? 1)) throw options.failure;
        return "om_card";
      },
      async sendMedia(_credentials, message) {
        providerCalls.push({ kind: "media", ...message });
        if (options.failure && providerCalls.length >= (options.failAt ?? 1)) throw options.failure;
        return "om_media";
      },
    }),
  );
  const events = [];
  const manager = new ChannelManager(
    {
      emit: (...event) => {
        events.push(event);
        if (options.emitFailure && event[0] === "channels.status") throw new Error("event subscriber unavailable");
      },
    },
    () => {},
    {
      dataDirectory: directory,
      registry,
      secretAccess: {
        get: options.getSecret ?? (async () => (options.secret === undefined ? credential : options.secret)),
        set: async () => {},
        delete: async () => {},
      },
      bridge: {},
    },
  );
  t.after(async () => {
    await manager.shutdown();
    await rm(directory, { recursive: true, force: true });
  });
  return { manager, providerCalls, events, directory, registry };
}

function fakeHttp(handler) {
  const request = async (options) => {
    if (String(options.url).includes("tenant_access_token")) {
      return { code: 0, tenant_access_token: "fixture-tenant-token", expire: 7_200 };
    }
    return handler(options);
  };
  const method =
    (name) =>
    async (url, data, options = {}) =>
      request({ ...options, method: name, url, data });
  return Object.fromEntries([
    ["request", request],
    ...["get", "delete", "head", "options", "post", "put", "patch"].map((name) => [name, method(name)]),
  ]);
}

test("proactive delivery reports a missing account without sending or throwing", async (t) => {
  const { manager, providerCalls } = await fixture(t, { account: null });
  assert.equal(typeof manager.deliver, "function", "ChannelManager must expose observed proactive delivery");
  const observation = await manager.deliver(request);
  assert.equal(observation.kind, "not_applied");
  assert.equal(observation.transient, false);
  assert.equal(providerCalls.length, 0);
});

test("Feishu create and reply forward an optional uuid without promising idempotency", async () => {
  const calls = [];
  const http = fakeHttp(async (options) => {
    calls.push(options);
    return { code: 0, data: { message_id: "om_uuid" } };
  });
  const credentials = { appId: "cli_1234567890abcdb1", appSecret: credential.token, domain: "feishu" };
  await sendFeishuText(credentials, { peerId: "ou_user", text: "create", uuid: "create-key" }, http);
  assert.equal(calls.at(-1).data.uuid, "create-key");
  await sendFeishuText(
    credentials,
    {
      peerId: "ou_user",
      text: "reply",
      replyToMessageId: "om_source",
      replyInThread: true,
      uuid: "reply-key",
    },
    http,
  );
  assert.equal(calls.at(-1).data.uuid, "reply-key");
  assert.equal(calls.at(-1).data.reply_in_thread, true);
});

test("all built-in adapters declare conservative proactive delivery capabilities", async (t) => {
  const { registry, manager } = await fixture(t);
  for (const id of ["feishu", "telegram", "weixin"]) {
    const expected = { idempotency: { kind: "none" }, needsContextToken: id === "weixin" };
    assert.deepEqual(registry.get(id).proactiveDelivery, expected);
    assert.deepEqual(manager.deliveryCapability(id), expected);
  }
  assert.deepEqual(manager.deliveryCapability("automation"), manager.deliveryCapability("feishu"));
  assert.equal(manager.deliveryCapability("missing-account"), null);
});

test("single-message adapter sends reject oversized text before contacting any provider", async (t) => {
  const { registry, providerCalls } = await fixture(t);
  const networkCalls = [];
  t.mock.method(globalThis, "fetch", async (url, init) => {
    networkCalls.push({ url, init });
    return {
      ok: true,
      status: 200,
      json: async () => ({ ok: true, result: { message_id: 42 } }),
      text: async () => '{"ret":0}',
    };
  });
  for (const [id, limit] of [
    ["feishu", 20_000],
    ["telegram", 4_000],
    ["weixin", 3_500],
  ]) {
    await t.test(id, async () => {
      await assert.rejects(
        registry.get(id).send({
          account: account({ channel: id }),
          secret: credential,
          peerId: "42",
          text: "你".repeat(limit + 1),
          contextToken: "context",
          singleMessageOnly: true,
        }),
        (error) => error.code === "output_too_large" && error.applied === "no",
      );
      assert.equal(providerCalls.length + networkCalls.length, 0);
    });
  }
});

test("invalid input and unavailable prerequisites are permanently not applied before dispatch", async (t) => {
  const networkCalls = [];
  t.mock.method(globalThis, "fetch", async (...args) => {
    networkCalls.push(args);
    throw new Error("Provider must not be contacted during preflight");
  });
  const cases = [
    { name: "disabled account", account: { enabled: false } },
    { name: "missing secret", secret: null },
    { name: "blank secret", secret: { ...credential, token: " " } },
    { name: "missing Feishu application", account: { appId: undefined } },
    { name: "missing Weixin context", account: { channel: "weixin" } },
    { name: "empty text", request: { ...request, text: "  \r\n " } },
    { name: "non-string text", request: { ...request, text: 12 } },
    { name: "null character", request: { ...request, text: "bad\0text" } },
    { name: "unpaired surrogate", request: { ...request, text: "bad\ud800text" } },
    { name: "empty peer", request: { ...request, peerId: " " } },
    { name: "invalid format", request: { ...request, format: "html" } },
    { name: "invalid send limit", request: { ...request, singleMessageOnly: "false" } },
    { name: "missing request", request: null },
    {
      name: "credential vault failure",
      getSecret: async () => {
        throw new Error("vault unavailable");
      },
    },
  ];
  for (const entry of cases) {
    await t.test(entry.name, async (t) => {
      const { manager, providerCalls } = await fixture(t, entry);
      const observation = await manager.deliver("request" in entry ? entry.request : request);
      assert.equal(observation.kind, "not_applied");
      assert.equal(observation.transient, false);
      assert.equal(providerCalls.length, 0);
    });
  }
  assert.equal(networkCalls.length, 0);
});

test("default proactive delivery rejects long or multiple message units without any send", async (t) => {
  const { manager, providerCalls } = await fixture(t);
  for (const change of [
    { text: "🙂".repeat(20_001) },
    { attachments: [{ kind: "file", path: "/unused.txt" }] },
    {
      attachments: [
        { kind: "file", path: "/one.txt" },
        { kind: "file", path: "/two.txt" },
      ],
    },
  ]) {
    const observation = await manager.deliver({ ...request, ...change });
    assert.equal(observation.kind, "not_applied");
    assert.equal(observation.error.code, "output_too_large");
    assert.equal(observation.transient, false);
    assert.equal(providerCalls.length, 0);
  }
});

test("successful proactive delivery forwards routing and key and records public status and activity", async (t) => {
  const { manager, providerCalls } = await fixture(t);
  const observation = await manager.deliver({
    ...request,
    text: "scheduled notice 🙂",
    idempotencyKey: "stable-delivery-key",
    threadId: "omt_thread",
    replyToMessageId: "om_source",
  });
  assert.deepEqual(observation, { kind: "applied", output: { messageId: "om_delivered" } });
  assert.deepEqual(providerCalls, [
    {
      kind: "text",
      peerId: "ou_user",
      text: "scheduled notice 🙂",
      uuid: "stable-delivery-key",
      replyToMessageId: "om_source",
      replyInThread: true,
    },
  ]);
  const snapshot = await manager.snapshot();
  assert.ok(snapshot.statuses.find((status) => status.accountId === request.accountId).lastOutboundAt > 0);
  assert.ok(
    snapshot.activities.some(
      (activity) =>
        activity.accountId === request.accountId &&
        activity.peerId === request.peerId &&
        activity.direction === "outbound" &&
        activity.outcome === "sent",
    ),
  );
  assert.deepEqual(manager.deliveryCapability("feishu").idempotency, { kind: "none" });
});

test("Feishu provider rejection and ambiguous transport or receipt failures remain distinct", async (t) => {
  for (const entry of [
    { name: "provider rejection", response: { code: 99991663, msg: "permission denied" }, kind: "not_applied" },
    { name: "transport timeout", failure: new Error("socket timeout"), kind: "maybe_applied" },
    { name: "missing provider receipt", response: { code: 0, data: {} }, kind: "maybe_applied" },
  ]) {
    await t.test(entry.name, async (t) => {
      const http = fakeHttp(async () => {
        if (entry.failure) throw entry.failure;
        return entry.response;
      });
      const { manager } = await fixture(t, { http });
      const observation = await manager.deliver(request);
      assert.equal(observation.kind, entry.kind);
      if (entry.kind === "not_applied") assert.equal(observation.transient, false);
    });
  }
});

test("unknown provider errors remain possibly applied and explicit rejection retains transience", async (t) => {
  for (const [failure, kind, transient] of [
    [new Error("unexpected provider response"), "maybe_applied"],
    [new FeishuApiError("rate limited", 99991400, false), "not_applied", true],
    [new FeishuApiError("transport failure", undefined, true), "maybe_applied"],
  ]) {
    const { manager } = await fixture(t, { failure });
    const observation = await manager.deliver(request);
    assert.equal(observation.kind, kind);
    if (kind === "not_applied") assert.equal(observation.transient, transient);
  }
});

test("a later definite Feishu rejection cannot erase an earlier delivered chunk or attachment", async (t) => {
  for (const change of [{ text: "x".repeat(20_001) }, { attachments: [{ kind: "file", path: "/unused.txt" }] }]) {
    const { manager, providerCalls } = await fixture(t, {
      failure: new FeishuApiError("second message rejected", 99991663, false),
      failAt: 2,
    });
    const observation = await manager.deliver({ ...request, ...change, singleMessageOnly: false });
    assert.equal(observation.kind, "maybe_applied");
    assert.equal(providerCalls.length, 2);
  }
});

test("rich delivery forwards its key without claiming verified idempotency", async (t) => {
  const { manager, providerCalls } = await fixture(t);
  const result = await manager.deliver({ ...request, format: "rich", idempotencyKey: "rich-key" });
  assert.equal(result.kind, "applied");
  assert.equal(providerCalls.length, 1);
  assert.equal(providerCalls[0].kind, "rich");
  assert.equal(providerCalls[0].uuid, "rich-key");
});

test("legacy testSend can still split long text and send while the account is disabled", async (t) => {
  const { manager, providerCalls } = await fixture(t, { account: { enabled: false } });
  const result = await manager.testSend(request.accountId, request.peerId, "x".repeat(20_001));
  assert.deepEqual(result, { ok: true, messageId: "om_delivered" });
  assert.equal(providerCalls.length, 2);
  assert.equal(
    providerCalls.every((call) => call.kind === "text" && call.uuid === undefined),
    true,
  );
});

test("rich fallback occurs only after a definite provider rejection", async (t) => {
  for (const unknown of [false, true]) {
    const { manager, providerCalls } = await fixture(t, {
      cardFailure: new FeishuApiError("card failed", undefined, unknown),
    });
    const result = await manager.deliver({ ...request, format: "rich" });
    assert.equal(result.kind, unknown ? "maybe_applied" : "applied");
    assert.deepEqual(
      providerCalls.map((call) => call.kind),
      unknown ? ["rich"] : ["rich", "text"],
    );
  }
});

test("successful delivery remains applied if a public event subscriber fails afterwards", async (t) => {
  const { manager, providerCalls, events } = await fixture(t, { emitFailure: true });
  const result = await manager.deliver(request);
  assert.deepEqual(result, { kind: "applied", output: { messageId: "om_delivered" } });
  assert.equal(providerCalls.length, 1);
  assert.ok(events.some(([topic, , activity]) => topic === "channels.activity" && activity.outcome === "sent"));
});

test("legacy multi-message delivery never reuses one uuid for distinct message units", async (t) => {
  const { manager, providerCalls } = await fixture(t);
  const result = await manager.deliver({
    ...request,
    text: "x".repeat(20_001),
    singleMessageOnly: false,
    idempotencyKey: "one-logical-send",
  });
  assert.equal(result.kind, "applied");
  assert.equal(providerCalls.length, 2);
  assert.ok(providerCalls.every((call) => call.uuid === undefined));
});

test("Weixin proactive delivery forwards an available context token to the provider", async (t) => {
  const calls = [];
  t.mock.method(globalThis, "fetch", async (_url, init) => {
    calls.push(JSON.parse(init.body));
    return { ok: true, text: async () => '{"ret":0}' };
  });
  const { manager } = await fixture(t, { account: { channel: "weixin" } });
  const result = await manager.deliver({ ...request, contextToken: "reply-context" });
  assert.equal(result.kind, "applied");
  assert.equal(typeof result.output.messageId, "string");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].msg.context_token, "reply-context");
  assert.equal(calls[0].msg.to_user_id, request.peerId);
});

test("channel capability lookup remains channel-based when an account id equals a channel id", async (t) => {
  const { manager } = await fixture(t, { account: { id: "weixin", channel: "feishu" } });
  assert.deepEqual(manager.deliveryCapability("weixin"), {
    idempotency: { kind: "none" },
    needsContextToken: true,
  });
});
