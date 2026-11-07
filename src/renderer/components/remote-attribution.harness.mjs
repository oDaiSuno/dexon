import { harness, rootEl, restoreGlobals } from "./chat-input-file-reference.harness.mjs";
import { importTestBundle } from "#test-bundle";
import { realRendererGraphOptions } from "./renderer-real-graph.mjs";
import path from "node:path";
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";
import { installRendererApi } from "../../../tests/support/renderer-api.mjs";
import { createRpcServer } from "../../contract/rpc.ts";
import { MessageChannel } from "node:worker_threads";
import { createBrowserObservers } from "../../../tests/support/browser-observers.mjs";

export { harness, rootEl, restoreGlobals, act, createElement };

export function remoteView(id = "remote-a", status = { phase: "connected", generation: 1, since: 0 }) {
  return {
    id,
    label: id === "remote-a" ? "gpu-a100" : "gpu-b200",
    enabled: true,
    target: { kind: "ssh", host: id, user: "ubuntu", port: 22 },
    status,
    descriptor: null,
  };
}

let sequence = 0;

export async function attributionFixture(t, extraExports = "", beforeImport = () => {}) {
  t.mock.timers.enable({ apis: ["setInterval", "Date"], now: 10_000 });
  beforeImport();
  const errors = t.mock.method(console, "error", () => {});
  const browser = createBrowserObservers();
  const element = harness.dom.window.HTMLElement.prototype;
  const scrollTo = Object.getOwnPropertyDescriptor(element, "scrollTo");
  Object.defineProperty(element, "scrollTo", {
    configurable: true,
    value(options) {
      this.scrollTop = options.top ?? this.scrollTop;
    },
  });
  const observers = ["ResizeObserver", "IntersectionObserver"].map((name) => [
    name,
    Object.getOwnPropertyDescriptor(globalThis, name),
  ]);
  for (const [name] of observers) Object.defineProperty(globalThis, name, { configurable: true, value: browser[name] });
  let snapshot = {
    revision: 1,
    policy: { detachedDaemon: true, autoReconnect: true },
    environments: [remoteView(), remoteView("remote-b")],
  };
  let onSnapshot;
  const commands = [];
  const spaces = ["remote-a", "remote-b"].map((environmentId) => ({
    environmentId,
    path: "/srv/shared",
    displayPath: "~/shared",
  }));
  Object.assign(harness.dom.window.piBridge, {
    getUiState: async () => ({ projectSpaces: { version: 2, spaces, seeded: [] } }),
    setUiState: async () => {},
    listEnvironments: async () => snapshot,
    onEnvironmentsChanged(listener) {
      onSnapshot = listener;
      return () => {
        onSnapshot = null;
      };
    },
    async environmentCommand(command) {
      commands.push(command);
      return snapshot.environments.find((view) => view.id === command.environmentId);
    },
  });
  const api = await importTestBundle(`remote-attribution-${++sequence}`, {
    ...realRendererGraphOptions(path.resolve(import.meta.dirname, "../../..")),
    stdin: {
      contents:
        'export * from "./lib/space-attribution.ts";' +
        'export { workspaceStore } from "./lib/workspace-store.ts";' +
        'export { environmentRegistry } from "./lib/environment-registry.ts";' +
        'export { resetRpc } from "./lib/api-client.ts";' +
        'export { installApiShims } from "./lib/api-fetch.ts";' +
        'export * from "./lib/draft-store.ts";' +
        'export { ChatInput } from "./components/ChatInput.tsx";' +
        'export { TopBar } from "./components/app-shell/top-bar.tsx";' +
        'export { ComposerEnvironmentStrip } from "./components/chat-input/composer-environment-strip.tsx";' +
        'export { ReconnectBanner } from "./components/chat-window/reconnect-banner.tsx";' +
        'export { RemoteDaemonCapsule } from "./components/chat-window/remote-daemon-capsule.tsx";' +
        'export { setAppLanguage } from "./i18n.ts";' +
        extraExports,
      resolveDir: path.resolve(import.meta.dirname, ".."),
      sourcefile: "remote-attribution-entry.tsx",
      loader: "tsx",
    },
  });
  harness.storedValues.clear();
  api.resetDraftCache();
  let primaryHost = {
    call(method) {
      if (method === "skills.list") return { skills: [] };
      if (method === "files.index") return { files: [], truncated: false };
      throw new Error(`Unexpected attribution Host request: ${method}`);
    },
  };
  const boundary = installRendererApi(harness.dom.window, api, () => primaryHost);
  const remoteServers = [];
  api.environmentRegistry.initialize();
  await api.workspaceStore.initialize(harness.dom.window.piBridge);
  let root;
  t.after(async () => {
    if (root) await act(async () => root.unmount());
    api.resetDraftCache();
    boundary.close();
    for (const { connection, server, port } of remoteServers) {
      connection.close();
      server.detachPort(port);
      port.close();
    }
    if (scrollTo) Object.defineProperty(element, "scrollTo", scrollTo);
    else delete element.scrollTo;
    errors.mock.restore();
    for (const [name, descriptor] of observers) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
    rootEl.textContent = "";
  });
  return {
    api,
    commands,
    errors,
    setPrimaryHost(host) {
      primaryHost = host;
    },
    serve(environmentId, host) {
      const server = createRpcServer();
      server.handle({
        "models.list": (params) => host.listModels?.(params?.cwd) ?? { models: [], nameMap: {}, catalog: {} },
        "sessions.get": (params) => host.getSession(params.id, params.includeState),
        "agent.state": (params) => host.agentState?.(params.sessionId) ?? { running: false, state: {} },
        "agent.new": (params) => host.newAgent(params),
        "agent.command": (params) => host.sendAgentCommand(params.sessionId, params.command),
        "agent.generateTitle": (params) => host.call("agent.generateTitle", params),
        "skills.list": () => ({ skills: [] }),
        "files.index": () => ({ files: [], truncated: false }),
        "files.read": (params) => host.readFile(params.path, params.sourceSessionId),
      });
      const { port1, port2 } = new MessageChannel();
      server.attachPort(port1);
      const connection = api.environmentRegistry.getConnection(environmentId);
      connection.replacePort(port2, 1);
      remoteServers.push({ connection, server, port: port1 });
      return server;
    },
    async flush() {
      await act(async () => new Promise((resolve) => setImmediate(resolve)));
    },
    async render(Component, props = {}) {
      root ??= createRoot(rootEl);
      try {
        await act(async () => root.render(createElement(Component, props)));
      } catch (error) {
        if (error instanceof AggregateError) throw new Error(error.errors.map(String).join("; "), { cause: error });
        throw error;
      }
    },
    async unmount() {
      if (!root) return;
      await act(async () => root.unmount());
      root = null;
    },
    async focus(environmentId = "remote-a", path = "/srv/shared") {
      await act(async () => api.workspaceStore.openSpace({ environmentId, path }));
    },
    async push(patch) {
      snapshot = { ...snapshot, ...patch, revision: snapshot.revision + 1 };
      await act(async () => onSnapshot?.(snapshot));
    },
    async status(status, environmentId = "remote-a") {
      await this.push({
        environments: snapshot.environments.map((view) => (view.id === environmentId ? { ...view, status } : view)),
      });
    },
  };
}
