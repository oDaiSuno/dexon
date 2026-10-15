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
