import type { EffectObservation } from "../effect-observation";
import type { AutomationResultSink } from "./automation-result-tool";
import { promptOnChosenModel } from "./chosen-model-prompt";
import { isMutatingWorkspaceTool } from "./execution-profile";
import type { AgentSessionWrapper } from "./wrapper";

export interface AutomationTurnOptions<T = unknown> {
  readonly timeoutMs: number;
  readonly signal?: AbortSignal;
  readonly sink: AutomationResultSink<T>;
}

export interface AutomationTurnOutput<T = unknown> {
  readonly result: T;
  readonly sessionId: string;
  readonly mutatingToolCalls: number;
}

export const AUTOMATION_QUIESCE_GRACE_MS = 1_000;

export function runAutomationTurn<T>(
  wrapper: AgentSessionWrapper,
  prompt: string,
  opts: AutomationTurnOptions<T>,
): Promise<EffectObservation<AutomationTurnOutput<T>>> {
  if (
    !wrapper.isAlive() ||
    wrapper.executionProfile.kind !== "automation" ||
    wrapper.executionProfile.result.sink !== opts.sink
  ) {
    return Promise.resolve({
      kind: "not_applied",
      transient: false,
      error: {
        code: "invalid_input",
        message: "Automation turn requires a live automation session and its result sink",
      },
    });
  }
  if (!Number.isFinite(opts.timeoutMs) || opts.timeoutMs <= 0) {
    return Promise.resolve({
      kind: "not_applied",
      transient: false,
      error: { code: "invalid_input", message: "Automation turn timeout must be positive" },
    });
  }
  return wrapper.enqueueTurn(() => observeTurn(wrapper, prompt, opts));
}

async function observeTurn<T>(
  wrapper: AgentSessionWrapper,
  prompt: string,
  opts: AutomationTurnOptions<T>,
): Promise<EffectObservation<AutomationTurnOutput<T>>> {
  const inFlightTools = new Set<string>();
  const mutatingCalls = new Set<string>();
  let stopped: "timeout" | "aborted" | null = null;
  let promptSettled = false;
  let promptError: unknown;
  let wake: () => void = () => {};
  const changed = () =>
    new Promise<void>((resolve) => {
      wake = resolve;
    });
  let graceTimer: ReturnType<typeof setTimeout> | undefined;
  let graceExpired = false;
  const stop = (reason: "timeout" | "aborted") => {
    if (stopped) return;
    stopped = reason;
    wrapper.blockAutomationTools();
    graceTimer = setTimeout(() => {
      graceExpired = true;
      wake();
    }, AUTOMATION_QUIESCE_GRACE_MS);
    void wrapper.inner.abort().catch(() => undefined);
    wake();
  };
  const abort = () => stop("aborted");
  const unsubscribe = wrapper.onEvent((event) => {
    const id = typeof event.toolCallId === "string" ? event.toolCallId : "";
    if (event.type === "tool_execution_start" && id) inFlightTools.add(id);
    if (event.type === "automation_workspace_tool_start" && id) {
      inFlightTools.add(id);
      if (isMutatingWorkspaceTool(String(event.toolName))) mutatingCalls.add(id);
    }
    if ((event.type === "tool_execution_end" || event.type === "automation_workspace_tool_end") && id) {
      inFlightTools.delete(id);
    }
    wake();
  });
  const releaseSeal = opts.sink.onSeal(() => {
    wrapper.blockAutomationTools();
    wake();
  });
  const timeout = setTimeout(() => stop("timeout"), opts.timeoutMs);
  opts.signal?.addEventListener("abort", abort, { once: true });
  if (opts.signal?.aborted) abort();
  const running = (async () => {
    if (stopped || opts.sink.state.status === "submitted") return;
    await wrapper.waitForExtensionsBound();
    if (stopped) return;
    await wrapper.sessionModel.assertUsable(wrapper.inner);
    if (stopped) return;
    wrapper.applyActiveTools();
    await promptOnChosenModel(wrapper, prompt, { source: "rpc", expandPromptTemplates: false });
  })().then(
    () => {
      promptSettled = true;
      wake();
    },
    (error: unknown) => {
      promptError = error;
      promptSettled = true;
      wake();
    },
  );
  try {
    while (!promptSettled && !graceExpired) await changed();
    while (inFlightTools.size > 0 && !graceExpired) await changed();
    const state = opts.sink.state;
    if (state.status === "submitted" && promptSettled && inFlightTools.size === 0) {
      return {
        kind: "applied",
        output: { result: state.value, sessionId: wrapper.sessionId, mutatingToolCalls: mutatingCalls.size },
      };
    }
    const code = stopped ?? "agent_no_result";
    const message =
      stopped === "timeout"
        ? "Automation turn timed out before a quiescent result was available"
        : stopped === "aborted"
          ? "Automation turn was aborted before a quiescent result was available"
          : `Automation turn ended without submitting automation_result${promptError instanceof Error ? `: ${promptError.message}` : ""}`;
    if (mutatingCalls.size > 0 || state.status === "submitted") {
      return {
        kind: "maybe_applied",
        error: {
          code,
          message,
          detail: {
            mutatingToolCalls: mutatingCalls.size,
            ...(inFlightTools.size ? { inFlightTools: inFlightTools.size } : {}),
          },
        },
      };
    }
    return { kind: "not_applied", transient: stopped !== null, error: { code, message } };
  } finally {
    wrapper.blockAutomationTools();
    clearTimeout(timeout);
    if (graceTimer) clearTimeout(graceTimer);
    opts.signal?.removeEventListener("abort", abort);
    releaseSeal();
    unsubscribe();
    void running;
    wrapper.emit({ type: "prompt_done" });
  }
}
