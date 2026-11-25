export function createSessionTestHost(overrides = {}) {
  const eventSinks = [];
  const changeSinks = [];
  const sendCommands = [];
  const getCommands = [];
  const autoTitleRequests = [];
  const recordRpc = async (rpc, sid, ...rest) => {
    getCommands.push({ rpc, sid, args: rest });
    const fn = overrides[rpc];
    if (typeof fn !== "function") throw new Error(`${rpc} is not configured in the harness host`);
    return fn(sid, ...rest);
  };
  const delegateApi =
    (name) =>
    (...args) => {
      const fn = overrides[name];
      if (typeof fn !== "function") throw new Error(`${name} is not configured in the harness host`);
      return fn(...args);
    };
  return {
    eventSinks,
    changeSinks,
    sendCommands,
    getCommands,
    autoTitleRequests,
    subscribeAgentEvents:
      overrides.subscribeAgentEvents ??
      ((sid, onEvent) => {
        const sink = { sid, onEvent, active: true };
        eventSinks.push(sink);
        return Promise.resolve(() => {
          sink.active = false;
        });
      }),
    subscribeSessionsChanged:
      overrides.subscribeSessionsChanged ??
      ((onChange) => {
        changeSinks.push(onChange);
        return Promise.resolve(() => {
          onChange.active = false;
        });
      }),
    listModels:
      overrides.listModels ??
      (async () => ({
        models: [],
        nameMap: {},
        thinkingLevels: {},
        thinkingLevelMaps: {},
        catalog: { source: "cache", refreshed: false, aborted: false, warnings: [] },
        defaultModel: null,
      })),
    newAgent: delegateApi("newAgent"),
    refreshModels: delegateApi("refreshModels"),
    cancelModelsRefresh: delegateApi("cancelModelsRefresh"),
    sendAgentCommand(sid, payload) {
      sendCommands.push({ sid, payload });
      const fn = overrides.sendAgentCommand;
      if (typeof fn !== "function") return {};
      return fn(sid, payload);
    },
    getSession: (sid, ...rest) => recordRpc("getSession", sid, ...rest),
    getSessionContext: (sid, ...rest) => recordRpc("getSessionContext", sid, ...rest),
    getSessionContextPage: (sid, ...rest) => recordRpc("getSessionContextPage", sid, ...rest),
    getSessionEntryContent: (sid, ...rest) => recordRpc("getSessionEntryContent", sid, ...rest),
    agentState: (sid, ...rest) => recordRpc("agentState", sid, ...rest),
    call(method, params) {
      if (method === "models.sessionNaming.get")
        return Promise.resolve(overrides.sessionNamingSettings ?? { enabled: true, model: null, configured: true });
      if (method !== "agent.generateTitle") throw new Error("api-client.call is not configured in the harness host");
      autoTitleRequests.push(params);
      return Promise.resolve({ title: null });
    },
    t: overrides.t ?? ((_key, fallback) => fallback),
  };
}
