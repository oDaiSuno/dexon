import { createElement, act } from "react";
import { create } from "react-test-renderer";

export const remoteServer = (id, status = { phase: "connected", generation: 1, since: 0 }) => ({
  id,
  label: id,
  enabled: true,
  target: { kind: "ssh", sshAlias: id },
  status,
  descriptor: null,
});

export function folderListing(path, overrides = {}) {
  return {
    ok: true,
    path,
    displayPath: path.replace("/home/dev", "~"),
    home: "/home/dev",
    parent: path === "/" ? null : path.slice(0, path.lastIndexOf("/")) || "/",
    git: null,
    folders: [],
    truncated: false,
    ...overrides,
  };
}

export function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

function hostPort(environmentId, host) {
  const listeners = new Map();
  let closed = false;
  const emit = (data) => {
    if (!closed) for (const listener of listeners.get("message") ?? []) listener({ data });
  };
  return {
    addEventListener(type, listener) {
      const group = listeners.get(type) ?? new Set();
      group.add(listener);
      listeners.set(type, group);
    },
    removeEventListener(type, listener) {
      listeners.get(type)?.delete(listener);
    },
    postMessage(request) {
      if (request.kind !== "request") return;
      Promise.resolve()
        .then(() => host(environmentId, request.method, request.params))
        .then(
          (result) => emit({ kind: "response", id: request.id, ok: true, result }),
          (error) =>
            emit({ kind: "response", id: request.id, ok: false, error: { code: "INTERNAL", message: error.message } }),
        );
    },
    start() {},
    close() {
      closed = true;
      listeners.clear();
    },
  };
}

export async function createFolderBrowserHost(
  api,
  { servers = [remoteServer("gpu"), remoteServer("staging")], reply, target } = {},
) {
  const names = ["window", "IS_REACT_ACT_ENVIRONMENT"];
  const originals = new Map(names.map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  const browser = target ?? {};
  const borrowed = ["piBridge", "addEventListener", "removeEventListener"];
  const properties = new Map(borrowed.map((name) => [name, Object.getOwnPropertyDescriptor(browser, name)]));
  const originalAdd = browser.addEventListener?.bind(browser);
  const originalRemove = browser.removeEventListener?.bind(browser);
  const listeners = new Set();
  const ports = new Set();
  const requests = [];
  const writes = [];
  const commands = [];
  let revision = 1;
  let views = servers;
  let changed;
  let respond = reply ?? ((_id, _method, params) => folderListing(params.path === "~" ? "/home/dev" : params.path));
  const snapshot = () => ({ revision, policy: { detachedDaemon: true, autoReconnect: true }, environments: views });
  const bridge = {
    getUiState: async () => ({}),
    setUiState: async (patch) => {
      writes.push(structuredClone(patch));
    },
    listEnvironments: async () => snapshot(),
    onEnvironmentsChanged: (listener) => {
      changed = listener;
      return () => {
        changed = null;
      };
    },
    environmentCommand: async (command) => {
      commands.push(command);
      return views.find((view) => view.id === command.environmentId);
    },
    requestEnvironmentPort(environmentId) {
      const view = views.find((server) => server.id === environmentId);
      const port = hostPort(environmentId, (id, method, params) => {
        requests.push({ environmentId: id, method, params });
        return respond(id, method, params);
      });
      ports.add(port);
      for (const receive of listeners)
        receive({
          source: browser,
          data: { channel: "dexon-host-port", environmentId, generation: view.status.generation },
          ports: [port],
        });
    },
  };
  Object.defineProperties(browser, {
    piBridge: { configurable: true, value: bridge },
    addEventListener: {
      configurable: true,
      value: (type, receive, options) =>
        type === "message" ? listeners.add(receive) : originalAdd?.(type, receive, options),
    },
    removeEventListener: {
      configurable: true,
      value: (type, receive, options) =>
        type === "message" ? listeners.delete(receive) : originalRemove?.(type, receive, options),
    },
  });
  Object.defineProperty(globalThis, "window", { configurable: true, writable: true, value: browser });
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  await api.workspaceStore.initialize(bridge);
  api.workspaceStore.focusSession({ id: "open-chat", environmentId: "primary", cwd: "/local/project" });
  await Promise.resolve();
  writes.length = 0;
  return {
    requests,
    writes,
    commands,
    setReply(next) {
      respond = next;
    },
    async changeServers(next) {
      await act(async () => {
        views = next;
        revision += 1;
        changed(snapshot());
      });
    },
    close() {
      for (const port of ports) port.close();
      for (const [name, descriptor] of properties) {
        if (descriptor) Object.defineProperty(browser, name, descriptor);
        else delete browser[name];
      }
      for (const [name, descriptor] of originals) {
        if (descriptor) Object.defineProperty(globalThis, name, descriptor);
        else delete globalThis[name];
      }
      api.environmentRegistry.initialize();
    },
  };
}

export async function mountFolderBrowser(t, api, options = {}) {
  const host = await createFolderBrowserHost(api, options);
  let browser;
  let renderer;
  function Probe() {
    browser = api.useFolderBrowser({ initialEnvironmentId: options.initialEnvironmentId });
    return null;
  }
  t.after(async () => {
    await act(async () => renderer?.unmount());
    host.close();
  });
  await act(async () => {
    renderer = create(createElement(Probe));
  });
  return { ...host, get: () => browser };
}
