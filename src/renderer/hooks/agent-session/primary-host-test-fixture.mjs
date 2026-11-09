import { MessageChannel } from "node:worker_threads";
import { createRpcServer } from "../../../contract/rpc.ts";

export function installPrimaryHost(
  target,
  handlers = {},
  { subscribe, createChannel = () => new MessageChannel() } = {},
) {
  const borrowed = new Map(
    ["piBridge", "addEventListener", "removeEventListener"].map((key) => [
      key,
      Object.getOwnPropertyDescriptor(target, key),
    ]),
  );
  const add = target.addEventListener?.bind(target);
  const remove = target.removeEventListener?.bind(target);
  const messages = new Set();
  target.addEventListener = (type, listener, options) =>
    type === "message" ? messages.add(listener) : add?.(type, listener, options);
  target.removeEventListener = (type, listener, options) =>
    type === "message" ? messages.delete(listener) : remove?.(type, listener, options);
  const ports = new Set();
  const subscriptionCleanups = new Set();
  const requests = [];
  const subscriptions = [];
  let listener;
  const statusListeners = new Set();
  let generation = 1;
  let revision = 1;
  let phase = "connected";
  const servers = new Map();
  const snapshot = () => ({
    revision,
    policy: { detachedDaemon: true, autoReconnect: true },
    environments: [
      {
        id: "primary",
        label: "Primary",
        enabled: true,
        target: { kind: "primary" },
        descriptor: null,
        status:
          phase === "connected"
            ? { phase, generation, since: generation * 1000 }
            : { phase: "connecting", stage: "authenticating", attempt: 1, progress: null },
      },
    ],
  });
  target.piBridge = {
    getHostStatus: async () => (phase === "connected" ? "ready" : "starting"),
    onHostStatus(next) {
      statusListeners.add(next);
      return () => statusListeners.delete(next);
    },
    getUiState: async () => ({}),
    setUiState: async () => {},
    listEnvironments: async () => snapshot(),
    onEnvironmentsChanged: (next) => {
      listener = next;
      return () => {
        listener = undefined;
      };
    },
    requestHostPort() {
      const currentGeneration = generation;
      const server = createRpcServer();
      servers.set(currentGeneration, server);
      server.handle({
        ...handlers,
        "host.ping": () => ({ ok: true, ts: 0 }),
      });
      const { port1, port2 } = createChannel();
      ports.add(port1);
      ports.add(port2);
      const releases = new Map();
      const releaseSubscriptions = () => {
        for (const release of releases.values()) release?.();
        releases.clear();
      };
      subscriptionCleanups.add(releaseSubscriptions);
      server.attachPort(port2);
      port2.addEventListener("close", releaseSubscriptions);
      port2.addEventListener("message", ({ data }) => {
        if (data.kind === "request") requests.push({ generation: currentGeneration, ...data });
        if (data.kind === "subscribe") {
          subscriptions.push({ generation: currentGeneration, ...data });
          if (subscribe) {
            releases.set(data.id, undefined);
            const release = subscribe(data.topic, data.key, (event) => server.emit(data.topic, data.key, event));
            Promise.resolve(release).then((off) => {
              if (releases.has(data.id)) releases.set(data.id, off);
              else off?.();
            });
          }
        }
        if (data.kind === "unsubscribe") {
          releases.get(data.id)?.();
          releases.delete(data.id);
        }
      });
      port2.start();
      globalThis.queueMicrotask(() => {
        for (const receive of messages)
          receive({
            source: target,
            data: { channel: "dexon-host-port", environmentId: "primary", generation: currentGeneration },
            ports: [port1],
          });
      });
    },
  };
  return {
    requests,
    subscriptions,
    publish(nextGeneration, connected = true) {
      generation = nextGeneration;
      phase = connected ? "connected" : "connecting";
      revision += 1;
      listener?.(snapshot());
      for (const next of statusListeners) next({ status: connected ? "ready" : "starting" });
    },
    emit(topic, key, data) {
      servers.get(generation)?.emit(topic, key, data);
    },
    close() {
      for (const cleanup of subscriptionCleanups) cleanup();
      for (const port of ports) port.close();
      for (const [key, original] of borrowed) {
        if (original) Object.defineProperty(target, key, original);
        else delete target[key];
      }
    },
  };
}
