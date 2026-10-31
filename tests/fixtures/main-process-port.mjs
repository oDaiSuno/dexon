const shell = {
  capability: "shell.bash",
  provider: "system",
  executable: "/bin/bash",
  argvPrefix: [],
  binDir: "/bin",
  cwdSemantics: "native",
  envPatch: {},
};

const defaultSessionOrchestration = Object.freeze({
  enabled: false,
  maxRunning: 8,
  model: null,
  thinkingLevel: null,
  allowUserSessions: true,
});

function answer(message, sessionOrchestration, managedProcesses) {
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
  if (message.method === "sessionOrchestration.getSettings") {
    return { ...sessionOrchestration, settings: sessionOrchestration };
  }
  if (message.method === "managedProcesses.getSettings" && managedProcesses)
    return { enabled: true, reaperReady: true };
  if (message.method === "managedProcesses.register" && managedProcesses) return { journalRevision: 1 };
  if (message.method === "managedProcesses.unregister" && managedProcesses)
    return { journalRevision: 2, removed: true };
  return {};
}

export function installMainProcessPort({
  sessionOrchestration = defaultSessionOrchestration,
  managedProcesses = false,
} = {}) {
  const descriptor = Object.getOwnPropertyDescriptor(process, "parentPort");
  const listeners = new Set();
  let current = { ...sessionOrchestration };
  const deliver = (listener, data) => globalThis.queueMicrotask(() => listener({ data }));

  process.parentPort = {
    on(type, listener) {
      if (type !== "message") return;
      listeners.add(listener);
      deliver(listener, { type: "session-orchestration:settings", settings: structuredClone(current) });
    },
    postMessage(message) {
      if (message?.type !== "host-rpc") return;
      const result = answer(message, current, managedProcesses);
      for (const listener of listeners)
        deliver(listener, { type: "host-rpc-result", id: message.id, ok: true, result });
    },
  };
  const restore = () => {
    if (descriptor) Object.defineProperty(process, "parentPort", descriptor);
    else delete process.parentPort;
  };
  restore.setSessionOrchestrationSettings = (settings) => {
    current = { ...settings };
    for (const listener of listeners)
      deliver(listener, { type: "session-orchestration:settings", settings: structuredClone(current) });
  };
  return restore;
}
