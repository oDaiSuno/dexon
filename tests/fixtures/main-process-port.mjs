const shell = {
  capability: "shell.bash",
  provider: "system",
  executable: "/bin/bash",
  argvPrefix: [],
  binDir: "/bin",
  cwdSemantics: "native",
  envPatch: {},
};

function answer(message) {
  if (message.method === "toolchain.getSnapshot")
    return {
      revision: 1,
      generatedAt: "2026-08-06T00:00:00.000Z",
      platform: process.platform,
      arch: process.arch,
      candidates: [],
      defaults: { "shell.bash": shell },
      publicState: {},
    };
  if (message.method === "toolchain.resolve")
    return {
      id: "fixture-resolution",
      inventoryRevision: 1,
      workspaceKey: message.params.cwd,
      requirementsHash: "fixture",
      commands: { "shell.bash": shell },
      summary: [],
    };
  return {};
}

export function installMainProcessPort() {
  const descriptor = Object.getOwnPropertyDescriptor(process, "parentPort");
  const listeners = new Set();
  process.parentPort = {
    on(type, listener) {
      if (type === "message") listeners.add(listener);
    },
    postMessage(message) {
      if (message?.type !== "host-rpc") return;
      const result = answer(message);
      globalThis.queueMicrotask(() => {
        for (const listener of listeners)
          listener({ data: { type: "host-rpc-result", id: message.id, ok: true, result } });
      });
    },
  };
  return () => {
    if (descriptor) Object.defineProperty(process, "parentPort", descriptor);
    else delete process.parentPort;
  };
}
