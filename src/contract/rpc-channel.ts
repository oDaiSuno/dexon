import type { RpcClientPort } from "./rpc.ts";

export type AnyMessagePort = {
  postMessage: (message: unknown, transfer?: unknown[]) => void;
  start?: () => void;
  close?: () => void;
  addEventListener?: (type: string, listener: (ev: { data: unknown }) => void) => void;
  removeEventListener?: (type: string, listener: (ev: { data: unknown }) => void) => void;
  on?: (event: string, listener: (...args: unknown[]) => void) => void;
  off?: (event: string, listener: (...args: unknown[]) => void) => void;
  removeListener?: (event: string, listener: (...args: unknown[]) => void) => void;
};

export interface RpcChannel {
  readonly inboundFrames: number;
  send(message: unknown): void;
  onMessage(listener: (message: unknown) => void): () => void;
  onClose(listener: () => void): () => void;
  close(): void;
}

export interface WebSocketLike {
  readonly readyState?: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  addEventListener?: (type: "message" | "close" | "error", listener: (event: unknown) => void) => void;
  removeEventListener?: (type: "message" | "close" | "error", listener: (event: unknown) => void) => void;
  on?: (type: "message" | "close" | "error", listener: (...args: unknown[]) => void) => void;
  off?: (type: "message" | "close" | "error", listener: (...args: unknown[]) => void) => void;
  removeListener?: (type: "message" | "close" | "error", listener: (...args: unknown[]) => void) => void;
}

type WebSocketPort = RpcClientPort & AnyMessagePort & { readonly inboundFrames: number };
type PortListener = (event: MessageEvent) => void;

function extractMessageData(arg: unknown): unknown {
  if (arg && typeof arg === "object" && "data" in arg && !("kind" in arg)) {
    return (arg as { data: unknown }).data;
  }
  return arg;
}

export function listenPort(port: AnyMessagePort, onData: (data: unknown) => void): () => void {
  if (typeof port.addEventListener === "function") {
    const listener = (ev: { data: unknown }) => onData(ev.data);
    port.addEventListener("message", listener);
    port.start?.();
    return () => port.removeEventListener?.("message", listener);
  }
  if (typeof port.on === "function") {
    const listener = (...args: unknown[]) => onData(extractMessageData(args[0]));
    port.on("message", listener);
    port.start?.();
    return () => {
      if (port.off) port.off("message", listener);
      else port.removeListener?.("message", listener);
    };
  }
  throw new Error("MessagePort has neither addEventListener nor on()");
}

function listenPortClose(port: AnyMessagePort, listener: () => void): (() => void) | undefined {
  if (port.addEventListener) {
    port.addEventListener("close", listener);
    return () => port.removeEventListener?.("close", listener);
  }
  if (port.on) {
    port.on("close", listener);
    return () => {
      if (port.off) port.off("close", listener);
      else port.removeListener?.("close", listener);
    };
  }
  return undefined;
}

export function channelFromMessagePort(port: AnyMessagePort): RpcChannel {
  let inboundFrames = 0;
  let closed = false;
  const unlisten: Array<() => void> = [];
  const messages = new Set<(message: unknown) => void>();
  const closes = new Set<() => void>();
  const finish = () => {
    if (closed) return;
    closed = true;
    for (const remove of unlisten.splice(0)) remove();
    const listeners = [...closes];
    messages.clear();
    closes.clear();
    for (const listener of listeners) {
      try {
        listener();
      } catch {
        continue;
      }
    }
  };
  const removeClose = listenPortClose(port, finish);
  if (removeClose) unlisten.push(removeClose);
  unlisten.push(
    listenPort(port, (message) => {
      if (closed) return;
      inboundFrames += 1;
      for (const listener of [...messages]) listener(message);
    }),
  );
  if (closed) {
    for (const remove of unlisten.splice(0)) remove();
  }
  return {
    get inboundFrames() {
      return inboundFrames;
    },
    send(message) {
      if (closed) throw new Error("RPC channel closed");
      port.postMessage(message);
    },
    onMessage(listener) {
      if (!closed) messages.add(listener);
      return () => {
        messages.delete(listener);
      };
    },
    onClose(listener) {
      if (closed) listener();
      else closes.add(listener);
      return () => {
        closes.delete(listener);
      };
    },
    close() {
      if (closed) return;
      try {
        port.close?.();
      } finally {
        finish();
      }
    },
  };
}

function listenSocket(
  socket: WebSocketLike,
  type: "message" | "close" | "error",
  listener: (...args: unknown[]) => void,
): () => void {
  if (socket.addEventListener) {
    socket.addEventListener(type, listener);
    return () => socket.removeEventListener?.(type, listener);
  }
  if (socket.on) {
    socket.on(type, listener);
    return () => {
      if (socket.off) socket.off(type, listener);
      else socket.removeListener?.(type, listener);
    };
  }
  throw new Error("WebSocket has neither addEventListener nor on()");
}

function frameText(frame: unknown): string {
  const data = extractMessageData(frame);
  if (typeof data === "string") return data;
  if (data instanceof ArrayBuffer) return new TextDecoder().decode(data);
  if (ArrayBuffer.isView(data)) {
    return new TextDecoder().decode(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
  }
  if (Array.isArray(data)) return data.map(frameText).join("");
  throw new Error("RPC WebSocket message must be JSON text");
}

export function createWebSocketClientPort(socket: WebSocketLike): WebSocketPort {
  let inboundFrames = 0;
  let closed = false;
  const listeners = new Map<string, Set<PortListener>>();
  const unlisten: Array<() => void> = [];
  const finish = () => {
    if (closed) return;
    closed = true;
    for (const remove of unlisten.splice(0)) remove();
    const closes = [...(listeners.get("close") ?? [])];
    listeners.clear();
    const event = new MessageEvent("close");
    for (const listener of closes) {
      try {
        listener(event);
      } catch {
        continue;
      }
    }
  };
  const close = () => {
    if (closed) return;
    try {
      socket.close();
    } catch {
      return;
    } finally {
      finish();
    }
  };
  unlisten.push(
    listenSocket(socket, "message", (frame) => {
      if (closed) return;
      inboundFrames += 1;
      let data: unknown;
      try {
        data = JSON.parse(frameText(frame));
      } catch {
        close();
        return;
      }
      const event = new MessageEvent("message", { data });
      for (const listener of [...(listeners.get("message") ?? [])]) listener(event);
    }),
    listenSocket(socket, "close", finish),
    listenSocket(socket, "error", close),
  );
  if (socket.readyState !== undefined && socket.readyState >= 2) queueMicrotask(finish);
  return {
    get inboundFrames() {
      return inboundFrames;
    },
    postMessage(message) {
      if (closed) throw new Error("RPC WebSocket closed");
      const data = JSON.stringify(message);
      if (typeof data !== "string") throw new Error("RPC message must be JSON serializable");
      try {
        if (socket.readyState !== undefined && socket.readyState !== 1) {
          throw new Error("RPC WebSocket is not open");
        }
        socket.send(data);
      } catch (error) {
        close();
        throw error;
      }
    },
    addEventListener(type: string, listener: PortListener) {
      if (closed) return;
      const entries = listeners.get(type) ?? new Set<PortListener>();
      entries.add(listener);
      listeners.set(type, entries);
    },
    removeEventListener(type: string, listener: PortListener) {
      listeners.get(type)?.delete(listener);
    },
    close,
  };
}

export function createWebSocketServerPort(socket: WebSocketLike): WebSocketPort {
  return createWebSocketClientPort(socket);
}

export function channelFromWebSocket(socket: WebSocketLike): RpcChannel {
  const port = createWebSocketClientPort(socket);
  const channel = channelFromMessagePort(port);
  return {
    ...channel,
    get inboundFrames() {
      return port.inboundFrames;
    },
  };
}
