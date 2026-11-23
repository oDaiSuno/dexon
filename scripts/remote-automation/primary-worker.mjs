import { parentPort } from "node:worker_threads";

process.parentPort = {
  on(type, listener) {
    if (type === "message")
      parentPort.on("message", (envelope) => listener({ data: envelope.data, ports: envelope.ports ?? [] }));
  },
  postMessage(message) {
    parentPort.postMessage(message);
  },
};
await import("../../out/main/agent-host.mjs");
