import type { AutomationStore, DueTrigger } from "../store";
import type { WatchSample } from "../core/triggers";
import { createHttpAction } from "./http-action";
import type { AttemptContext, SecretReader } from "./types";
import type { createScriptAction } from "./script-action";

export function createWatchProbe(deps: {
  store: AutomationStore;
  fetch: typeof fetch;
  secrets: SecretReader;
  script: ReturnType<typeof createScriptAction>;
  maxOutputBytes: number;
}) {
  const http = createHttpAction(deps);
  return async (due: DueTrigger, signal: AbortSignal): Promise<WatchSample> => {
    if (due.plan.kind !== "watch") throw new Error("Expected a watch trigger");
    const revision = deps.store.getTaskRevision(due.taskId, due.revision);
    if (!revision?.grant)
      return { kind: "probe_fault", error: { code: "grant_violation", message: "Watch revision is not granted" } };
    const context: AttemptContext = {
      taskId: due.taskId,
      runId: due.key,
      stepId: due.triggerId,
      attemptNo: 1,
      effectKey: `${due.key}:${due.nextDueAtMs}`,
      cwd: revision.source.cwd,
      grant: revision.grant,
      values: {
        input: null,
        trigger: { cursor: due.state.kind === "items" ? due.state.cursor : null },
        run: { id: "" },
        task: { name: revision.source.name },
        steps: new Map(),
      },
      signal,
      maxOutputBytes: deps.maxOutputBytes,
      onSession: () => {},
    };
    const call = due.plan.probe;
    try {
      const observed = await (call.action === "http.request"
        ? http(call, context)
        : deps.script.execute(call, context));
      if (observed.kind === "applied") {
        const output = observed.output;
        return {
          kind: "sample_ok",
          output:
            call.action === "http.request" && output !== null && typeof output === "object" && !Array.isArray(output)
              ? (output.body ?? null)
              : output,
        };
      }
      const fault =
        [
          "grant_violation",
          "missing_secret",
          "script_changed",
          "invalid_input",
          "output_too_large",
          "internal",
          "provider_rejected",
        ].includes(observed.error.code) ||
        (observed.error.code === "http_status" && [401, 403].includes(Number(observed.error.detail?.status)));
      return { kind: fault ? "probe_fault" : "sample_failed", error: observed.error };
    } catch {
      return { kind: "probe_fault", error: { code: "internal", message: "Watch probe could not be executed" } };
    }
  };
}
