import { importTestBundle } from "#test-bundle";
import assert from "node:assert/strict";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import path from "node:path";
import test, { after } from "node:test";

const root = path.resolve(import.meta.dirname, "..", "..");
const { createBrowserToolDefinitions, setBrowserSessionSource } = await importTestBundle("browser-tools-channel", {
  packages: "external",
  stdin: {
    contents:
      'export {createBrowserToolDefinitions, setBrowserSessionSource} from "./src/agent-host/browser-tools.ts";',
    resolveDir: root,
    loader: "ts",
  },
});

const descriptor = Object.getOwnPropertyDescriptor(process, "parentPort");
after(() => {
  if (descriptor) Object.defineProperty(process, "parentPort", descriptor);
  else delete process.parentPort;
});

function installMain() {
  const sent = [];
  const listeners = new Set();
  let authorized = false;
  const snapshot = {
    revision: 1,
    downloads: [],
    permissionRequests: [],
    persistentSessionPermissions: {},
    runtimeSessionGrants: {},
    diagnostics: {},
  };
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
    throw new Error(`unexpected ${method}`);
  };
  process.parentPort = {
    on(type, listener) {
      if (type === "message") listeners.add(listener);
    },
    postMessage(message) {
      if (message?.type !== "host-rpc") return;
      sent.push(message);
      const result = reply(message.method);
      for (const listener of listeners)
        queueMicrotask(() => listener({ data: { type: "host-rpc-result", id: message.id, ok: true, result } }));
    },
  };
  return sent;
}

test("a Browser tool used from a Telegram conversation asks for access naming Telegram as the channel", async () => {
  const sent = installMain();
  const sessionManager = SessionManager.inMemory("/tmp");
  setBrowserSessionSource(sessionManager, "channel", "telegram");
  const listTabs = createBrowserToolDefinitions().find((tool) => tool.name === "browser_list_tabs");
  await listTabs.execute("call-one", {}, undefined, undefined, { sessionManager });
  const ask = sent.find((message) => message.method === "browser.requestAuthorization");
  assert.equal(ask.params.source, "channel");
  assert.equal(ask.params.channel, "telegram");
});
