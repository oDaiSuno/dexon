const shell = {
  capability: "shell.bash",
  provider: "system",
  executable: "/bin/bash",
  argvPrefix: [],
  binDir: "/bin",
  cwdSemantics: "native",
  envPatch: {},
};

// The Main process defaults documented in the issue: collaboration is off, at
// most eight Agent-created sessions run at once, no model/thinking override, and
// prompts to user sessions are allowed.
const defaultSessionOrchestration = Object.freeze({
  enabled: false,
  maxRunning: 8,
  model: null,
  thinkingLevel: null,
  allowUserSessions: true,
});

function answer(message, sessionOrchestration) {
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
    // Both envelopes are answered because the issue fixes the push message
    // (`{ type, settings }`) but not whether the pull returns the settings
    // directly or nested; the test must fail on missing behavior, not on this.
    return { ...sessionOrchestration, settings: sessionOrchestration };
  }
  return {};
}

export function installMainProcessPort({ sessionOrchestration = defaultSessionOrchestration } = {}) {
  const descriptor = Object.getOwnPropertyDescriptor(process, "parentPort");
  const listeners = new Set();
  let current = { ...sessionOrchestration };
  const deliver = (listener, data) => globalThis.queueMicrotask(() => listener({ data }));

  process.parentPort = {
    on(type, listener) {
      if (type !== "message") return;
      listeners.add(listener);
      // Main pushes the current settings after a Host (re)start, so a listener
      // that appears later still receives the value in force.
      deliver(listener, { type: "session-orchestration:settings", settings: structuredClone(current) });
    },
    postMessage(message) {
      if (message?.type !== "host-rpc") return;
      const result = answer(message, current);
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
