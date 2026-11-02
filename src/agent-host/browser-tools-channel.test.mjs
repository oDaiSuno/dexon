import { importTestBundle } from "#test-bundle";
import assert from "node:assert/strict";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import path from "node:path";
import test, { after } from "node:test";

const root = path.resolve(import.meta.dirname, "..", "..");
const { createBrowserToolDefinitions, setBrowserSessionSource, browserCapabilityRuntime } = await importTestBundle(
  "browser-tools-channel",
  {
    packages: "external",
    stdin: {
      contents:
        'export {createBrowserToolDefinitions, setBrowserSessionSource} from "./src/agent-host/browser-tools.ts"; export {browserCapabilityRuntime} from "./src/agent-host/browser-capability-runtime.ts";',
      resolveDir: root,
      loader: "ts",
    },
  },
);

const descriptor = Object.getOwnPropertyDescriptor(process, "parentPort");
after(() => {
  if (descriptor) Object.defineProperty(process, "parentPort", descriptor);
  else delete process.parentPort;
});

const listeners = new Set();

function capabilitySnapshot(overrides = {}) {
  return {
    revision: 1,
    browserEnabled: true,
    automationEnabled: true,
    advancedEnabled: true,
    sessionPermissions: {},
    generatedAt: 1,
    ...overrides,
  };
}

function installMain({ capabilities = capabilitySnapshot(), onRequest } = {}) {
  const sent = [];
  let authorized = false;
  let snapshot = capabilities;
  const main = {
    sent,
    setCapabilities(next) {
      snapshot = next;
      browserCapabilityRuntime.apply(next);
    },
  };
  main.setCapabilities(snapshot);
  const reply = (method) => {
    if (method === "browser.capabilities")
      return authorized
        ? {
            snapshot,
            lease: { id: "lease-one", sessionId: "s", permission: "read", policyRevision: 1, expiresAt: 9e15 },
          }
        : { snapshot };
    if (method === "browser.requestAuthorization") {
      authorized = true;
      return {
        snapshot,
        lease: { id: "lease-one", sessionId: "s", permission: "read", policyRevision: 1, expiresAt: 9e15 },
      };
    }
    if (method === "browser.listTabs") return { tabs: [] };
    return {};
  };
  process.parentPort = {
    on(type, listener) {
      if (type === "message") listeners.add(listener);
    },
    postMessage(message) {
      if (message?.type !== "host-rpc") return;
      sent.push(message);
      onRequest?.(message, main);
      const result = reply(message.method);
      for (const listener of listeners)
        globalThis.queueMicrotask(() =>
          listener({ data: { type: "host-rpc-result", id: message.id, ok: true, result } }),
        );
    },
  };
  return main;
}

test("Browser tools declare their owner and stay inactive until capability policy enables them", () => {
  const tools = createBrowserToolDefinitions();
  assert.ok(tools.length > 0);
  for (const tool of tools) {
    assert.equal(tool.dexonOwner, "browser", tool.name);
    assert.equal(tool.exposure, "direct", tool.name);
    assert.equal(tool.defaultActive, false, tool.name);
    assert.equal(typeof tool.promptSnippet, "string", tool.name);
    assert.ok(tool.promptSnippet.trim().length > 0 && tool.promptSnippet.length <= 120, tool.name);
    assert.doesNotMatch(tool.promptSnippet, /[\r\n]/u, tool.name);
  }
});

test("a Browser tool used from a Telegram conversation asks for access naming Telegram as the channel", async () => {
  const { sent } = installMain();
  const sessionManager = SessionManager.inMemory("/tmp");
  setBrowserSessionSource(sessionManager, "channel", "telegram");
  const listTabs = createBrowserToolDefinitions().find((tool) => tool.name === "browser_list_tabs");
  await listTabs.execute("call-one", {}, undefined, undefined, { sessionManager });
  const ask = sent.find((message) => message.method === "browser.requestAuthorization");
  assert.equal(ask.params.source, "channel");
  assert.equal(ask.params.channel, "telegram");
});

test("Browser tools reject before contacting Main when Browser or automation capability is disabled", async () => {
  for (const capability of ["browserEnabled", "automationEnabled"]) {
    const { sent } = installMain({ capabilities: capabilitySnapshot({ [capability]: false }) });
    const sessionManager = SessionManager.inMemory("/tmp");
    const tools = createBrowserToolDefinitions();
    for (const tool of tools) {
      await assert.rejects(
        tool.execute("disabled", {}, undefined, undefined, { sessionManager }),
        /CAPABILITY_DISABLED/u,
        tool.name,
      );
    }
    assert.deepEqual(sent, []);
  }
});

test("an existing Browser tool rejects the next invocation when capability is revoked during a run", async () => {
  const main = installMain();
  const sessionManager = SessionManager.inMemory("/tmp");
  const listTabs = createBrowserToolDefinitions().find((tool) => tool.name === "browser_list_tabs");
  const result = await listTabs.execute("before-revocation", {}, undefined, undefined, { sessionManager });
  assert.deepEqual(JSON.parse(result.content[0].text), { tabs: [] });

  main.sent.length = 0;
  main.setCapabilities(capabilitySnapshot({ revision: 2, automationEnabled: false }));
  await assert.rejects(
    listTabs.execute("after-revocation", {}, undefined, undefined, { sessionManager }),
    /CAPABILITY_DISABLED/u,
  );
  assert.deepEqual(main.sent, []);
});

test("Advanced Browser tools reject before requesting authorization when Advanced Mode is disabled", async () => {
  const { sent } = installMain({ capabilities: capabilitySnapshot({ advancedEnabled: false }) });
  const sessionManager = SessionManager.inMemory("/tmp");
  const tool = createBrowserToolDefinitions().find((definition) => definition.name === "browser_get_cookies");
  await assert.rejects(
    tool.execute("advanced-disabled", {}, undefined, undefined, { sessionManager }),
    /CAPABILITY_DISABLED/u,
  );
  assert.deepEqual(sent, []);
});

test("Browser revocation while authorization is pending prevents the requested operation", async () => {
  const { sent } = installMain({
    onRequest(message, main) {
      if (message.method === "browser.requestAuthorization") {
        main.setCapabilities(capabilitySnapshot({ revision: 2, browserEnabled: false }));
      }
    },
  });
  const sessionManager = SessionManager.inMemory("/tmp");
  const tool = createBrowserToolDefinitions().find((definition) => definition.name === "browser_list_tabs");
  await assert.rejects(
    tool.execute("revoked-authorization", {}, undefined, undefined, { sessionManager }),
    /CAPABILITY_DISABLED/u,
  );
  assert.ok(sent.some((message) => message.method === "browser.requestAuthorization"));
  assert.equal(
    sent.some((message) => message.method === "browser.listTabs"),
    false,
  );
});
