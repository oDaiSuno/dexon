import { EventEmitter } from "node:events";
import { MessageChannel } from "node:worker_threads";

export function electronPort(port) {
  const adapter = new EventEmitter();
  port.on("message", (data) => adapter.emit("message", { data }));
  port.on("close", () => adapter.emit("close"));
  adapter.postMessage = (message) => port.postMessage(message);
  adapter.start = () => port.start();
  adapter.close = () => port.close();
  return adapter;
}
export class MessageChannelMain {
  constructor() {
    const { port1, port2 } = new MessageChannel();
    this.port1 = electronPort(port1);
    this.port2 = electronPort(port2);
  }
}
