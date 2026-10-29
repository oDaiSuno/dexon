import { createRpcServer } from "../../src/contract/rpc.ts";
import { RpcError } from "../../src/contract/types.ts";

// This represents the other process, NOT an api-client replacement. The
// shipped renderer client, request framing, server dispatch and subscriptions
// all run unchanged. Delivery uses microtasks so tests can explicitly settle
// it without a real Agent process or wall-clock sleeps.
export function installHostBridge(target, { call, subscribe } = {}) {
  const server = createRpcServer();
  const listeners = new Map();
  const releases = new Map();
  const windowMessages = new Set();
  let closed = false;
  const originals = new Map(
    ["piBridge", "addEventListener", "removeEventListener"].map((name) => [
      name,
      Object.getOwnPropertyDescriptor(target, name),
    ]),
  );
  const add = target.addEventListener?.bind(target);
  const remove = target.removeEventListener?.bind(target);
  const port = {
    addEventListener(type, listener) {
      const set = listeners.get(type) ?? new Set();
      set.add(listener);
      listeners.set(type, set);
    },
    removeEventListener(type, listener) {
      listeners.get(type)?.delete(listener);
    },
    start() {},
    postMessage(message) {
      if (closed) throw new Error("Host fixture port is closed");
      globalThis.queueMicrotask(() => {
        if (closed) return;
        for (const listener of listeners.get("message") ?? []) listener({ data: globalThis.structuredClone(message) });
      });
    },
    close() {
      if (closed) return;
      closed = true;
      const errors = [];
      for (const release of releases.values()) {
        try {
          release?.();
        } catch (error) {
          errors.push(error);
        }
      }
      releases.clear();
      try {
        for (const listener of listeners.get("close") ?? []) listener();
      } finally {
        server.detachPort(serverPort);
      }
      if (errors.length === 1) throw errors[0];
      if (errors.length > 1) throw new AggregateError(errors, "Host subscriptions could not all be released");
    },
  };
  const serverPort = {
    addEventListener(type, listener) {
      if (type === "message") this.listener = listener;
    },
    removeEventListener() {},
    start() {},
    close() {},
    postMessage(message) {
      port.postMessage(message);
    },
  };
  const clientPort = {
    ...port,
    postMessage(message) {
      if (closed) throw new Error("Host fixture port is closed");
      if (message.kind === "request") {
        server.handle({
          [message.method]: async (params) => {
            if (message.method === "host.ping") return { ok: true };
            try {
              return await call(message.method, params);
            } catch (error) {
              if (error?.code || error?.detail)
                throw new RpcError({ code: error.code ?? "INTERNAL", message: error.message, detail: error.detail });
              throw error;
            }
          },
        });
      }
      serverPort.listener({ data: globalThis.structuredClone(message) });
      if (message.kind === "subscribe" && subscribe) {
        const release = subscribe(message.topic, message.key, (data) => server.emit(message.topic, message.key, data));
        Promise.resolve(release).then((off) => {
          if (closed || (releases.has(message.id) === false && cancelled.has(message.id))) off?.();
          else releases.set(message.id, off);
        });
      }
      if (message.kind === "unsubscribe") {
        cancelled.add(message.id);
        releases.get(message.id)?.();
        releases.delete(message.id);
      }
    },
  };
  const cancelled = new Set();
  server.attachPort(serverPort);
  const restoreProperties = () => {
    for (const [name, descriptor] of originals) {
      if (descriptor) Object.defineProperty(target, name, descriptor);
      else delete target[name];
    }
  };
  try {
    target.addEventListener = (type, listener, options) => {
      if (type === "message") windowMessages.add(listener);
      else add?.(type, listener, options);
    };
    target.removeEventListener = (type, listener, options) => {
      if (type === "message") windowMessages.delete(listener);
      else remove?.(type, listener, options);
    };
    const supplied = target.piBridge;
    target.piBridge = {
      ...supplied,
      getHostStatus: supplied?.getHostStatus ?? (async () => "ready"),
      requestHostPort() {
        globalThis.queueMicrotask(() => {
          for (const listener of windowMessages)
            listener({ source: target, data: "dexon-host-port", ports: [clientPort] });
        });
      },
    };
  } catch (error) {
    try {
      port.close();
    } finally {
      restoreProperties();
    }
    throw error;
  }
  let disposed = false;
  return {
    emit: (topic, key, data) => server.emit(topic, key, data),
    close() {
      if (disposed) return;
      disposed = true;
      try {
        port.close();
      } finally {
        restoreProperties();
      }
    },
  };
}
