import { randomUUID } from "node:crypto";
import type { MessagePortMain } from "electron";
import type { RpcChannel, WireEvent, WireMessage } from "../../contract/rpc.ts";

export function bridgeRendererPort(port: MessagePortMain, channel: RpcChannel): () => void {
  const prefix = `renderer-${randomUUID()}-`;
  const requests = new Map<string, string>();
  const subscriptions = new Map<string, { id: string; topic: string; key: string }>();
  let closed = false;
  let removeMessage = () => {};
  let removeClose = () => {};
  const sendUnsubscribe = (entry: { id: string; topic: string; key: string }) => {
    channel.send({ kind: "unsubscribe", ...entry });
  };
  const close = (notify = true) => {
    if (closed) return;
    closed = true;
    removeMessage();
    removeClose();
    port.removeListener("message", onMessage);
    port.removeListener("close", onPortClose);
    if (notify) {
      for (const entry of subscriptions.values()) {
        try {
          sendUnsubscribe(entry);
        } catch {
          break;
        }
      }
    }
    subscriptions.clear();
    requests.clear();
    port.close();
  };
  const onPortClose = () => close();
  const deliver = (message: unknown) => {
    try {
      port.postMessage(message);
    } catch {
      close();
    }
  };
  const onMessage = (event: { data: unknown }) => {
    if (closed || !event.data || typeof event.data !== "object") return;
    const message = event.data as WireMessage;
    if (!("id" in message) || typeof message.id !== "string" || message.id.length > 1024) return;
    const id = prefix + message.id;
    try {
      if (message.kind === "request" && typeof message.method === "string") {
        if (requests.size >= 4096) throw new Error("Too many pending renderer requests");
        requests.set(id, message.id);
        channel.send({ ...message, id });
      } else if (message.kind === "subscribe" && typeof message.topic === "string" && typeof message.key === "string") {
        const previous = subscriptions.get(message.id);
        if (previous) sendUnsubscribe(previous);
        subscriptions.set(message.id, { id, topic: message.topic, key: message.key });
        channel.send({ ...message, id });
      } else if (message.kind === "unsubscribe") {
        const entry = subscriptions.get(message.id);
        if (entry) sendUnsubscribe(entry);
        subscriptions.delete(message.id);
      }
    } catch {
      close();
    }
  };
  port.on("message", onMessage);
  port.on("close", onPortClose);
  removeMessage = channel.onMessage((value) => {
    if (closed || !value || typeof value !== "object") return;
    const message = value as WireMessage;
    if (message.kind === "response") {
      const id = requests.get(message.id);
      if (id === undefined) return;
      requests.delete(message.id);
      deliver({ ...message, id });
    } else if (message.kind === "event") {
      const event = message as WireEvent;
      if (
        [...subscriptions.values()].some(
          (entry) => entry.topic === event.topic && (entry.key === "*" || event.key === "*" || entry.key === event.key),
        )
      )
        deliver(message);
    }
  });
  removeClose = channel.onClose(() => close(false));
  if (closed) {
    removeMessage();
    removeClose();
  } else {
    port.start();
  }
  return close;
}
