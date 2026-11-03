import { installHostBridge } from "./host-bridge.mjs";

// Compatibility for existing test data at the external Host boundary. These
// are host replies to declared requests; the renderer's helpers stay real.
const requests = {
  "sessions.list": ["listSessions", () => []],
  "sessions.get": ["getSession", (p) => [p.id, p.includeState, p.traceId, p.historyWindow]],
  "sessions.context": ["getSessionContext", (p) => [p.id, p.leafId, p.historyWindow]],
  "sessions.contextPage": ["getSessionContextPage", (p) => [p.id, p.cursor, p.maxTurns, p.maxBytes]],
  "sessions.entryContent": ["getSessionEntryContent", (p) => [p.id, p.entryId, p.blockIndex]],
  "agent.new": ["newAgent", (p) => [p]],
  "agent.state": ["agentState", (p) => [p.sessionId]],
  "models.list": ["listModels", (p) => [p?.cwd]],
  "models.refresh": ["refreshModels", (p) => [p?.cwd, p.requestId]],
  "models.refreshCancel": ["cancelModelsRefresh", (p) => [p.requestId]],
  "system.validateCwd": ["validateCwd", (p) => [p.path]],
  "system.defaultCwd": ["defaultCwd", () => []],
  "files.read": ["readFile", (p) => [p.path, p.sourceSessionId]],
};

const quietRemoteReplies = {
  "remote.hosts": { hosts: [] },
  "remote.workspacesSnapshot": { states: {} },
};

export function installApiHostBridge(target, getHost, resetRpc) {
  resetRpc?.();
  const bridge = installHostBridge(target, {
    call(method, params) {
      const host = getHost();
      if (method === "agent.command") {
        const handler = host.sendAgentCommand ?? host.agentCommand;
        if (handler) return handler.call(host, params.sessionId, params.command);
      }
      const mapping = requests[method];
      if (mapping && typeof host[mapping[0]] === "function") return host[mapping[0]](...mapping[1](params));
      if (method.startsWith("remote.") && host.remoteCall) return host.remoteCall(method, params);
      if (Object.hasOwn(quietRemoteReplies, method)) return structuredClone(quietRemoteReplies[method]);
      if (host.call) return host.call(method, params);
      throw new Error(`Host fixture has no reply for ${method}`);
    },
    subscribe(topic, key, listener) {
      const host = getHost();
      if (host.subscribe) return host.subscribe(topic, key, listener);
      if (topic === "agent.events") return host.subscribeAgentEvents?.(key, listener);
      if (topic === "sessions.changed") return host.subscribeSessionsChanged?.(listener);
      if (topic === "agent.running") return host.subscribeRunning?.(listener);
      return () => {};
    },
  });
  let closed = false;
  return {
    ...bridge,
    close() {
      if (closed) return;
      closed = true;
      const errors = [];
      // Close the fixture first: the shipped client's best-effort close
      // intentionally swallows port errors, which must remain visible here.
      try {
        bridge.close();
      } catch (error) {
        errors.push(error);
      }
      try {
        resetRpc?.();
      } catch (error) {
        errors.push(error);
      }
      if (errors.length === 1) throw errors[0];
      if (errors.length > 1) throw new AggregateError(errors, "Host client and bridge cleanup failed");
    },
  };
}

export function remoteHostBoundary(base, script) {
  const listeners = new Map();
  const calls = [];
  const activity = { started: 0, pending: 0 };
  const scriptedCall = async (method, params) => {
    calls.push({ method, params: structuredClone(params ?? null) });
    activity.started++;
    activity.pending++;
    try {
      if (!Object.hasOwn(script, method)) {
        base.unexpected.push(method);
        throw new Error(`Unexpected remote boundary request: ${method}`);
      }
      const reply = script[method];
      return structuredClone(await (typeof reply === "function" ? reply(params) : reply));
    } finally {
      activity.pending--;
    }
  };
  const emit = (topic, event) => {
    for (const listener of listeners.get(topic) ?? []) listener(structuredClone(event));
  };
  return {
    ...base,
    host: {
      ...base.host,
      remoteCall: scriptedCall,
      call: (method, params) =>
        Object.hasOwn(script, method) ? scriptedCall(method, params) : base.host.call(method, params),
      subscribe(topic, key, listener) {
        if (topic !== "workspace.state" && topic !== "workspace.trustPrompt")
          return base.host.subscribe?.(topic, key, listener);
        if (key !== "*") {
          base.unexpected.push(`${topic}:${key}`);
          throw new Error(`Unexpected remote subscription key: ${key}`);
        }
        if (!listeners.has(topic)) listeners.set(topic, new Set());
        listeners.get(topic).add(listener);
        return () => listeners.get(topic)?.delete(listener);
      },
    },
    activity() {
      const current = base.activity();
      return { started: current.started + activity.started, pending: current.pending + activity.pending };
    },
    requests(method) {
      return method.startsWith("remote.") || Object.hasOwn(script, method)
        ? calls.filter((entry) => entry.method === method).map((entry) => entry.params)
        : base.requests(method);
    },
    emitWorkspaceState: (event) => emit("workspace.state", event),
    emitTrustPrompt: (event) => emit("workspace.trustPrompt", event),
  };
}
