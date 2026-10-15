import { RpcError } from "../../src/contract/types.ts";

// A controlled response source at the Host process boundary. It owns separate
// process/run identities and rejects invalid targets instead of declaring every
// stop or restart successful. Expected UI outcomes are defined in the DOM cases.
export function createManagedProcessHost(initialProcesses) {
  const processes = new Map(initialProcesses.map((info) => [info.processId, structuredClone(info)]));
  const logs = new Map();
  const inputs = [];
  const exported = [];
  const activeStates = new Set(["created", "starting", "running", "ready", "stopping", "restarting"]);
  let revision = 1;

  const fail = (code, message) => {
    throw new RpcError({ code, message });
  };
  const requireProcess = (params, requireRun = false) => {
    const info = processes.get(params?.processId);
    if (!info) fail("PROCESS_NOT_FOUND", "Managed process not found");
    if ((requireRun && !params.runId) || (params.runId !== undefined && params.runId !== info.runId)) {
      fail("PROCESS_STALE_RUN", "Managed process run has changed");
    }
    return info;
  };
  const stopMode = (params) => {
    const mode = params?.mode ?? "graceful";
    if (!["graceful", "force"].includes(mode)) fail("INVALID_PARAMS", "Unknown stop mode");
    return mode;
  };
  const stop = (info, mode) => {
    if (!activeStates.has(info.state)) return info;
    info.state = mode === "force" ? "killed" : "exited";
    info.stdinOpen = false;
    info.exit = { code: mode === "force" ? null : 0, reason: "stopped", stoppedBy: "user", finishedAt: 2 };
    revision++;
    return info;
  };

  return {
    inputs,
    exported,
    setOutput(processId, records) {
      logs.set(processId, structuredClone(records));
    },
    call(method, params) {
      if (method === "processes.list") {
        return {
          revision,
          processes: [...processes.values()].filter((info) => params?.includeExited || activeStates.has(info.state)),
        };
      }
      if (method === "processes.stopAll") {
        const mode = stopMode(params);
        const active = [...processes.values()].filter((info) => activeStates.has(info.state));
        for (const info of active) stop(info, mode);
        return { ok: true, stopped: active.length };
      }
      const info = requireProcess(
        params,
        ["processes.stop", "processes.restart", "processes.write", "processes.export"].includes(method),
      );
      if (method === "processes.read") {
        return {
          processId: info.processId,
          runId: info.runId,
          state: info.state,
          readiness: info.readiness,
          endpoints: info.endpoints,
          fromCursor: `${info.runId}:0`,
          nextCursor: `${info.runId}:1`,
          earliestCursor: `${info.runId}:0`,
          records: logs.get(info.processId) ?? [],
          truncated: false,
        };
      }
      if (method === "processes.stop") return stop(info, stopMode(params));
      if (method === "processes.restart") {
        info.state = "running";
        // The two fixture servers use distinct predetermined next-run identities.
        info.runId = info.processId === "process-one" ? "run-two" : "second-run-two";
        info.generation++;
        info.restartCount++;
        info.stdinOpen = true;
        delete info.exit;
        info.endpoints = info.endpoints.map((endpoint) => ({ ...endpoint, runId: info.runId }));
        logs.delete(info.processId);
        revision++;
        return info;
      }
      if (method === "processes.dismiss") {
        if (activeStates.has(info.state)) fail("PROCESS_NOT_RUNNING", "Stop the process before dismissing it");
        processes.delete(info.processId);
        revision++;
        return { ok: true };
      }
      if (method === "processes.export") {
        exported.push(structuredClone(params));
        return { saved: true, fileName: "logs.txt" };
      }
      if (method === "processes.write") {
        inputs.push(structuredClone(params));
        return { ok: true, runId: info.runId };
      }
      throw new Error(`Unexpected process request: ${method}`);
    },
  };
}
